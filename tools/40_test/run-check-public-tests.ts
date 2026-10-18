/*
	check-public のテスト。

	公開前に見るもの（個人名・メールアドレス・実体パス・認証情報・
	異体字の混入・除外語）を、資料を配る前に機械で拾えるかを確かめる。

	期待値は手で書いてある。**材料の何行目が当たるかを先に決めてから**
	実装した。出力から作ると、実装が何を出しても通るため。

	検出した値そのものは出力に載せない。出力は会話ログや CI のログに残る。
	**伏せるための道具が漏らす側にまわってはいけない。**
*/

import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..', '..');
const cases = path.join(root, 'tests', 'check-public');
const tool = path.join(root, 'src', 'check-public', 'main.ts');
const work = path.join(root, 'tmp', 'check-public-tests');

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

function run(args: string[]): { code: number; out: string } {
	const runner = process.argv[0];
	const r = spawnSync(runner, [tool, ...args], { encoding: 'utf8' });
	return { code: r.status ?? -1, out: (r.stdout ?? '') + (r.stderr ?? '') };
}

console.log('');
console.log('=== check-public のテスト ===');
console.log('');

// ---- 1. 当たらない材料は 0 ----
let r = run([path.join(cases, 'ok'), '--all']);
assertEqual('1 指摘の無いフォルダは 0', 0, r.code);
assertTrue('1 「指摘なし」と出る', r.out.includes('指摘はありません'), r.out.slice(0, 120));

// ---- 2. 当たる材料は 1 ----
r = run([path.join(cases, 'ng'), '--all']);
assertEqual('2 指摘のあるフォルダは 1', 1, r.code);

/*
	3. 4 つの項目がそれぞれ当たる

	材料（tests/check-public/ng/sample.md）に 1 つずつ置いてある。
	項目名で出ることまで見る。どれが当たったか分からないと直せない
*/
for (const label of ['メールアドレス', '実体パス', '認証情報', '異体字']) {
	assertTrue('3 ' + label + ' を拾う', r.out.includes(label), r.out.slice(0, 300));
}

// ---- 4. 値そのものを出さない ----
assertTrue(
	'4 当たった値を画面に出さない',
	!r.out.includes('taro.yamada') && !r.out.includes('8f3a9c2e') && !r.out.includes('tanaka'),
	'検出した値が出力に混ざっている',
);

// ---- 5. 伏せ字・変数参照は拾わない（誤検出） ----
assertTrue(
	'5 伏せ字と変数参照は拾わない',
	!r.out.includes('<username>') && !r.out.includes('USERNAME'),
	r.out.slice(0, 200),
);

/*
	6. 誤検出の件数まで見る

	材料には当たる書き方を 4 つ、当たらない書き方を 6 つ置いてある。
	**当たる件数が 4 を超えたら、当たらないはずのものを拾っている**
*/
const hitLines = r.out.split('\n').filter((l) => /sample\.md:\d+/.test(l));
assertEqual('6 当たるのは 4 箇所だけ', 4, hitLines.length);

/*
	6b. 拡張子で絞らない（i260913-01）

	拾う拡張子を並べる形にしていたため、.svg と拡張子を持たないファイルが
	外れていた。**図の中の文字も、sh のランチャーも、テキストで中身が読める。**
	外れていることは、出力を見ても分からない
*/
assertTrue('6b .svg も見る', r.out.includes('figure.svg:'), r.out.slice(0, 300));
assertTrue('6b 拡張子の無いファイルも見る', r.out.includes('launcher:'), r.out.slice(0, 300));

/*
	6c. 文字コードを判定できないファイルも見る

	BOM 無しで日本語を含むと、UTF-8 とも SJIS とも読めて判定できない。
	**変換なら書き換えずに止めるのが正しいが、検査では逆。**
	読める形があるのに飛ばすと、黙って漏れる。
	ambiguous.svg は convert-encoding が「判定できません」と返す材料
*/
assertTrue('6c 判定できないファイルも見る', r.out.includes('ambiguous.svg:'), r.out.slice(0, 400));

