/*
	less のテスト。

	出力先が端末でない（spawnSync で捕まえるとそうなる）ときは
	ページングせず素通しする経路だけを自動で確かめる。実際のキー入力に
	よる画面遷移・CONIN$ が開けること自体は、対話が要るため自動化せず
	手動で確認する（計画 notes/10_plan/i260917-01-less.html を参照）。
*/

import { spawnSync } from 'node:child_process';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..', '..');
const tool = path.join(root, 'src', 'less', 'main.ts');

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

/** less を、いま走っている処理系でそのまま呼ぶ。標準出力はパイプで捕まえるため isTTY は false になる */
function run(args: string[], input: string): { code: number; out: string; err: string } {
	const runner = process.argv[0];
	const r = spawnSync(runner, [tool, ...args], { encoding: 'utf8', input });
	return { code: r.status ?? -1, out: r.stdout ?? '', err: r.stderr ?? '' };
}

console.log('');
console.log('=== less のテスト ===');
console.log('');

// --help
{
	const r = run(['--help'], '');
	assertEqual('--help は 0 で終わる', 0, r.code);
	assertTrue('--help は使い方を出す', r.out.includes('UTF-8 セーフなページャー'), r.out);
}

// 知らないオプション
{
	const r = run(['--nothing'], '');
	assertEqual('知らないオプションは 2', 2, r.code);
}

// 出力先が端末でないときは、ページングせずそのまま流す（バイト単位で一致すること）。
// この一致が、DOS more の文字化けを避けるという本題そのものの確認になる
{
	const input = '日本語テスト1行目\n2行目 → 特殊文字 ✅\n';
	const r = run([], input);
	assertEqual('素通し: 終了 0' , 0, r.code);
	assertEqual('素通し: UTF-8 のまま完全一致（文字化けしない）', input, r.out);
}

// 空入力
{
	const r = run([], '');
	assertEqual('空入力: 終了 0', 0, r.code);
	assertEqual('空入力: 出力も空', '', r.out);
}

// 改行の正規化（CRLF・CR 混在でも LF に揃えて出す。末尾の改行は1個だけ）
{
	const input = 'a\r\nb\rc\n';
	const r = run([], input);
	assertEqual('改行の混在を LF に揃える', 'a\nb\nc\n', r.out);
}

console.log('');
if (fail === 0) {
	console.log('=== ' + pass + ' 件すべて成功 ===');
	process.exit(0);
} else {
	console.log('=== ' + fail + ' 件失敗（成功 ' + pass + ' 件）===');
	process.exit(1);
}
