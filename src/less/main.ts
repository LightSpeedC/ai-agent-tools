/*
	less — UTF-8 セーフなページャー。

	DOS の more へ UTF-8 の出力をパイプすると、CP932 として読まれて
	文字化けする（i260912-06 と根が同じ、出力コードページ問題の受け手側）。
	標準入力を読み、画面に収まる分だけ表示してキー操作を待つ。

	入力の文字コードは convert-encoding・text と同じ判定（src/lib/detector.ts）で
	自動判定する（UTF-8・SJIS・UTF-16 等）。決められないときは UTF-8 として読む。

	計画: notes/10_plan/i260917-01-less.html
*/

import * as fs from 'node:fs';
import * as tty from 'node:tty';
import { parseArgs } from '../lib/args.ts';
import { enableWindowsConsoleVt } from '../lib/win-console.ts';
import { detect } from '../lib/detector.ts';
import { decode } from '../lib/codec.ts';

const ExitOk = 0;
const ExitBadArgs = 2;

/**
 * 表示幅を数える（ASCII・半角ｶﾀｶﾅは1桁、それ以外は2桁。実機で確認済み）。
 * 手でスペースを数えて決め打ちすると、ラベルを変えたときに数え直しを
 * 忘れて桁がずれる（実際に踏んだ。共通ルール「全角・半角混在のテキストを
 * 桁揃えするとき」を参照）
 */
function displayWidth(s: string): number {
	let w = 0;
	for (const ch of s) {
		const c = ch.codePointAt(0) ?? 0;
		w += (c < 0x80 || (c >= 0xff61 && c <= 0xff9f)) ? 1 : 2;
	}
	return w;
}

/** label を target 桁まで空白で埋める */
function pad(label: string, target: number): string {
	return label + ' '.repeat(Math.max(1, target - displayWidth(label)));
}

const KeyColumn = 18;

const Usage =
	'UTF-8 セーフなページャー（DOS more の文字化けを避ける）\n'
	+ '\n'
	+ '  <コマンド> | less\n'
	+ '\n'
	+ '  ' + pad('q', KeyColumn) + '終了\n'
	+ '  ' + pad('PageDown・Space', KeyColumn) + '画面の高さの 3/4 くらい下\n'
	+ '  ' + pad('↓・Enter', KeyColumn) + '1 行下\n'
	+ '  ' + pad('↑', KeyColumn) + '1 行上\n'
	+ '  ' + pad('PageUp', KeyColumn) + '画面の高さの 3/4 くらい上\n'
	+ '\n'
	+ '  ' + pad('--help', KeyColumn) + 'この説明を表示する\n'
	+ '\n'
	+ '  出力先が端末でない（リダイレクト等）ときは、ページングせず\n'
	+ '  そのまま流す。パイプ専用で、ファイル引数は受けない。\n';

function out(s: string): void {
	process.stdout.write(s);
}

function fail(message: string): number {
	process.stderr.write(message + '\n\n' + Usage);
	return ExitBadArgs;
}

/**
 * 標準入力を全部読み切る（戻りスクロールのため、全行をメモリに持つ）。
 * 文字コードは convert-encoding・text と同じ判定（src/lib/detector.ts）で
 * 自動判定する。決められない（両方妥当な非 ASCII を含む等）ときは
 * UTF-8 として読む（このツールの既定であり、名前の由来でもあるため）
 */
function readStdin(): Promise<string> {
	return new Promise((resolve, reject) => {
		const chunks: Buffer[] = [];
		process.stdin.on('data', (c: Buffer) => { chunks.push(c); });
		process.stdin.on('end', () => {
			const bytes = new Uint8Array(Buffer.concat(chunks));
			const kind = detect(bytes) ?? 'utf8';
			resolve(decode(bytes, kind));
		});
		process.stdin.on('error', reject);
	});
}

/** 改行で分ける。末尾の改行だけ落とす（空行の連続はそのまま残す） */
function splitLines(text: string): string[] {
	const t = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
	const body = t.endsWith('\n') ? t.slice(0, -1) : t;
	if (body.length === 0) { return []; }
	return body.split('\n');
}

/** 末尾に改行があったか（空入力は判定不要なので true にしておく） */
function hasTrailingNewline(text: string): boolean {
	if (text.length === 0) { return true; }
	const t = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
	return t.endsWith('\n');
}