// ---- 7. --skip で項目を外せる ----
r = run([path.join(cases, 'ng'), '--all', '--skip', 'mail', '--skip', 'path', '--skip', 'secret', '--skip', 'script']);
assertEqual('7 全部外せば 0 になる', 0, r.code);

// ---- 8. 除外語リスト ----
if (fs.existsSync(work)) { fs.rmSync(work, { recursive: true, force: true }); }
fs.mkdirSync(work, { recursive: true });
fs.writeFileSync(path.join(work, 'doc.md'), '担当は 〈社名〉 の案件です。コードネームは Bluebird。\n', 'utf8');
const listPath = path.join(work, '_ng-words.txt');
fs.writeFileSync(listPath, '# 1 行 1 語。空行と # は読み飛ばす\n\nbluebird\n', 'utf8');

r = run([work, '--all', '--word-list', listPath]);
assertEqual('8 除外語に当たれば 1', 1, r.code);
assertTrue('8 除外語として報告する', r.out.includes('除外語'), r.out.slice(0, 200));
assertTrue('8 語そのものは出さない', !r.out.includes('Bluebird'), '除外語が出力に混ざっている');

// ---- 9. リストが無ければ、飛ばしたことを画面に出す ----
r = run([work, '--all', '--word-list', path.join(work, 'nothing.txt')]);
assertTrue(
	'9 リストが無ければ飛ばしたと出す',
	r.out.includes('除外語') && r.out.includes('飛ばし'),
	r.out.slice(0, 200),
);

/*
	9b. 実体パスは区切りが 2 つ重なっても、Bash の形でも拾う（history2html の計画 p261014-01）

	コードや JSON の中では `\` が 2 つに重なる（`C:\\Users\\…`）。Bash では `/c/Users/…` になる。
	会話ログにはどちらもよく出る。**区切りが 1 つの形しか見ていないと、黙って漏れる**
*/
const pathWork = path.join(work, 'paths');
fs.mkdirSync(pathWork, { recursive: true });
// 分けて組み立てる。続けて書くと、このソース自体が公開前の検査に当たる
fs.writeFileSync(path.join(pathWork, 'escaped.md'), 'const p = "C:' + '\\\\Users\\\\taro\\\\src";\n', 'utf8');
fs.writeFileSync(path.join(pathWork, 'msys.md'), 'cd /c' + '/Users/taro/src\n', 'utf8');
fs.writeFileSync(path.join(pathWork, 'placeholder.md'), 'const p = "C:\\\\Users\\\\<username>\\\\src"; cd /c/Users/username/src\n', 'utf8');
r = run([pathWork, '--all', '--skip', 'words', '--skip', 'author']);
assertTrue('9b 区切りが 2 つ重なった実体パスを拾う', r.out.includes('escaped.md:1'), r.out.slice(0, 300));
assertTrue('9b Bash の形（/c/Users/…）の実体パスを拾う', r.out.includes('msys.md:1'), r.out.slice(0, 300));
assertTrue('9b どちらの形でも伏せ字は拾わない', !r.out.includes('placeholder.md'), r.out.slice(0, 300));

// ---- 10. 引数の誤り ----
r = run(['--nonsense']);
assertEqual('10 知らないオプションは 2', 2, r.code);

r = run([path.join(work, 'nothing-here')]);
assertEqual('10 対象が無ければ 2', 2, r.code);

// ---- 11. --help ----
r = run(['--help']);
assertEqual('11 --help は 0 で終わる', 0, r.code);
assertTrue('11 --help は使い方を出す', r.out.includes('--word-list'), r.out.slice(0, 200));

