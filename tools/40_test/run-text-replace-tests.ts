/*
	text replace (複数のファイルにまたがる一括置換) と text find --regex のテスト (課題 i261110-04)。
	- 228-B: 素の文字列と --regex。-i で大小を区別しない。--regex のとき、置き換える側で $1 ・ $& ・ $<名前> を使える
	- 229-A: 一致が 0 件なら終了コード 1
	- 230-A: --expect <件数> と合計が違えば、どのファイルも書き換えない (終了コード 6)
	- 文字コード ・ BOM ・ 改行を保つ (SJIS ・ UTF-16 も)。表せない文字があれば、どのファイルも書き換えない (終了コード 5)

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
const work = path.join(root, 'tmp', 'text-replace-tests');

let pass = 0;
let fail = 0;
function check(name: string, ok: boolean, detail: string = ''): void {
	if (ok) { pass++; console.log('  ✅ [OK] ' + name); }
	else { fail++; console.log('  ❌ [NG] ' + name + (detail ? '  ' + detail : '')); }
}

type Result = { code: number; out: string; err: string };
function text(args: string[], cwd: string = work): Result {
	const r = spawnSync(process.execPath, [main, ...args], { cwd, encoding: 'utf8', timeout: 60000 });
	return { code: r.status ?? -1, out: (r.stdout ?? '').trim(), err: (r.stderr ?? '').trim() };
}

const Bom = Buffer.from([0xef, 0xbb, 0xbf]);
function put(rel: string, bytes: Buffer): string {
	const full = path.join(work, rel);
	fs.mkdirSync(path.dirname(full), { recursive: true });
	fs.writeFileSync(full, bytes);
	return full;
}
const bytesOf = (rel: string): Buffer => fs.readFileSync(path.join(work, rel));
const utf8 = (rel: string): string => bytesOf(rel).toString('utf8');

/** 材料を作り直す。SJIS と UTF-16 は text write で書く (このテストで文字コードの表を持たない) */
function setup(): void {
	fs.rmSync(work, { recursive: true, force: true });
	fs.mkdirSync(work, { recursive: true });
	put('a/one.md', Buffer.from('[[旧名]] と [[旧名]]\n他の行\n', 'utf8'));
	put('a/two.md', Buffer.concat([Bom, Buffer.from('先頭 [[旧名]]\r\n[[旧名|別名]]\r\n', 'utf8')]));
	put('a/sub/three.md', Buffer.from('[[旧名]]\n', 'utf8'));
	put('a/skip.txt', Buffer.from('[[旧名]]\n', 'utf8'));
	put('a/tmp/ignored.md', Buffer.from('[[旧名]]\n', 'utf8'));
	put('b/plain.txt', Buffer.from('a.c abc ABC\n', 'utf8'));
	put('b/num.txt', Buffer.from('v1.2 と v3.4\n', 'utf8'));
	fs.mkdirSync(path.join(work, 'c'), { recursive: true });
	const sj = text(['write', path.join(work, 'c', 'sj.cmd'), '--to', 'cmd', 'echo 旧名です\r\necho 2 行目\r\n']);
	const u16 = text(['write', path.join(work, 'c', 'u16.reg'), '--to', 'reg', '"Name"="旧名"\r\n']);
	if (sj.code !== 0 || u16.code !== 0) {
		console.log('[NG] 材料を作れません: ' + sj.err + ' / ' + u16.err);
		process.exit(2);
	}
}

// ---- text find --regex ----

console.log('\n[text find --regex]');
setup();
{
	const plain = text(['find', 'a.c', path.join(work, 'b'), '--bare']);
	check('--regex なしでは、. を文字として探す (a.c の 1 行だけ。abc の行は同じ行)', plain.code === 0 && plain.out.split('\n').length === 1, plain.out + plain.err);
	const re = text(['find', 'v\\d\\.\\d', path.join(work, 'b'), '--regex', '--bare']);
	check('--regex で正規表現として探す (num.txt に当たる)', re.code === 0 && re.out.includes('num.txt:1:'), re.out + re.err);
	const none = text(['find', 'v\\d\\.\\d', path.join(work, 'b'), '--bare']);
	check('--regex なしでは、同じ語が文字のまま探されて当たらない (終了コード 1)', none.code === 1, none.out + none.err);
	const ci = text(['find', 'a[b]c', path.join(work, 'b'), '--regex', '-i', '--bare']);
	check('--regex と -i を合わせられる', ci.code === 0 && ci.out.includes('plain.txt:1:'), ci.out + ci.err);
	const bad = text(['find', '(', path.join(work, 'b'), '--regex']);
	check('正規表現が読めなければ、終了コード 2 で理由を出す', bad.code === 2 && bad.err.length > 0, bad.out + bad.err);
}

