/*
	html2md の「HTML に無い文言」の検査 (testExtraText) のテスト。

	callout の中の表は、Markdown では引用の中に出て、区切り行が「> |---|---|---|」になる。
	区切り行は記法そのものなので、表の外でも引用の中でも、付け足しの文言とみなさない
	(i260917-01-less の「HTML に無い文言 1 件」。品質レビュー q261031-01 の K-02)。
*/
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { testExtraText } from '../../src/html2md/checks.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const work = path.resolve(here, '..', '..', 'tmp', 'html2md-extra-tests');

let pass = 0;
let fail = 0;
function check(name: string, html: string, markdown: string, expected: string[]): void {
	const htmlPath = path.join(work, 'doc.html');
	fs.writeFileSync(htmlPath, html);
	const result = { htmlPath: htmlPath, mdPath: path.join(work, 'doc.md'), markdown: markdown } as unknown as Parameters<typeof testExtraText>[0];
	const actual = testExtraText(result);
	if (JSON.stringify(actual) === JSON.stringify(expected)) { pass++; console.log('  [OK] ' + name); }
	else { fail++; console.log('  [NG] ' + name + '  期待 ' + JSON.stringify(expected) + ' / 実際 ' + JSON.stringify(actual)); }
}

console.log('');
console.log('=== html2md の「HTML に無い文言」の検査 ===');
fs.rmSync(work, { recursive: true, force: true });
fs.mkdirSync(work, { recursive: true });

const table = '<table><thead><tr><th>列A</th><th>列B</th></tr></thead><tbody><tr><td>甲</td><td>乙</td></tr></tbody></table>';

check('表の区切り行は、付け足しとみなさない',
	'<body>' + table + '</body>',
	'| 列A | 列B |\n|---|---|\n| 甲 | 乙 |\n',
	[]);

check('callout の中の表の区切り行 (> |---|---|) も、付け足しとみなさない',
	'<body><div class="callout">' + table + '</div></body>',
	'> [!NOTE]\n> | 列A | 列B |\n> |---|---|\n> | 甲 | 乙 |\n',
	[]);

check('HTML に無い文言は、引用の中でも指摘する',
	'<body><div class="callout">' + table + '</div></body>',
	'> [!NOTE]\n> | 列A | 列B |\n> |---|---|\n> | 甲 | 丙 |\n',
	['4 行目: > | 甲 | 丙 |']);

fs.rmSync(work, { recursive: true, force: true });
console.log('');
console.log(fail === 0 ? '=== ' + pass + ' 件すべて成功 ===' : '=== ' + fail + ' 件失敗（成功 ' + pass + ' 件）===');
process.exit(fail === 0 ? 0 : 1);
