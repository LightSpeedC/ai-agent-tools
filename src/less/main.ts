/*
	less — UTF-8 セーフなページャー。

	DOS の more へ UTF-8 の出力をパイプすると、CP932 として読まれて
	文字化けする（i260912-06 と根が同じ、出力コードページ問題の受け手側）。
	標準入力を読み、画面に収まる分だけ表示してキー操作を待つ。

	計画: notes/10_plan/i260917-01-less.html
*/

import * as fs from 'node:fs';
import * as tty from 'node:tty';
import { parseArgs } from '../lib/args.ts';

const ExitOk = 0;
const ExitBadArgs = 2;

const Usage =
	'UTF-8 セーフなページャー（DOS more の文字化けを避ける）\n'
	+ '\n'
	+ '  <コマンド> | less\n'
	+ '\n'
	+ '  q          終了\n'
	+ '  Space      1 画面分下\n'
	+ '  Enter・↓   1 行下\n'
	+ '  ↑          1 行上\n'
	+ '  PageDown   画面の高さの 2/3 くらい下\n'
	+ '  PageUp     画面の高さの 2/3 くらい上\n'
	+ '\n'
	+ '  --help     この説明を表示する\n'
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

/** 標準入力を全部読み切る（戻りスクロールのため、全行をメモリに持つ） */
function readStdin(): Promise<string> {
	return new Promise((resolve, reject) => {
		const chunks: Buffer[] = [];
		process.stdin.on('data', (c: Buffer) => { chunks.push(c); });
		process.stdin.on('end', () => { resolve(Buffer.concat(chunks).toString('utf8')); });
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

	const keyStream = openKeyStream();
	if (keyStream == null) {
		// コンソール入力を開けない環境では、操作を諦めて素通しにする
		out(lines.join('\n') + (lines.length > 0 ? '\n' : ''));
		return ExitOk;
	}

	return page(lines, keyStream);
}

/**
 * キー入力の取得元を開く。標準入力はパイプのデータで埋まっている
 * （cmd | less の形）ため使えない。Windows のコンソール入力は
 * CONIN$（自プロセスのコンソール入力バッファを指す予約名）で
 * 直接開ける。開けなければ null を返す（コンソールが無い環境）。
 */
function openKeyStream(): tty.ReadStream | null {
	try {
		// 素の 'CONIN$' は Node がカレントフォルダからの相対パスとして
		// 解決してしまい、Windows の予約名として扱われない（実測で確認）。
		// Win32 のデバイス名前空間 \\.\ を付けると正しく開ける
		const fd = fs.openSync('\\\\.\\CONIN$', 'r');
		const stream = new tty.ReadStream(fd);
		if (!stream.isTTY) { return null; }
		return stream;
	} catch {
		return null;
	}
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

function page(lines: string[], key: tty.ReadStream): Promise<number> {
	return new Promise((resolve) => {
		let top = 0;

		function render(): void {
			const h = pageHeight();
			const view = lines.slice(top, top + h);
			out('\x1b[2J\x1b[H');
			out(view.join('\n'));
			if (view.length < h) { out('\n'.repeat(h - view.length)); }
			const shown = Math.min(top + h, lines.length);
			const pct = lines.length === 0 ? 100 : Math.round((shown / lines.length) * 100);
			out('\n\x1b[7m-- less (' + pct + '%) q で終了 --\x1b[0m');
		}

		function move(delta: number): void {
			top = clampTop(top + delta, lines.length, pageHeight());
			render();
		}

		function finish(code: number): void {
			key.setRawMode(false);
			key.removeAllListeners('data');
			key.pause();
			out('\x1b[2J\x1b[H');
			resolve(code);
		}

		// 1 回のイベントに複数キー分入ってくることがあるので、1 つずつ読む。
		// エスケープシーケンスの途中で切れたら、続きが来るまで持ち越す
		let pending = '';
		key.on('data', (chunk: string | Buffer) => {
			pending += chunk.toString('utf8');
			for (;;) {
				const used = handleKey(pending);
				if (used <= 0) { break; }
				pending = pending.substring(used);
			}
		});

		function handleKey(s: string): number {
			if (s.length === 0) { return 0; }
			if (s[0] === 'q' || s[0] === 'Q' || s[0] === '\x03') { finish(ExitOk); return s.length; }
			if (s[0] === ' ') { move(pageHeight()); return 1; }
			if (s[0] === '\r' || s[0] === '\n') { move(1); return 1; }
			if (s.startsWith('\x1b[A')) { move(-1); return 3; }
			if (s.startsWith('\x1b[B')) { move(1); return 3; }
			if (s.startsWith('\x1b[5~')) { move(-Math.round(pageHeight() * 2 / 3)); return 4; }
			if (s.startsWith('\x1b[6~')) { move(Math.round(pageHeight() * 2 / 3)); return 4; }
			// ESC の直後で、続きがまだ来ていない可能性がある短い断片は待つ
			if (s[0] === '\x1b' && s.length < 4) { return 0; }
			return 1;   // 知らない入力は 1 文字読み捨てる
		}

		key.setRawMode(true);
		key.resume();
		render();
	});
}

main(process.argv.slice(2)).then((code) => { process.exit(code); });