// ---- text replace (素の文字列) ----

console.log('\n[text replace 素の文字列]');
setup();
{
	const r = text(['replace', '[[旧名', '[[新名', '--path', path.join(work, 'a'), '-r', '--include', '*.md']);
	check('終了コード 0', r.code === 0, r.out + r.err);
	check('1 ファイルの中の一致を全部置き換える', utf8('a/one.md') === '[[新名]] と [[新名]]\n他の行\n', utf8('a/one.md'));
	check('-r で下の階層も置き換える', utf8('a/sub/three.md') === '[[新名]]\n', utf8('a/sub/three.md'));
	check('--include に合わないファイルは触らない', utf8('a/skip.txt') === '[[旧名]]\n');
	check('既定で外すフォルダ (tmp) は触らない', utf8('a/tmp/ignored.md') === '[[旧名]]\n');
	check('BOM と CRLF を保つ', bytesOf('a/two.md').equals(Buffer.concat([Bom, Buffer.from('先頭 [[新名]]\r\n[[新名|別名]]\r\n', 'utf8')])), JSON.stringify(utf8('a/two.md')));
	check('ファイルごとの件数を出す', /one\.md.*2 件/.test(r.out) && /two\.md.*2 件/.test(r.out) && /three\.md.*1 件/.test(r.out), r.out);
	check('合計の件数とファイルの数を出す', r.out.includes('合計 5 件') && r.out.includes('3 ファイル'), r.out);
	check('[[ を正規表現として読まない (素の文字列)', !r.err.includes('正規表現'), r.err);
}
{
	const sj = text(['replace', '旧名', '新名', '--path', path.join(work, 'c')]);
	const back = text(['read', path.join(work, 'c', 'sj.cmd'), '--no-number']);
	check('SJIS のファイルも置き換える', sj.code === 0 && back.out.includes('echo 新名です'), sj.out + sj.err + ' / ' + back.out);
	check('SJIS ・ CRLF のまま書き戻す', text(['read', path.join(work, 'c', 'sj.cmd')]).out.includes('sjis/crlf'), text(['read', path.join(work, 'c', 'sj.cmd')]).out);
	const u = text(['read', path.join(work, 'c', 'u16.reg')]);
	check('UTF-16 のファイルも、UTF-16 のまま置き換える', u.out.includes('"Name"="新名"') && /utf16/.test(u.out), u.out);
}

console.log('\n[--dry-run ・ 0 件 ・ -i]');
setup();
{
	const before = utf8('a/one.md');
	const d = text(['replace', '[[旧名', '[[新名', '--path', path.join(work, 'a'), '-r', '--include', '*.md', '--dry-run']);
	check('--dry-run は書き換えない', d.code === 0 && utf8('a/one.md') === before, d.out + d.err);
	check('--dry-run でも、ファイルごとの件数と合計を出す', /one\.md.*2 件/.test(d.out) && d.out.includes('合計 5 件'), d.out);
	check('--dry-run は、変わる行の前と後を出す', d.out.includes('[[旧名]] と [[旧名]]') && d.out.includes('[[新名]] と [[新名]]'), d.out);
	check('--dry-run であることを出す', d.out.includes('dry-run'), d.out);
	const z = text(['replace', '無い語', 'x', '--path', path.join(work, 'a'), '-r']);
	check('一致が 0 件なら、終了コード 1 で 0 件と出す (229-A)', z.code === 1 && (z.out + z.err).includes('0 件'), z.out + z.err);
	const i = text(['replace', 'abc', 'X', '--path', path.join(work, 'b'), '-i', '--include', 'plain.txt']);
	check('-i で大小を区別しない (abc と ABC の 2 件)', i.code === 0 && utf8('b/plain.txt') === 'a.c X X\n', utf8('b/plain.txt') + i.err);
}

