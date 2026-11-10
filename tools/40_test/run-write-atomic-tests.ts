/*
	共通の書き込み (src/lib/write-atomic.ts) の試験 (243-A、i260908-03)。

	- 一時ファイルに書いてから置き換える。書き終えたら一時ファイルは残らない
	- 置き換えに失敗したら、一時ファイルを残さず、元のファイルも変えない
	- html2md ・ history2html ・ text ・ convert-encoding が、この 1 つを使う

	期待値は、決めた仕様から先に手で書いた (実装の出力から作っていない)。
*/
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeAtomic } from '../../src/lib/write-atomic.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..', '..');
const work = path.join(root, 'tmp', 'write-atomic-tests');

let pass = 0;
let fail = 0;
function check(name: string, ok: boolean, detail: string = ''): void {
	if (ok) { pass++; console.log('  ✅ [OK] ' + name); }
	else { fail++; console.log('  ❌ [NG] ' + name + (detail ? '  ' + detail : '')); }
}

fs.rmSync(work, { recursive: true, force: true });
fs.mkdirSync(work, { recursive: true });
const names = (): string[] => fs.readdirSync(work).sort();

console.log('\n[共通の書き込み (243-A)]');
{
	const p = path.join(work, 'a.md');
	writeAtomic(p, Buffer.from('一\n'));
	check('新しいファイルを書く', fs.readFileSync(p, 'utf8') === '一\n');
	writeAtomic(p, Buffer.from('二\n'));
	check('既にあるファイルを置き換える', fs.readFileSync(p, 'utf8') === '二\n');
	check('一時ファイルを残さない', JSON.stringify(names()) === JSON.stringify(['a.md']), JSON.stringify(names()));
}
{
	// 置き換え先がフォルダだと rename が失敗する
	const d = path.join(work, 'dir.md');
	fs.mkdirSync(d);
	let threw = false;
	try { writeAtomic(d, Buffer.from('x')); } catch { threw = true; }
	check('置き換えに失敗したら、例外を投げる', threw);
	check('置き換えに失敗しても、一時ファイルを残さない', JSON.stringify(names()) === JSON.stringify(['a.md', 'dir.md']), JSON.stringify(names()));
}

console.log('\n[各道具が共通の書き込みを使う]');
for (const rel of ['src/html2md/write-file.ts', 'src/history2html/output.ts', 'src/text/files.ts', 'src/convert-encoding/main.ts']) {
	const src = fs.readFileSync(path.join(root, rel), 'utf8');
	check(rel + ' は lib/write-atomic を使う', src.includes("lib/write-atomic.ts'"), '');
	check(rel + ' は renameSync を自前で持たない', !src.includes('renameSync'), '');
}

fs.rmSync(work, { recursive: true, force: true });
console.log(`\n=== 共通の書き込み: ${pass} 件成功 ・ ${fail} 件失敗 ===`);
process.exit(fail === 0 ? 0 : 1);
