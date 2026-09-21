/*
	psls のテスト。

	bun:ffi でプロセスを直接列挙するため、本物のプロセス一覧（実行のたびに
	変わる）を相手にする黒箱テストになる。自分自身（今このテストを走らせて
	いる bun／node）が確実に存在することを利用して、キーワード絞り込みの
	検証に使う（計画 notes/10_plan/p260921-01-プロセス一覧.html を参照）。

	psls は bun:ffi 必須で node では動かせない。node で走らせたときは
	「bun が必要です」で終わることだけを確認する。
*/

import { spawnSync } from 'node:child_process';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..', '..');
const tool = path.join(root, 'src', 'process-list', 'psls-main.ts');

let pass = 0;
let fail = 0;

function ok(name: string): void {
	pass++;
	console.log('  [OK] ' + name);
}

function ng(name: string, detail: string): void {
	fail++;
	console.log('  [NG] ' + name + '  ' + detail);
}

function assertEqual(name: string, expected: unknown, actual: unknown): void {
	if (expected === actual) { ok(name); }
	else { ng(name, '期待 ' + JSON.stringify(expected) + ' / 実際 ' + JSON.stringify(actual)); }
}

function assertTrue(name: string, value: boolean, detail: string): void {
	if (value) { ok(name); } else { ng(name, detail); }
}

/** psls を、いま走っている処理系でそのまま呼ぶ */
function run(args: string[]): { code: number; out: string; err: string } {
	const runner = process.argv[0];
	const r = spawnSync(runner, [tool, ...args], { encoding: 'utf8' });
	return { code: r.status ?? -1, out: r.stdout ?? '', err: r.stderr ?? '' };
}

const isBun = typeof Bun !== 'undefined';

console.log('');
console.log('=== psls のテスト ===');
console.log('');

// --help はどちらの処理系でも先に判定する（Bun が無くても使い方は見える）
{
	const r = run(['--help']);
	assertEqual('--help は 0 で終わる', 0, r.code);
	assertTrue('--help は使い方を出す', r.out.includes('プロセス一覧をツリー表示する'), r.out);
}