console.log('\n[--regex (228-B)]');
setup();
{
	const r = text(['replace', 'v(\\d)\\.(\\d)', 'v$1-$2', '--path', path.join(work, 'b'), '--regex', '--include', 'num.txt']);
	check('--regex で、置き換える側の $1 ・ $2 を使える', r.code === 0 && utf8('b/num.txt') === 'v1-2 と v3-4\n', utf8('b/num.txt') + r.err);
	setup();
	const n = text(['replace', 'v(?<a>\\d)', '[$<a>|$&]', '--path', path.join(work, 'b'), '--regex', '--include', 'num.txt']);
	check('$<名前> と $& も使える', n.code === 0 && utf8('b/num.txt') === '[1|v1].2 と [3|v3].4\n', utf8('b/num.txt') + n.err);
	setup();
	const lit = text(['replace', 'v1', '$1$$', '--path', path.join(work, 'b'), '--include', 'num.txt']);
	check('--regex なしでは、置き換える側の $ はそのまま書く', lit.code === 0 && utf8('b/num.txt') === '$1$$.2 と v3.4\n', utf8('b/num.txt') + lit.err);
	setup();
	const ci = text(['replace', 'a(b)c', '<$1>', '--path', path.join(work, 'b'), '--regex', '-i', '--include', 'plain.txt']);
	check('--regex と -i を合わせられる', ci.code === 0 && utf8('b/plain.txt') === 'a.c <b> <B>\n', utf8('b/plain.txt') + ci.err);
	const bad = text(['replace', '(', 'x', '--path', path.join(work, 'b'), '--regex']);
	check('正規表現が読めなければ、終了コード 2', bad.code === 2, bad.out + bad.err);
	setup();
	const anc = text(['replace', '^(他の行)$', '[$1]', '--path', path.join(work, 'a', 'one.md'), '--regex']);
	check('--regex の ^ と $ は、行の頭と終わりに当たる (find と同じ)', anc.code === 0 && utf8('a/one.md') === '[[旧名]] と [[旧名]]\n[他の行]\n', utf8('a/one.md') + anc.out + anc.err);
}

console.log('\n[--expect (230-A) ・ 表せない文字]');
setup();
{
	const before = utf8('a/one.md');
	const ng = text(['replace', '[[旧名', '[[新名', '--path', path.join(work, 'a'), '-r', '--include', '*.md', '--expect', '4']);
	check('--expect と合計が違えば、終了コード 6', ng.code === 6, ng.out + ng.err);
	check('--expect と違えば、どのファイルも書き換えない', utf8('a/one.md') === before && utf8('a/sub/three.md') === '[[旧名]]\n', utf8('a/one.md'));
	check('--expect と違えば、期待と実際の件数を出す', (ng.out + ng.err).includes('4') && (ng.out + ng.err).includes('5'), ng.out + ng.err);
	const ok = text(['replace', '[[旧名', '[[新名', '--path', path.join(work, 'a'), '-r', '--include', '*.md', '--expect', '5']);
	check('--expect と合えば書き換える', ok.code === 0 && utf8('a/one.md').startsWith('[[新名]]'), ok.out + ok.err);
}
setup();
{
	const before = utf8('a/one.md');
	const r = text(['replace', '旧名', '😀', '--path', work, '-r', '--include', '*.md,*.cmd']);
	check('変換先で表せない文字があれば、終了コード 5', r.code === 5, r.out + r.err);
	check('表せない文字があれば、ほかのファイル (UTF-8) も書き換えない', utf8('a/one.md') === before, utf8('a/one.md'));
	check('どのファイルで表せないかを出す', (r.out + r.err).includes('sj.cmd'), r.out + r.err);
}

fs.rmSync(work, { recursive: true, force: true });
console.log(`\n=== text replace: ${pass} 件成功 ・ ${fail} 件失敗 ===`);
process.exit(fail === 0 ? 0 : 1);