async function main(argv: string[]): Promise<number> {
	const parsed = parseArgs(argv, [], {});
	if (parsed.help) { out(Usage); return ExitOk; }
	if (parsed.error != null) { return fail(parsed.error); }

	const text = await readStdin();
	const lines = splitLines(text);

	// 端末で無ければ（リダイレクト等）ページングせずそのまま流す
	if (!process.stdout.isTTY) {
		out(lines.join('\n') + (lines.length > 0 ? '\n' : ''));
		return ExitOk;
	}

	const keyStream = await openKeyStream();
	if (keyStream == null) {
		// コンソール入力を開けない環境では、操作を諦めて素通しにする
		out(lines.join('\n') + (lines.length > 0 ? '\n' : ''));
		return ExitOk;
	}

	return page(lines, keyStream, hasTrailingNewline(text));
}

/**
 * キー入力の取得元。標準入力はパイプのデータで埋まっている
 * （cmd | less の形）ため使えず、コンソールから直接読む。
 * Node と Bun で取得方法が違うため、この形に抽象化する。
 */
interface KeySource {
	onData(cb: (chunk: string) => void): void;
	close(): void;
}

/**
 * Node 向け。Windows のコンソール入力は CONIN$（自プロセスのコンソール
 * 入力バッファを指す予約名）で直接開ける。開けなければ null を返す
 * （コンソールが無い環境）。
 */
function openNodeKeySource(): KeySource | null {
	try {
		// 素の 'CONIN$' は Node がカレントフォルダからの相対パスとして
		// 解決してしまい、Windows の予約名として扱われない（実測で確認）。
		// Win32 のデバイス名前空間 \\.\ を付けると正しく開ける
		//
		// 読み取り専用（'r'）で開くと isTTY は true を返すのに setRawMode が
		// EPERM で失敗する。Windows の SetConsoleMode は書き込みアクセスも
		// 要るため、'r+'（読み書き）で開く（実測で確認）
		const fd = fs.openSync('\\\\.\\CONIN$', 'r+');
		const stream = new tty.ReadStream(fd);
		if (!stream.isTTY) { return null; }
		return {
			onData(cb) {
				stream.on('data', (c: Buffer) => cb(c.toString('utf8')));
				stream.setRawMode(true);
				stream.resume();
			},
			close() {
				stream.setRawMode(false);
				stream.removeAllListeners('data');
				stream.pause();
			},
		};
	} catch {
		return null;
	}
}

// _getch の拡張キー（矢印・PageUp/Down）は、1 回目が 0 か 0xE0 を返した後、
// 2 回目の呼び出しでスキャンコードが来る（MS-CRT の昔からの仕様）。
// handleKey がそのまま読める ANSI エスケープ列に変換しておく
const ScanCode: Record<number, string> = { 72: '\x1b[A', 80: '\x1b[B', 73: '\x1b[5~', 81: '\x1b[6~' };

/**
 * Bun 向け。tty.ReadStream に CONIN$ を包んでも setRawMode が
 * 「TTY ではない」で失敗し、書き込みアクセスを足しても直らない
 * （Node とは別の失敗で、実測で確認。Bun の Windows 向け TTY 実装の
 * 制約と見られる。計画 notes/10_plan/i260917-01-less.html を参照）。
 *
 * node:tty を経由せず、MS-CRT（msvcrt.dll）の _kbhit / _getch を
 * bun:ffi で直接呼ぶ。これらはコンソールを直接読む実装のため、
 * 標準入力がパイプで埋まっていても影響を受けない（実測で確認）。
 */
async function openBunKeySource(): Promise<KeySource | null> {
	try {
		const { dlopen, FFIType } = await import('bun:ffi');

		// Windows コンソールの VT100 エスケープ解釈を明示的に有効化する
		// （Bun では既定で無効なことを実機で確認済み。失敗しても
		// 対話ページング自体は続ける）。終了時に元へ戻す
		const restoreConsole = await enableWindowsConsoleVt();

		const { symbols } = dlopen('msvcrt.dll', {
			_kbhit: { args: [], returns: FFIType.i32 },
			_getch: { args: [], returns: FFIType.i32 },
		});
		let timer: ReturnType<typeof setInterval> | null = null;
		return {
			onData(cb) {
				timer = setInterval(() => {
					while (symbols._kbhit()) {
						const c = symbols._getch();
						const s = (c === 0 || c === 0xe0) ? ScanCode[symbols._getch()] : String.fromCharCode(c);
						if (s != null) { cb(s); }
					}
				}, 30);
			},
			close() {
				if (timer != null) { clearInterval(timer); }
				restoreConsole();
			},
		};
	} catch {
		return null;
	}
}