if (!isBun) {
	// node には bun:ffi の代わりが無いため、ここで終わることだけ確認する
	const r = run([]);
	assertEqual('node では bun が必要です、で終わる', 3, r.code);
	assertTrue('node では要る旨のメッセージを出す', r.err.includes('Bun が必要です'), r.err);
} else {
	// 知らないオプション
	{
		const r = run(['--nothing']);
		assertEqual('知らないオプションは 2', 2, r.code);
	}

	// キーワード無指定: 何か1行以上は出る（実行環境に依存するので本数は見ない）
	{
		const r = run([]);
		assertEqual('キーワード無指定: 終了 0', 0, r.code);
		assertTrue('キーワード無指定: 1行以上出る', r.out.trim().length > 0, r.out.slice(0, 200));
	}

	// キーワード絞り込み: 自分自身（bun）は確実に実行中なので、絞り込んでも1行以上出る
	{
		const r = run(['bun']);
		assertEqual('bun で絞り込み: 終了 0', 0, r.code);
		assertTrue('bun で絞り込み: 該当行が出る', r.out.trim().length > 0, r.out.slice(0, 200));
	}

	// 絞り込みは大小文字を区別しない
	{
		const lower = run(['bun']);
		const upper = run(['BUN']);
		assertEqual('大小文字を区別しない: 行数が一致', lower.out.split('\n').length, upper.out.split('\n').length);
	}

	// 一致した行は反転ではなく太字（\x1b[1m）で強調する
	{
		const r = run(['bun']);
		assertTrue('一致した行を太字にする', r.out.includes('\x1b[1m'), r.out.slice(0, 200));
	}

	// 出力の各行が期待する形式（pid 開始時刻 (経過時間) exe ...）に一致する
	// （同名別パスの exe があれば末尾に対応表（legend）が付くので、それは除く）
	{
		const r = run([]);
		const lines = r.out.split('\n').filter((l) => l.trim().length > 0);
		// プロセスの行は必ず pid（数字）で始まる。対応表（legend）はファイル名で始まるので区別できる
		const processLines = lines.filter((l) => /^\s*\d/.test(l.replace(/\x1b\[\d+m/g, '')));
		// exe のフルパスには空白を含むことがある（"C:\Program Files\..." 等）ため、
		// exe 自体は \S+ で区切らず、経過時間の後に何か文字が続くことだけ確かめる
		const linePattern = /^\s*\d+\s+(-|\d{4}\/\d{2}\/\d{2} \d{2}:\d{2}:\d{2})\s+\([^)]*\)\s+\S/;
		const bad = processLines.filter((l) => !linePattern.test(l.replace(/\x1b\[\d+m/g, '')));
		assertEqual('各行が pid 開始時刻 (経過時間) exe の形式に一致する', 0, bad.length);
	}

	// exe 欄は既定でファイル名のみ、--full-path でフルパスになる
	// （コマンドライン欄には元々フルパスが写ることがあるので、exe 欄だけを見る）
	{
		const stripAnsi = (s: string) => s.replace(/\x1b\[\d+m/g, '');
		const exeColumn = (line: string) => {
			// "<pid>  <時刻> <経過時間>  <メモリ>  <exe>  <罫線+コマンド>" の exe だけを取り出す
			const m = stripAnsi(line).match(/^\s*\d+\s+\S+(?: \S+)?\s+\([^)]*\)\s+\S+\s+(.+?)\s{2}/);
			return m ? m[1] : '';
		};
		const withoutFull = run([]).out.split('\n').filter((l) => /^\s*\d/.test(stripAnsi(l)));
		const withFull = run(['--full-path']).out.split('\n').filter((l) => /^\s*\d/.test(stripAnsi(l)));
		assertTrue('既定の exe 欄にフルパスを含む行が無い', withoutFull.every((l) => !exeColumn(l).includes('\\')), withoutFull.find((l) => exeColumn(l).includes('\\')) ?? '');
		assertTrue('--full-path の exe 欄にフルパスを含む行がある', withFull.some((l) => exeColumn(l).includes('\\')), withFull[0] ?? '');
	}

	// 物理メモリ使用量が B・K・M・G のいずれかの単位で出る（取得できなければ -）
	{
		const stripAnsi = (s: string) => s.replace(/\x1b\[\d+m/g, '');
		const r = run([]);
		const lines = r.out.split('\n').filter((l) => /^\s*\d/.test(stripAnsi(l)));
		const memPattern = /^\s*\d+\s+(-|\d{4}\/\d{2}\/\d{2} \d{2}:\d{2}:\d{2})\s+\([^)]*\)\s+(-|\d+(\.\d)?[BKMG])\s/;
		const bad = lines.filter((l) => !memPattern.test(stripAnsi(l)));
		assertEqual('各行の物理メモリ欄が期待する形式に一致する', 0, bad.length);
	}

	// --no-trim は正常に終了する
	{
		const r = run(['--no-trim']);
		assertTrue('--no-trim は正常終了する', r.code === 0, String(r.code));
	}

	// コンソールの VT モード（ENABLE_VIRTUAL_TERMINAL_PROCESSING）を
	// 実行前後で変えない（変える／戻すのは enableWindowsConsoleVt()）。
	// 実機のコンソールにアタッチしているときだけ意味のある検証になる。
	// パイプ経由（このテスト自体が spawnSync で出力を捕まえている run()
	// 経由）では無関係な経路を通るため、ここだけ stdio を 'inherit' にして
	// 実際のコンソールへ直接書かせる。
	// notes/10_plan/i260917-01-less.html の「落とし穴（8）」を参照
	{
		const getVtMode = async (): Promise<number | null> => {
			try {
				const { dlopen, FFIType, ptr } = await import('bun:ffi');
				const { symbols: k32 } = dlopen('kernel32.dll', {
					GetStdHandle: { args: [FFIType.i32], returns: FFIType.ptr },
					GetConsoleMode: { args: [FFIType.ptr, FFIType.ptr], returns: FFIType.i32 },
				});
				const h = k32.GetStdHandle(-11);
				if (!h) { return null; }
				const buf = new Uint8Array(4);
				if (!k32.GetConsoleMode(h, Number(ptr(buf)))) { return null; }
				return new DataView(buf.buffer).getUint32(0, true);
			} catch {
				return null;
			}
		};
		const before = await getVtMode();
		// キーワードは一致しないものにして、出力を最小限にする
		spawnSync(process.argv[0], [tool, 'zzz_no_such_process_zzz'], { stdio: 'inherit' });
		const after = await getVtMode();
		if (before == null || after == null) {
			ok('VT モードの前後比較（このコンソールでは検証できないため飛ばす）');
		} else {
			assertEqual('実行前後でコンソールの VT モードが変わらない', before, after);
		}
	}
}

console.log('');
if (fail === 0) {
	console.log('=== ' + pass + ' 件すべて成功 ===');
	process.exit(0);
} else {
	console.log('=== ' + fail + ' 件失敗（成功 ' + pass + ' 件）===');
	process.exit(1);
}