/*
	12. 除外の指定（i261018-02）

	「このファイルの、この語に当たった、この項目だけ」を外す。**同じファイルの本物の鍵は、外れずに指摘される**
	ことが核心。キーワード（token ・ secret）は、このソースが公開前の検査に当たらないよう、分けて組み立てる。

	材料（proj/）に、誤検出の形（scanner2.scan(opt1)）と、本物の鍵の形を置く。
	  lib/vendor.js    1 token の誤検出 ／ 2 secret の誤検出 ／ 3 本物の鍵 ／ 4 メール（語を含む）／ 5 大文字の誤検出
	  lib/other.js     1 誤検出（別のファイルに同じ語）
	  vendor/a.js ・ vendor/sub/b.js ・ vendor-x/c.js   それぞれ 1 誤検出（フォルダ指定の境目を見る）
*/
const Tk = 'tok' + 'en';
const Sc = 'sec' + 'ret';
const proj = path.join(work, 'proj');
for (const d of ['lib', 'vendor/sub', 'vendor-x']) { fs.mkdirSync(path.join(proj, d), { recursive: true }); }
const fp = (kw: string): string => kw + ' = scanner2.scan(opt1);';
fs.writeFileSync(path.join(proj, 'lib', 'vendor.js'), [
	fp(Tk),
	Sc + ' = scanner2.keep(opt1);',
	Tk + " = 'AbCd-1234-EfGh-5678';",
	'contact ' + 'someone' + '@mail-sample.jp scanner2.',
	Tk.toUpperCase() + ' = Scanner2.Scan(Opt1);',
].join('\n') + '\n', 'utf8');
fs.writeFileSync(path.join(proj, 'lib', 'other.js'), fp(Tk) + '\n', 'utf8');
fs.writeFileSync(path.join(proj, 'vendor', 'a.js'), fp(Tk) + '\n', 'utf8');
fs.writeFileSync(path.join(proj, 'vendor', 'sub', 'b.js'), fp(Tk) + '\n', 'utf8');
fs.writeFileSync(path.join(proj, 'vendor-x', 'c.js'), fp(Tk) + '\n', 'utf8');

const lists = path.join(work, 'lists');
fs.mkdirSync(lists, { recursive: true });
function list(name: string, lines: string[]): string {
	const p = path.join(lists, name);
	fs.writeFileSync(p, lines.join('\n') + '\n', 'utf8');
	return p;
}
// words ・ author は、このテストの材料と関係しない。結果が環境で変わらないよう外す
const Quiet = ['--all', '--skip', 'words', '--skip', 'author'];
const hitOf = (out: string, file: string, line: number): boolean => new RegExp(file.replace(/[.\\/]/g, '\\$&') + ':' + line + '\\s').test(out);

// 12-1. 設定ファイルが無ければ、いまと同じ（全部が指摘になる）
r = run([proj, ...Quiet]);
assertEqual('12-1 設定ファイルが無ければ、全部が指摘になる（終了コード 1）', 1, r.code);
// 材料の指摘は 9 件（lib/vendor.js 5 ・ lib/other.js 1 ・ vendor/ 2 ・ vendor-x/ 1）
assertTrue('12-1 「9 件の指摘」', r.out.includes('9 件の指摘'), r.out.slice(-200));
assertTrue('12-1 除外の表示が出ない', !r.out.includes('除外'), r.out.slice(0, 300));

