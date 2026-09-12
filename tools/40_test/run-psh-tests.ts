/*
	psh のテスト。

	PowerShell ツールが使えない環境で powershell を呼ぶための当て木を確かめる。
	bun でも node でも走る（どちらも .ts をそのまま実行できる）。

	ここだけ ps1 でなく ts で書いている。psh 自体が
	「PowerShell を呼ぶ道具」なので、テストまで ps1 にすると
	道具が壊れたときにテストも動かせなくなる。
*/

import { spawnSync } from 'node:child_process';
import * as path from 'node:path';
import * as fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..', '..');
const tool = path.join(root, 'src', 'psh', 'main.ts');
const cases = path.join(root, 'tests', 'psh');

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

function assertTrue(name: string, value: boolean, detail: string): void {
	if (value) { ok(name); } else { ng(name, detail); }
}

function assertEqual(name: string, expected: unknown, actual: unknown): void {
	if (expected === actual) { ok(name); }
	else { ng(name, '期待 ' + String(expected) + ' / 実際 ' + String(actual)); }
}

/** pwsh（7）が入っているか。無い環境ではその分を確かめない */
function hasPwsh(): boolean {
	const r = spawnSync('pwsh', ['-NoProfile', '-Command', '1'], { encoding: 'utf8' });
	return r.error == null && r.status === 0;
}

/** psh を、いま走っている処理系でそのまま呼ぶ。 */
function run(args: string[]): { code: number; out: string; err: string } {
	const runner = process.argv[0];
	const r = spawnSync(runner, [tool, ...args], { encoding: 'utf8' });
	return { code: r.status ?? -1, out: r.stdout ?? '', err: r.stderr ?? '' };
}

console.log('');
console.log('=== psh のテスト ===');
console.log('');

if (!fs.existsSync(tool)) {
	console.log('  [NG] psh の本体がありません: src/psh/main.ts');
	process.exit(2);
}

// 1. ps1 を実行し、日本語が化けずに返る
let r = run([path.join(cases, 'hello.ps1')]);
assertEqual('1 終了コード', 0, r.code);
assertTrue('1 日本語が化けない', r.out.includes('日本語の出力です'), JSON.stringify(r.out.slice(0, 60)));

// 2. 引数が渡る。空白を含む引数も 1 つのまま届く
r = run([path.join(cases, 'hello.ps1'), '空白を 含む 値', 'ふたつめ']);
assertTrue('2 空白を含む引数が割れない', r.out.includes('第 1 引数: 空白を 含む 値'), JSON.stringify(r.out.slice(0, 120)));
assertTrue('2 第 2 引数も届く', r.out.includes('第 2 引数: ふたつめ'), JSON.stringify(r.out.slice(0, 120)));

// 3. 終了コードを素通しする。標準エラーの日本語も化けない
r = run([path.join(cases, 'fail.ps1')]);
assertEqual('3 終了コードが素通しされる', 3, r.code);
assertTrue('3 標準エラーが化けない', r.err.includes('失敗しました'), JSON.stringify(r.err.slice(0, 60)));

// 4. --command で式を実行できる
r = run(['--command', 'Write-Host "式からの日本語"']);
assertEqual('4 終了コード', 0, r.code);
assertTrue('4 式の日本語が化けない', r.out.includes('式からの日本語'), JSON.stringify(r.out.slice(0, 60)));

// 7. --command の短縮として -c を受ける（sh -c ・ bash -c と同じ慣習）
r = run(['-c', 'Write-Host "短いオプション"']);
assertEqual('7 -c の終了コード', 0, r.code);
assertTrue('7 -c で式が動く', r.out.includes('短いオプション'), JSON.stringify(r.out.slice(0, 60)));

// 8. 既定は powershell（5.1）。pwsh（7）は --pwsh を書いたときだけ。
//    5.1 を既定にするのは、ps1 を 5.1 で動くように書く決めがあるため。
//    厳しい側で動かさないと、7 でしか通らない書き方に気づけない。
//    速さの面でも 5.1 が有利（実測 185ms 対 285ms。7 は .NET Core の起動コストが乗る）
r = run(['-c', '$PSVersionTable.PSVersion.Major']);
assertEqual('8 既定は 5.1', '5', r.out.trim());

if (hasPwsh()) {
	r = run(['--pwsh', '-c', '$PSVersionTable.PSVersion.Major']);
	assertEqual('8 --pwsh なら 7', '7', r.out.trim());
	r = run(['--pwsh', path.join(cases, 'hello.ps1')]);
	assertTrue('8 --pwsh でも ps1 を実行できる', r.out.includes('日本語の出力です'), JSON.stringify(r.out.slice(0, 60)));
} else {
	console.log('  [--] 8 --pwsh は pwsh が無いので確かめない');
}

// 5. PowerShell 自身の出力（UTF-8）と、そこから呼んだ .NET 製 exe の出力（CP932）が
//    同じ実行に混ざっても、どちらも読める。これが実際に困っていた形
r = run([path.join(cases, 'callexe.ps1')]);
assertEqual('5 終了コード', 0, r.code);
assertTrue('5 PowerShell 側の日本語が読める', r.out.includes('ここは PowerShell の出力です'), JSON.stringify(r.out.slice(0, 80)));
assertTrue('5 exe 側の日本語が読める', r.out.includes('ファイルの文字コードと改行を変換します'), JSON.stringify(r.out.slice(0, 200)));

// 6. 対象が無ければ 2 で止める（黙って成功しない）
r = run([path.join(cases, 'nothing-here.ps1')]);
assertEqual('5 ファイルが無ければ 2', 2, r.code);

// 6. 引数が無ければ使い方を出して 2
r = run([]);
assertEqual('6 引数なしは 2', 2, r.code);

/*
	7. --help ・ -h で使い方を出して 0 で終わる

	ほかの 3 つ（html2md ・ text ・ convert-encoding）は --help と -h に
	対応している。psh だけ対応しておらず、ps1 のパスとして扱われて
	「ファイルが見つかりません」で 2 になっていた。
	**求めたものが出たのだから 0 で終わる。**
*/
for (const flag of ['--help', '-h']) {
	r = run([flag]);
	assertEqual('7 ' + flag + ' は 0 で終わる', 0, r.code);
	assertTrue(
		'7 ' + flag + ' は使い方を出す',
		r.out.includes('psh <path.ps1>') || r.err.includes('psh <path.ps1>'),
		JSON.stringify((r.out + r.err).slice(0, 200)),
	);
}

console.log('');
if (fail === 0) {
	console.log('=== ' + pass + ' 件すべて成功 ===');
	process.exit(0);
} else {
	console.log('=== ' + fail + ' 件失敗（成功 ' + pass + ' 件）===');
	process.exit(1);
}
