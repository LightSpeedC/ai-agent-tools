/*
	html2md の書き出し（writeIfChanged）のテスト。

	再変換で、中身の変わらない .md ・ SVG まで書き直すと、更新日時が変わって
	git status で M になり、git update-index --refresh でも消えないことがあった（i261009-02）。
	書き出す前に既存のファイルとバイト列を比べ、同じならファイルに触らない。
*/
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeIfChanged } from '../../src/html2md/write-file.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const work = path.resolve(here, '..', '..', 'tmp', 'html2md-write-tests');

let pass = 0;
let fail = 0;
function check(name: string, ok: boolean, detail: string = ''): void {
	if (ok) { pass++; console.log('  [OK] ' + name); }
	else { fail++; console.log('  [NG] ' + name + (detail ? '  ' + detail : '')); }
}

const enc = new TextEncoder();
// 更新日時が変わったかを見るため、過去の時刻に固定してから書き直す
const past = new Date('2020-01-01T00:00:00Z');

console.log('');
console.log('=== html2md の書き出し（中身が同じなら触らない） ===');
fs.rmSync(work, { recursive: true, force: true });
fs.mkdirSync(work, { recursive: true });

const p = path.join(work, 'a.md');

check('ファイルが無ければ書く', writeIfChanged(p, enc.encode('あ\n')) === true && fs.readFileSync(p, 'utf8') === 'あ\n');

fs.utimesSync(p, past, past);
check('中身が同じなら書かず、false を返す', writeIfChanged(p, enc.encode('あ\n')) === false);
check('中身が同じなら更新日時が変わらない', fs.statSync(p).mtime.getTime() === past.getTime());

check('中身が違えば書く', writeIfChanged(p, enc.encode('い\n')) === true && fs.readFileSync(p, 'utf8') === 'い\n');
check('中身が違えば更新日時が変わる', fs.statSync(p).mtime.getTime() !== past.getTime());

// 長さだけ同じでバイト列が違う場合も書く（長さの比較だけで済ませていないこと）
fs.utimesSync(p, past, past);
check('同じ長さで中身が違えば書く', writeIfChanged(p, enc.encode('う\n')) === true && fs.readFileSync(p, 'utf8') === 'う\n');

fs.rmSync(work, { recursive: true, force: true });
console.log('');
console.log(fail === 0 ? '=== ' + pass + ' 件すべて成功 ===' : '=== ' + fail + ' 件失敗（成功 ' + pass + ' 件）===');
process.exit(fail === 0 ? 0 : 1);
