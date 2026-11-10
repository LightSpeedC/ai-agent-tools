/*
	text の --to ・ --from が受ける名前を、convert-encoding と同じにする試験 (232-B、i260911-01 の 2)。

	- --to: 用途名 (ps1 cmd bat reg html)、文字コード (utf8 utf8bom sjis utf16le utf16be)、/lf ・ /crlf を足した形
	- 文字コードだけを渡したときは、改行を変えない (convert-encoding と同じ。既存のファイルの改行、無ければ中身のまま)
	- --from: 文字コードに加え、用途名も受ける

	期待値は、決めた仕様から先に手で書いた (実装の出力から作っていない)。
	process.execPath で src/text/main.ts を動かすので、bun でも node でも流せる。
*/
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..', '..');
const main = path.join(root, 'src', 'text', 'main.ts');
const work = path.join(root, 'tmp', 'text-names-tests');

let pass = 0;
let fail = 0;
function check(name: string, ok: boolean, detail: string = ''): void {
	if (ok) { pass++; console.log('  ✅ [OK] ' + name); }
	else { fail++; console.log('  ❌ [NG] ' + name + (detail ? '  ' + detail : '')); }
}
type Result = { code: number; out: string; err: string };
function text(args: string[]): Result {
	const r = spawnSync(process.execPath, [main, ...args], { cwd: work, encoding: 'utf8', timeout: 60000 });
	return { code: r.status ?? -1, out: (r.stdout ?? '').trim(), err: (r.stderr ?? '').trim() };
}
const f = (name: string): string => path.join(work, name);
const bytes = (name: string): Buffer => fs.readFileSync(f(name));
const hex = (b: Buffer): string => b.toString('hex');

fs.rmSync(work, { recursive: true, force: true });
fs.mkdirSync(work, { recursive: true });

console.log('\n[--to の名前 (232-B)]');
{
	const r = text(['write', f('a.txt'), '--to', 'utf8bom', 'あ\nい\n']);
	check('--to utf8bom を受ける (BOM 付き、改行は中身のまま LF)', r.code === 0 && hex(bytes('a.txt')) === 'efbbbf' + Buffer.from('あ\nい\n').toString('hex'), r.out + r.err);
	const s = text(['write', f('s.txt'), '--to', 'sjis', 'あ\r\n']);
	check('--to sjis を受ける (改行は中身のまま CRLF)', s.code === 0 && hex(bytes('s.txt')) === '82a00d0a', s.out + s.err);
	const u = text(['write', f('u.txt'), '--to', 'utf16le/crlf', 'a\n']);
	check('--to utf16le/crlf を受ける (BOM 付き UTF-16LE、改行を CRLF に)', u.code === 0 && hex(bytes('u.txt')) === 'fffe61000d000a00', u.out + u.err);
	const c = text(['write', f('c.txt'), '--to', 'utf8/crlf', 'a\nb\n']);
	check('--to utf8/crlf で改行を CRLF にする', c.code === 0 && bytes('c.txt').toString('utf8') === 'a\r\nb\r\n', c.out + c.err);
	fs.writeFileSync(f('keep.txt'), 'x\r\ny\r\n');
	const k = text(['write', f('keep.txt'), '--to', 'utf8', 'p\nq\n']);
	check('--to utf8 は、既存のファイルの改行 (CRLF) を保つ (convert-encoding と同じ)', k.code === 0 && bytes('keep.txt').toString('utf8') === 'p\r\nq\r\n', k.out + k.err);
	const p = text(['write', f('p.ps1'), '--to', 'ps1', 'a\n']);
	check('用途名 ps1 は今までどおり (BOM 付き UTF-8 ＋ CRLF)', p.code === 0 && hex(bytes('p.ps1')) === 'efbbbf610d0a', p.out + p.err);
	const ng = text(['write', f('n.txt'), '--to', 'euc', 'a']);
	check('知らない名前は終了コード 2 で、使える名前を出す', ng.code === 2 && (ng.out + ng.err).includes('utf8bom') && (ng.out + ng.err).includes('ps1'), ng.out + ng.err);
}

console.log('\n[--from の名前 (232-B)]');
{
	fs.writeFileSync(f('sj.cmd'), Buffer.from([0x82, 0xa0, 0x0d, 0x0a]));
	const r = text(['read', f('sj.cmd'), '--from', 'cmd']);
	check('--from に用途名 cmd を受ける (sjis として読む)', r.code === 0 && r.out.includes('あ') && r.out.includes('sjis'), r.out + r.err);
}

fs.rmSync(work, { recursive: true, force: true });
console.log(`\n=== text の名前: ${pass} 件成功 ・ ${fail} 件失敗 ===`);
process.exit(fail === 0 ? 0 : 1);
