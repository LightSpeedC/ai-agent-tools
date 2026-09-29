/*
	4 つのツールが node でも動くことを確かめる。

	ランチャー（html2md ・ text ・ convert-encoding ・ psh）は
	bun を優先し、無ければ node に落ちる。**bun でしか確かめていないと、
	bun の無い環境で初めて落ちる。**

	node は TypeScript を型注釈の除去だけで走らせる（strip-only）。
	型以上の意味を持つ構文は ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX になる。

	  ・引数に修飾子を付けて宣言を兼ねる書き方（parameter property）
	  ・enum ・ namespace ・ 実装を伴う overload

	いずれも**読み込みの時点で落ちる**ため、起動するだけで見つかる。
	実際に src/html2md/table.ts で 1 件踏んでいる（ベンチで node 版を
	走らせようとして発覚した。bun では通っていた）。

	ここだけ ps1 でなく ts で書いているのは、node を直に呼ぶため。
	テスト自身は bun で走ってよい（中で node を spawn する）。
*/

import { spawnSync } from 'node:child_process';
import * as path from 'node:path';
import * as fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..', '..');
const work = path.join(root, 'tmp', 'node-tests');

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

function assertTrue(name: string, value: boolean, detail: string): void {
	if (value) { ok(name); } else { ng(name, detail); }
}

/** node が入っているか。無い環境では確かめない */
function hasNode(): boolean {
	const r = spawnSync('node', ['--version'], { encoding: 'utf8' });
	return r.error == null && r.status === 0;
}

/** 本体のファイル名がフォルダ名と合わないもの。ほかは src/<ツール>/main.ts */
const MainFile: Record<string, string> = { psh: 'psh-main.ts' };

/** ツールを node で呼ぶ */
function runNode(tool: string, args: string[]): { code: number; out: string; err: string } {
	const main = path.join(root, 'src', tool, MainFile[tool] ?? 'main.ts');
	const r = spawnSync('node', [main, ...args], { encoding: 'utf8' });
	return { code: r.status ?? -1, out: r.stdout ?? '', err: r.stderr ?? '' };
}

console.log('');
console.log('=== node で動くかのテスト ===');
console.log('');

if (!hasNode()) {
	console.log('  node が入っていません。確かめられません');
	process.exit(1);
}

/*
	1. 読み込めるか

	strip-only で通らない構文があると、ここで
	ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX になって落ちる。
	終了コードは見ない（ツールごとに引数なしの扱いが違うため）。
	見るのは「TypeScript の構文で落ちていないこと」だけ。
*/
for (const tool of ['html2md', 'text', 'convert-encoding', 'psh']) {
	const r = runNode(tool, ['--help']);
	const broken = r.err.includes('ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX')
		|| r.err.includes('SyntaxError')
		|| r.err.includes('Cannot find module');
	assertTrue(
		tool + ' は node で読み込める',
		!broken,
		r.err.split('\n').slice(0, 3).join(' / '),
	);
}

/*
	2. 実際に動くか

	読み込めても、走らせて初めて出る食い違いがある。
	1 ファイルを変換して .md ができることまで見る。
*/
if (fs.existsSync(work)) { fs.rmSync(work, { recursive: true, force: true }); }
fs.mkdirSync(path.join(work, 'notes'), { recursive: true });
fs.copyFileSync(
	path.join(root, 'tests', 'cases', 'untagged', 'notes', 'untagged.html'),
	path.join(work, 'notes', 'untagged.html'),
);

const conv = runNode('html2md', ['--root', work, '--dir', 'notes']);
assertEqual('html2md は node で変換できる（終了コード 0）', 0, conv.code);
assertTrue(
	'html2md は node で .md を生成する',
	fs.existsSync(path.join(work, 'notes', 'untagged.md')),
	'notes/untagged.md ができていません',
);

// convert-encoding が判定を返せるか（--info は読むだけで書き換えない）
const info = runNode('convert-encoding', [path.join(work, 'notes', 'untagged.html'), '--info']);
assertEqual('convert-encoding は node で判定できる（終了コード 0）', 0, info.code);

// text が読めるか
const read = runNode('text', ['read', path.join(work, 'notes', 'untagged.html'), '--lines', '1-1']);
assertEqual('text は node で読める（終了コード 0）', 0, read.code);

fs.rmSync(work, { recursive: true, force: true });

console.log('');
if (fail === 0) {
	console.log('=== ' + pass + ' 件すべて成功 ===');
	process.exit(0);
} else {
	console.log('=== ' + fail + ' 件失敗 / ' + (pass + fail) + ' 件中 ===');
	process.exit(1);
}