// 12-2 ・ 3 ・ 4 ・ 5 ・ 7. ファイル ・ 項目 ・ 語の組で外す
const l1 = list('l1.txt', ['# パス  項目  語', '', 'lib/vendor.js  secret  scanner2.']);
r = run([proj, ...Quiet, '--allow-list', l1]);
assertEqual('12-2 外したあとも、残りがあれば終了コード 1', 1, r.code);
assertTrue('12-2 指定したファイルの誤検出（1 ・ 2）が外れる', !hitOf(r.out, 'lib/vendor.js', 1) && !hitOf(r.out, 'lib/vendor.js', 2), r.out.slice(0, 500));
assertTrue('12-7 大文字の行（5）も、語の大小を無視して外れる', !hitOf(r.out, 'lib/vendor.js', 5), r.out.slice(0, 500));
assertTrue('12-3 同じファイルの本物の鍵（3）は、外れずに指摘される', hitOf(r.out, 'lib/vendor.js', 3), r.out.slice(0, 500));
assertTrue('12-4 別のファイルに同じ語があっても、外れない', hitOf(r.out, 'lib/other.js', 1), r.out.slice(0, 500));
assertTrue('12-5 別の項目（メール）は、同じ語を含む行でも外れない', hitOf(r.out, 'lib/vendor.js', 4), r.out.slice(0, 500));

// 12-8 ・ 8b. 外した件数と、キーワードの内訳
assertTrue('12-8 外した合計が出る', r.out.includes('除外した指摘: 3 件'), r.out.slice(0, 600));
const entry = r.out.split('\n').find((l) => l.includes('lib/vendor.js') && l.includes('「scanner2.」')) ?? '';
assertTrue('12-8 指定ごとに、ファイル ・ 項目 ・ 語 ・ 件数が出る', entry.includes('[認証情報]') && entry.includes('3 件'), entry);
assertTrue('12-8b [認証情報] には、当たったキーワードの内訳が出る（件数の多い順）', entry.includes('（token 2 ・ secret 1）'), entry);
assertTrue('12-8 外した分は指摘に数えない（9 件のうち 3 件を外して 6 件）', r.out.includes('6 件の指摘') && r.out.includes('除外 3 件'), r.out.slice(-200));

// 12-11. 検査したファイルの中身（当たった値）を出さない
assertTrue(
	'12-11 当たった値を出力に含まない',
	!r.out.includes('AbCd-1234') && !r.out.includes('someone@') && !r.out.includes('opt1'),
	'中身が出力に混ざっている',
);

// 12-8b. メールの指定には、内訳が出ない
const l3 = list('l3.txt', ['lib/vendor.js  mail  scanner2.']);
r = run([proj, ...Quiet, '--allow-list', l3]);
const mailEntry = r.out.split('\n').find((l) => l.includes('「scanner2.」')) ?? '';
assertTrue('12-5 メールの指定は、メールだけを外す（認証情報の行は残る）', !hitOf(r.out, 'lib/vendor.js', 4) && hitOf(r.out, 'lib/vendor.js', 1), r.out.slice(0, 500));
assertTrue('12-8b メールの指定には、キーワードの内訳が出ない', mailEntry.includes('[メールアドレス]') && !mailEntry.includes('（'), mailEntry);

// 12-6. フォルダ指定（末尾が /）と、完全一致
const l2 = list('l2.txt', ['vendor/  secret  scanner2.']);
r = run([proj, ...Quiet, '--allow-list', l2]);
assertTrue('12-6 末尾が / なら、フォルダの下すべてで外れる（a.js ・ sub/b.js）', !hitOf(r.out, 'vendor/a.js', 1) && !hitOf(r.out, 'vendor/sub/b.js', 1), r.out.slice(0, 500));
assertTrue('12-6 名前が前方一致するだけの別のフォルダ（vendor-x/）は外れない', hitOf(r.out, 'vendor-x/c.js', 1), r.out.slice(0, 500));
const l2b = list('l2b.txt', ['vendor  secret  scanner2.']);
r = run([proj, ...Quiet, '--allow-list', l2b]);
assertTrue('12-6 末尾に / が無ければ、完全一致だけ（フォルダの下は外れない）', hitOf(r.out, 'vendor/a.js', 1), r.out.slice(0, 500));

