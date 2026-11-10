/*
	html2md が、UTF-8 として読めない入力の HTML を、化けたまま変換しないことの試験
	(i260908-03 の low「html2md は入力 html の文字コードを検査しない」)。

	- SJIS などで書かれた HTML は、終了コード 2 で止め、どのファイルかを出す
	- .md は書かない

	期待値は、決めた仕様から先に手で書いた (実装の出力から作っていない)。
	process.execPath で src/html2md/main.ts を動かすので、bun でも node でも流せる。
*/
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..', '..');
const main = path.join(root, 'src', 'html2md', 'main.ts');
const work = path.join(root, 'tmp', 'html2md-encoding-tests');

let pass = 0;
let fail = 0;
function check(name: string, ok: boolean, detail: string = ''): void {
	if (ok) { pass++; console.log('  ✅ [OK] ' + name); }
	else { fail++; console.log('  ❌ [NG] ' + name + (detail ? '  ' + detail : '')); }
}

fs.rmSync(work, { recursive: true, force: true });
fs.mkdirSync(path.join(work, 'notes'), { recursive: true });
// 「あ」を SJIS (82 A0) で書いた HTML。UTF-8 としては読めない
const head = Buffer.from('<!DOCTYPE html><html><head><meta charset="Shift_JIS"><title>t</title></head><body><div class="wrap"><p>', 'ascii');
const tail = Buffer.from('</p></div></body></html>\n', 'ascii');
fs.writeFileSync(path.join(work, 'notes', 'sjis.html'), Buffer.concat([head, Buffer.from([0x82, 0xa0]), tail]));

console.log('\n[UTF-8 として読めない入力]');
const r = spawnSync(process.execPath, [main, '--root', work, '--no-readme'], { encoding: 'utf8', timeout: 60000 });
const all = (r.stdout ?? '') + (r.stderr ?? '');
check('UTF-8 として読めない HTML は終了コード 2', r.status === 2, all);
check('どのファイルが読めないかを出す', all.includes('sjis.html') && all.includes('UTF-8'), all);
check('.md を書かない', !fs.existsSync(path.join(work, 'notes', 'sjis.md')));

fs.rmSync(work, { recursive: true, force: true });
console.log(`\n=== html2md の入力の文字コード: ${pass} 件成功 ・ ${fail} 件失敗 ===`);
process.exit(fail === 0 ? 0 : 1);