function openKeyStream(): Promise<KeySource | null> {
	return typeof Bun !== 'undefined' ? openBunKeySource() : Promise.resolve(openNodeKeySource());
}

/** 画面の高さ（表示に使う行数）。ステータス行の 1 行を引く */
function pageHeight(): number {
	const rows = process.stdout.rows;
	return Math.max(1, (rows != null && rows > 0 ? rows : 24) - 1);
}

/** top が動ける範囲に収める */
function clampTop(top: number, lineCount: number, height: number): number {
	if (top < 0) { return 0; }
	const max = Math.max(0, lineCount - height);
	return top > max ? max : top;
}

function page(lines: string[], key: KeySource, hasTrailingNewline: boolean): Promise<number> {
	return new Promise((resolve) => {
		let top = 0;

		const EofMarker = '\x1b[7m[EOF]\x1b[0m';

		/**
		 * 改行ありで終わる場合、[EOF] を「実データの後ろに続くもう1行」として
		 * 数える。スクロール量・top の可動範囲（clampTop）の計算にそのまま
		 * 混ぜられるため、「画面に余裕があるときだけ表示する」ような特別扱いが
		 * 要らない（実データがちょうど画面いっぱいになる回でも、この仮想行の
		 * ぶんだけ普通に1行分スクロールして表示できる）
		 */
		const virtualLength = lines.length + (hasTrailingNewline ? 1 : 0);

		/**
		 * 表示する行のテキスト。idx は lines.length（＝仮想行）まで受け付ける。
		 * 改行が無いまま終わっている実データの最終行にだけ、末尾へ
		 * 「[改行なし] [EOF]」を付け足す（同じ行に収まるため仮想行を増やさない）
		 */
		function displayLine(idx: number): string {
			if (idx === lines.length) { return EofMarker; }
			const text = lines[idx];
			if (idx !== lines.length - 1 || hasTrailingNewline) { return text; }
			return text + ' [改行なし] ' + EofMarker;
		}

		/** ステータス行の文字列（前後の反転表示の記号は含まない） */
		function statusText(): string {
			const h = pageHeight();
			const shown = Math.min(top + h, lines.length);
			const pct = lines.length === 0 ? 100 : Math.round((shown / lines.length) * 100);
			return '-- less (' + pct + '%) q で終了 | Page Up | ↑ | ↓・Enter | Page Down・Space --';
		}

		function render(): void {
			const h = pageHeight();
			const view: string[] = [];
			for (let i = 0; i < h && top + i < virtualLength; i++) { view.push(displayLine(top + i)); }
			out('\x1b[2J\x1b[H');
			out(view.join('\n'));
			if (view.length < h) { out('\n'.repeat(h - view.length)); }
			// 最後に書いたコンテンツ行の文字数ぶんカーソルが右にずれたままのことがあり
			// （改行だけでは列が先頭に戻らない）、絶対位置で書く writeStatus() に任せる
			writeStatus();
		}

		/** ステータス行だけをその場で上書きする（スクロール方式で使う） */
		function writeStatus(): void {
			out('\x1b[' + (pageHeight() + 1) + ';1H\x1b[2K\x1b[7m' + statusText() + '\x1b[0m');
		}

		/**
		 * スクロール範囲をコンテンツ用の h 行だけに限定する（DECSTBM）。
		 * 画面はコンテンツ h 行＋ステータス行 1 行の計 h+1 行を使っており、
		 * 範囲を区切らないと「コンテンツの最終行」は端末にとって画面の
		 * 最終行ではない（1行下にステータス行がある）ため、そこで改行しても
		 * スクロールせずカーソルがステータス行へ動くだけになる（実機で確認）。
		 * 範囲を区切れば、その中だけが正しくスクロールしステータス行は動かない
		 */
		function setScrollRegion(): void {
			out('\x1b[1;' + pageHeight() + 'r');
		}

		/** スクロール範囲を画面全体に戻す（終了時に呼ぶ） */
		function resetScrollRegion(): void {
			out('\x1b[r');
		}

		/**
		 * 下方向のスクロール。最終行（h 行目）の先頭へ置いてから、新しく見える
		 * 行の数だけ「CRLF→行末までクリア→テキスト」を繰り返す。
		 * **スクロール（LF）を先に、書くのを後にする**のが要点。逆（書いてから
		 * LF）にすると、LF がスクロール範囲の下端で起きたときに「書いたばかりの
		 * 内容」まで1行分押し上げられてしまい、最下行が空のまま残る
		 * （実機で報告）。CR で必ず行頭へ戻すため、複数行分でも列がずれない
		 */
		function scrollDown(newTop: number): void {
			const h = pageHeight();
			const revealCount = newTop - top;
			out('\x1b[' + h + ';1H');
			for (let i = 0; i < revealCount; i++) {
				// \x1b[K はカーソル位置から行末までしか消さないため、
				// 念のため先頭へ戻してから消す（列がずれていた場合の保険）
				out('\r\n\x1b[K' + displayLine(top + h + i));
			}
			top = newTop;
			writeStatus();
		}

		/**
		 * 上方向のスクロール。Reverse Index（\x1bM）は、カーソルが最上行に
		 * あるときだけ逆方向へ1行スクロールし、最上行に空行を作る。
		 * 複数行分は、画面の下寄りに来る行から先に書く（後から挿す行ほど
		 * 上に押し出されるため、逆順で書くと最終的に上から正しい順に並ぶ）
		 */
		function scrollUp(newTop: number): void {
			const revealCount = top - newTop;
			out('\x1b[H');
			for (let i = revealCount - 1; i >= 0; i--) {
				out('\x1bM\r\x1b[K' + displayLine(newTop + i));
			}
			top = newTop;
			writeStatus();
		}

		function move(delta: number, strategy: 'redraw' | 'scroll' = 'scroll'): void {
			const newTop = clampTop(top + delta, virtualLength, pageHeight());
			// 端に達していて実際には動かないときは、何も描き直さない
			if (newTop === top) { return; }
			if (strategy === 'redraw') { top = newTop; render(); return; }
			if (newTop > top) { scrollDown(newTop); } else { scrollUp(newTop); }
		}

		function finish(code: number): void {
			resetScrollRegion();
			// 画面クリアはしない。反転表示のステータス行は消し、
			// 通常色（反転無し）の終了メッセージに置き換える。
			// コンソール状態を元へ戻す key.close() より先に書く
			// （先に戻すと、この書き込み自体が化ける・エスケープシーケンスが
			// そのまま文字として出る。実機で確認済み）
			out('\x1b[' + (pageHeight() + 1) + ';1H\x1b[2K-- less 終了 --\n');
			key.close();
			resolve(code);
		}

		// 1 回のイベントに複数キー分入ってくることがあるので、1 つずつ読む。
		// エスケープシーケンスの途中で切れたら、続きが来るまで持ち越す
		let pending = '';
		key.onData((chunk) => {
			pending += chunk;
			for (;;) {
				const used = handleKey(pending);
				if (used <= 0) { break; }
				pending = pending.substring(used);
			}
		});

		function handleKey(s: string): number {
			if (s.length === 0) { return 0; }
			if (s[0] === 'q' || s[0] === 'Q' || s[0] === '\x03') { finish(ExitOk); return s.length; }
			if (s[0] === ' ') { move(Math.round(pageHeight() * 3 / 4)); return 1; }
			if (s[0] === '\r' || s[0] === '\n') { move(1); return 1; }
			if (s.startsWith('\x1b[A')) { move(-1); return 3; }
			if (s.startsWith('\x1b[B')) { move(1); return 3; }
			if (s.startsWith('\x1b[5~')) { move(-Math.round(pageHeight() * 3 / 4)); return 4; }
			if (s.startsWith('\x1b[6~')) { move(Math.round(pageHeight() * 3 / 4)); return 4; }
			// ESC の直後で、続きがまだ来ていない可能性がある短い断片は待つ
			if (s[0] === '\x1b' && s.length < 4) { return 0; }
			return 1;   // 知らない入力は 1 文字読み捨てる
		}

		setScrollRegion();
		render();
	});
}

main(process.argv.slice(2)).then((code) => { process.exit(code); });