// 12-9. 使われていない指定には、警告が出る（終了コードは変えない）
const l9 = list('l9.txt', ['lib/vendor.js  mail  nomatchword', 'docs/old.js  secret  x']);
r = run([proj, ...Quiet, '--allow-list', l9]);
assertTrue('12-9 使われていない指定に警告が出る', r.out.includes('使われていない除外の指定') && r.out.includes('docs/old.js') && r.out.includes('nomatchword'), r.out.slice(0, 600));
assertEqual('12-9 警告だけでは終了コードを変えない（指摘は 9 件のまま）', 1, r.code);
assertTrue('12-9 外した件数は 0 なので、除外の合計は出ない', !r.out.includes('除外した指摘'), r.out.slice(0, 400));
r = run([proj, ...Quiet, '--allow-list', l1, '--skip', 'secret']);
assertTrue('12-9 --skip で外した項目の指定は、「使われていない」と言わない', !r.out.includes('使われていない'), r.out.slice(0, 400));

// 12-8. 全部を外すと 0 になる
const lAll = list('lall.txt', [
	'lib/vendor.js  secret  scanner2.',
	'lib/vendor.js  secret  AbCd-1234',
	'lib/vendor.js  mail  scanner2.',
	'lib/other.js  secret  scanner2.',
	'vendor/  secret  scanner2.',
	'vendor-x/  secret  scanner2.',
]);
r = run([proj, ...Quiet, '--allow-list', lAll]);
assertEqual('12-8 すべて外れれば、終了コード 0', 0, r.code);
assertTrue('12-8 「指摘はありません（除外 9 件）」', r.out.includes('指摘はありません（除外 9 件）'), r.out.slice(-200));

// 12-10. 書式の誤り（終了コード 2。何行目かを出す）
const bad1 = list('bad1.txt', ['# コメント', '', 'lib/vendor.js  secret']);
r = run([proj, ...Quiet, '--allow-list', bad1]);
assertEqual('12-10 語が無い指定（ファイル × 項目の全部を外す形）は、終了コード 2', 2, r.code);
assertTrue('12-10 何行目かと、語が要ることを出す', r.out.includes('bad1.txt:3') && r.out.includes('語'), r.out.slice(0, 300));
const bad2 = list('bad2.txt', ['lib/vendor.js  tokens  scanner2.']);
r = run([proj, ...Quiet, '--allow-list', bad2]);
assertEqual('12-10 知らない項目名は、終了コード 2', 2, r.code);
assertTrue('12-10 知らない項目名の行を出す', r.out.includes('bad2.txt:1'), r.out.slice(0, 300));
const bad3 = list('bad3.txt', ['lib/vendor.js']);
r = run([proj, ...Quiet, '--allow-list', bad3]);
assertEqual('12-10 書式でない行は、終了コード 2', 2, r.code);
r = run([proj, ...Quiet, '--allow-list', path.join(lists, 'nothing.txt')]);
assertEqual('12-10 --allow-list で渡したファイルが無ければ、終了コード 2', 2, r.code);

// 12-12. 既定の置き場（プロジェクト直下の check-public-allow.txt）
const proj2 = path.join(work, 'proj2');
fs.mkdirSync(path.join(proj2, 'lib'), { recursive: true });
fs.writeFileSync(path.join(proj2, 'lib', 'other.js'), fp(Tk) + '\n', 'utf8');
fs.writeFileSync(path.join(proj2, 'check-public-allow.txt'), 'lib/other.js  secret  scanner2.\n', 'utf8');
r = run([proj2, ...Quiet]);
assertEqual('12-12 直下の check-public-allow.txt を、指定せずに読む（終了コード 0）', 0, r.code);
assertTrue('12-12 外した件数が出る', r.out.includes('除外 1 件'), r.out.slice(-200));

fs.rmSync(work, { recursive: true, force: true });

console.log('');
if (fail === 0) {
	console.log('=== ' + pass + ' 件すべて成功 ===');
	process.exit(0);
}
console.log('=== ' + fail + ' 件失敗（成功 ' + pass + ' 件）===');
process.exit(1);
