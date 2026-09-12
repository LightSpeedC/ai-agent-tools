/*
	check-contrast ・ check-markdown のテスト。

	この 2 つは PowerShell で書かれていたものを TypeScript へ移した。
	ps1 版は check-〜-ps.ps1 として突き合わせ用に残してある。

	見るのは 2 つ。

	  1. オプションの解釈（Linux 風の -- ・ 短縮形 ・ 位置引数、古い -Path）
	  2. ps1 版と同じ結果を返すか（対象の件数と終了コード）

	ブラウザと GitHub の API は使わない。空のフォルダを渡し、
	オプションが効いたかだけを見る。**API を叩くと回数制限に当たる。**

	bun でも node でも走る。中で呼ぶ側の処理系も、いま走っているものに合わせる。
*/

import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..', '..');
const work = path.join(root, 'tmp', 'check-tools-tests');

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
	else { ng(name, '期待 ' + String(expected) + ' / 実際 ' + String(actual)); }
}

function assertIncludes(name: string, needle: string, text: string): void {
	if (text.includes(needle)) { ok(name); }
	else { ng(name, '"' + needle + '" が出ない: ' + text.slice(0, 120).replace(/\r?\n/g, ' / ')); }
}

/** 移植版を、いま走っている処理系でそのまま呼ぶ */
function runTs(tool: string, args: string[]): { code: number; out: string } {
	const runner = process.argv[0];
	const main = path.join(root, 'src', tool, 'main.ts');
	const r = spawnSync(runner, [main, ...args], { encoding: 'utf8' });
	return { code: r.status ?? -1, out: (r.stdout ?? '') + (r.stderr ?? '') };
}

/** ps1 版を powershell で呼ぶ。突き合わせ用 */
function runPs(tool: string, args: string[]): { code: number; out: string } {
	const script = path.join(root, tool + '-ps.ps1');
	const r = spawnSync('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script, ...args], { encoding: 'utf8' });
	return { code: r.status ?? -1, out: (r.stdout ?? '') + (r.stderr ?? '') };
}

console.log('');
console.log('=== check ツールのテスト ===');
console.log('');

if (fs.existsSync(work)) { fs.rmSync(work, { recursive: true, force: true }); }
fs.mkdirSync(work, { recursive: true });

for (const tool of ['check-contrast', 'check-markdown']) {
	const ext = tool === 'check-contrast' ? '.html' : '.md';
	const empty = '対象の ' + ext + ' がありません';

	// 1. -- 形式で対象を渡せる
	let r = runTs(tool, ['--path', work]);
	assertEqual(tool + ' --path は 0 で終わる', 0, r.code);
	assertIncludes(tool + ' --path で対象が絞られる', empty, r.out);

	// 2. 短縮形（Linux 風）
	r = runTs(tool, ['-p', work]);
	assertIncludes(tool + ' -p は --path と同じ', empty, r.out);

	// 3. 位置引数。名前を付けずに置いた対象
	r = runTs(tool, [work]);
	assertIncludes(tool + ' 対象は名前なしでも渡せる', empty, r.out);

	// 4. 古い -Path 形式。共通ルールと他プロジェクトがこの形で書いている
	r = runTs(tool, ['-Path', work]);
	assertIncludes(tool + ' -Path も受ける', empty, r.out);

	// 5. -r ・ --recurse
	r = runTs(tool, ['-p', work, '-r']);
	assertIncludes(tool + ' -r は --recurse と同じ', empty, r.out);

	// 6. --help ・ -h は使い方を出して 0
	for (const flag of ['--help', '-h']) {
		r = runTs(tool, [flag]);
		assertEqual(tool + ' ' + flag + ' は 0 で終わる', 0, r.code);
		assertIncludes(tool + ' ' + flag + ' は使い方を出す', '--path', r.out);
	}

	// 7. 知らないオプションは 2 で止める。黙って既定値で走らない
	r = runTs(tool, ['--nonsense']);
	assertEqual(tool + ' 知らないオプションは 2', 2, r.code);

	// 8. 値を取るオプションに値が無ければ 2
	r = runTs(tool, ['--path']);
	assertEqual(tool + ' 値の無い --path は 2', 2, r.code);

	/*
		9. ps1 版と同じ結果か

		移植で落ちるのは処理の本体ではなく、比較や既定値の食い違い。
		同じ引数で呼んで、終了コードと「対象なし」の出方が揃うかを見る
	*/
	const ts = runTs(tool, ['--path', work]);
	const ps = runPs(tool, ['--path', work]);
	assertEqual(tool + ' ps1 版と終了コードが揃う', ps.code, ts.code);
	assertEqual(
		tool + ' ps1 版と「対象なし」の出方が揃う',
		ps.out.includes(empty),
		ts.out.includes(empty),
	);
}

fs.rmSync(work, { recursive: true, force: true });

console.log('');
if (fail === 0) {
	console.log('=== ' + pass + ' 件すべて成功 ===');
	process.exit(0);
}
console.log('=== ' + fail + ' 件失敗（成功 ' + pass + ' 件）===');
process.exit(1);
