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

// ---- 10. 引数の誤り ----
r = run(['--nonsense']);
assertEqual('10 知らないオプションは 2', 2, r.code);

r = run([path.join(work, 'nothing-here')]);
assertEqual('10 対象が無ければ 2', 2, r.code);

// ---- 11. --help ----
r = run(['--help']);
assertEqual('11 --help は 0 で終わる', 0, r.code);
assertTrue('11 --help は使い方を出す', r.out.includes('--word-list'), r.out.slice(0, 200));

fs.rmSync(work, { recursive: true, force: true });

console.log('');
if (fail === 0) {
	console.log('=== ' + pass + ' 件すべて成功 ===');
	process.exit(0);
}
console.log('=== ' + fail + ' 件失敗（成功 ' + pass + ' 件）===');
process.exit(1);
