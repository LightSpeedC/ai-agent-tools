/*
	html2md の Converter.convertFragment (HTML の断片を Markdown にする入口) のテスト。

	課題管理ツール issue の移行 (p261106-01 の 157-A) が、課題の本文 (HTML の断片) を
	Markdown にするために使う。変換の規則を 2 か所に持たないため、ファイルを単位にした
	convertFile と同じ規則で変換する。

	答え合わせの相手は convertFile: 同じ中身を body に持つファイルを convertFile に渡した結果と、
	convertFragment の結果が一致すること。加えて、単純なものは期待値を手で書く。
*/
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Converter } from '../../src/html2md/converter.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const work = path.resolve(here, '..', '..', 'tmp', 'html2md-fragment-tests');

let pass = 0;
let fail = 0;
function report(ok: boolean, name: string, detail: string): void {
	if (ok) { pass++; console.log('  [OK] ' + name); }
	else { fail++; console.log('  [NG] ' + name + '  ' + detail); }
}

console.log('');
console.log('=== html2md の断片の変換 (convertFragment) ===');
fs.rmSync(work, { recursive: true, force: true });
fs.mkdirSync(work, { recursive: true });

const converter = new Converter();

// 手で期待値を書いたもの (単純なもの。出力の形は共通ルール「記法の対応」から)
const handWritten: Array<[string, string, string]> = [
	['段落は 1 行の本文になる', '<p>本文</p>', '本文'],
	['code はコードスパンになる', '<p><code>x</code></p>', '`x`'],
	['箇条書きは - で始まる', '<ul><li>one</li><li>two</li></ul>', '- one\n- two'],
	['他の資料へのリンクは .html が .md になる', '<p><a href="p1.html">計画</a></p>', '[計画](p1.md)'],
	['外部の URL はそのまま', '<p><a href="https://example.com/a.html">外</a></p>', '[外](https://example.com/a.html)'],
];
for (const [name, html, expected] of handWritten) {
	let actual = '';
	try { actual = converter.convertFragment(html); }
	catch (e) { actual = '例外: ' + (e instanceof Error ? e.message : String(e)); }
	report(actual === expected, '手書きの期待値: ' + name, '期待 ' + JSON.stringify(expected) + ' / 実際 ' + JSON.stringify(actual));
}

// convertFile との突き合わせ (紛らわしいものを並べる)
const fragments: Array<[string, string]> = [
	['強調と code の混在', '<p>a <strong>bold</strong> b と <code>c &lt; d</code></p>'],
	['日本語の強調 (句読点の前後)', '<p><strong>入れてください。</strong>次の文</p>'],
	['入れ子の箇条書きと段落', '<ul><li>親<ul><li>子</li></ul></li><li>次</li></ul><p>後ろの段落</p>'],
	['pre のコードブロック', '<pre><code class="language-text">一行目\n  二行目</code></pre>'],
	['表', '<div class="tablewrap"><table><thead><tr><th>列 1</th><th>列 2</th></tr></thead><tbody><tr><td>a</td><td class="num">1</td></tr></tbody></table></div>'],
	['callout', '<div class="callout callout-note"><p>補足</p></div>'],
	['badge の付いた箇条書き', '<ul><li><span class="badge b-ok">済</span>終わった</li><li><span class="badge b-none">未</span>これから</li></ul>'],
	['実体参照', '<p>&lt;a&gt; &amp; &quot;q&quot;</p>'],
];
fs.mkdirSync(path.join(work, 'f'), { recursive: true });
fragments.forEach(([name, html], i) => {
	const file = path.join(work, 'f', 'case' + i + '.html');
	// extractBody が body を探すので、最小の文書に包む。作成日 ・ 更新日は変換に影響しない
	fs.writeFileSync(file, '<!DOCTYPE html><html><head><meta charset="UTF-8"><title>t</title></head><body>' + html + '</body></html>');
	const viaFile = converter.convertFile(file, false).markdown.replace(/\s+$/, '');
	let viaFragment = '';
	try { viaFragment = converter.convertFragment(html); }
	catch (e) { viaFragment = '例外: ' + (e instanceof Error ? e.message : String(e)); }
	report(viaFragment === viaFile, 'convertFile と同じ結果: ' + name,
		'convertFile ' + JSON.stringify(viaFile) + ' / convertFragment ' + JSON.stringify(viaFragment));
});

// 続けて呼んでも前の呼び出しの状態 (コードスパンの控え) が残らない
const first = converter.convertFragment('<p><code>one</code></p>');
const second = converter.convertFragment('<p><code>two</code></p>');
report(first === '`one`' && second === '`two`', '続けて呼んでもコードスパンが混ざらない',
	'1 回目 ' + JSON.stringify(first) + ' / 2 回目 ' + JSON.stringify(second));

fs.rmSync(work, { recursive: true, force: true });
console.log('');
console.log(fail === 0 ? '=== ' + pass + ' 件すべて成功 ===' : '=== ' + fail + ' 件失敗 (成功 ' + pass + ' 件) ===');
process.exit(fail === 0 ? 0 : 1);
