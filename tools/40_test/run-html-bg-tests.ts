/*
	HTML の地の直書き (p261031-01、74-A) の試験。

	共通ルール「HTMLデザインルール」の「グラデーション・var() で塗る地の前に、色だけの地を直書きで書く」を、
	検査 (findBgIssues) と直す道具 (fixBgHtml) の両方が同じ判定で扱うことを確かめる。
	Windows のプレビュー (Explorer の Alt+P) は、グラデーションと var() を含む宣言を捨てるため、
	色だけの地が前に無いと、白い字が白い地に乗って読めない。

	bun でも node でも走る。
*/

import { findBgIssues, fixBgCss, fixBgHtml } from './html-bg-lib.ts';

let pass = 0;
let fail = 0;

function check(name: string, cond: boolean, detail: string): void {
	if (cond) { pass++; console.log('  [OK] ' + name); }
	else { fail++; console.log('  [NG] ' + name + '  ' + detail.slice(0, 200).replace(/\r?\n/g, ' / ')); }
}

console.log('');
console.log('=== HTML の地の直書きの試験 ===');
console.log('');

// ---- 検査 ----
console.log('-- 検査');
const grad = '.a{ color:#fff; background:linear-gradient(100deg,#12224d,#2f5fbf); }';
check('グラデーションの前に色だけの地が無ければ指摘する', findBgIssues(grad).length === 1, JSON.stringify(findBgIssues(grad)));

const gradOk = '.a{ color:#fff; background:#12224d; background:linear-gradient(100deg,#12224d,#2f5fbf); }';
check('直前に色だけの地があれば指摘しない', findBgIssues(gradOk).length === 0, JSON.stringify(findBgIssues(gradOk)));

const varOnly = 'code{ background:var(--code-bg,#f4f6fa); color:#17335f; }';
check('var() だけの地も、前に色だけの地が無ければ指摘する', findBgIssues(varOnly).length === 1, JSON.stringify(findBgIssues(varOnly)));

const after = '.a{ background:linear-gradient(100deg,#12224d,#2f5fbf); background:#12224d; }';
check('色だけの地が後ろにあるだけなら指摘する (前に書く規則)', findBgIssues(after).length === 1, JSON.stringify(findBgIssues(after)));

const plain = '.a{ background:#fff; } .b{ background:transparent; color:#17335f; } :root{ --soft:var(--x,#fff); --bg:linear-gradient(red,blue); }';
check('色だけの地・transparent・カスタムプロパティは指摘しない', findBgIssues(plain).length === 0, JSON.stringify(findBgIssues(plain)));

const media = '@media (max-width:600px){ .a{ background:linear-gradient(90deg,#fff,#eee); } }';
check('@media の中のブロックも見る', findBgIssues(media).length === 1, JSON.stringify(findBgIssues(media)));

const colorProp = '.a{ background-color:var(--c,#fff); }';
check('background-color も見る', findBgIssues(colorProp).length === 1, JSON.stringify(findBgIssues(colorProp)));

const clip = '.a{ -webkit-background-clip:text; background-clip:text; }';
check('background-clip は地ではないので指摘しない', findBgIssues(clip).length === 0, JSON.stringify(findBgIssues(clip)));

// ---- 直す道具 ----
console.log('-- 直す道具');
let r = fixBgCss(grad);
check('グラデーションの最初の色 (#hex) を、色だけの地として前に足す', r.css === '.a{ color:#fff; background:#12224d; background:linear-gradient(100deg,#12224d,#2f5fbf); }', r.css);
check('足した件数が 1', r.added === 1, String(r.added));

r = fixBgCss('.t{ background:linear-gradient(135deg,var(--navy1,#12224d),var(--navy2,#2f5fbf)); }');
check('角度を飛ばし、var() の既定値の色を使う', r.css.startsWith('.t{ background:#12224d; background:linear-gradient('), r.css);

r = fixBgCss(varOnly);
check('var() だけの地は、既定値の色を足す', r.css === 'code{ background:#f4f6fa; background:var(--code-bg,#f4f6fa); color:#17335f; }', r.css);

r = fixBgCss('.s{\n\t\tcolor:#000;\n\t\tbackground:linear-gradient(180deg,var(--soft,#f2f5fb),#fff);\n\t}');
check('行頭の宣言には、同じインデントの行で足す', r.css === '.s{\n\t\tcolor:#000;\n\t\tbackground:#f2f5fb;\n\t\tbackground:linear-gradient(180deg,var(--soft,#f2f5fb),#fff);\n\t}', JSON.stringify(r.css));

r = fixBgCss(colorProp);
check('background-color には background-color で足す', r.css === '.a{ background-color:#fff; background-color:var(--c,#fff); }', r.css);

const once = fixBgCss(grad).css;
const twice = fixBgCss(once);
check('冪等: 2 回目は足さず、同じ文字列', twice.added === 0 && twice.css === once, twice.css);
check('直したあとは、検査に指摘が出ない', findBgIssues(once).length === 0, JSON.stringify(findBgIssues(once)));

r = fixBgCss('.a{ background:var(--x); }');
check('既定値の取れない宣言は足さず、未解決として挙げる', r.added === 0 && r.unresolved.length === 1 && r.css === '.a{ background:var(--x); }', JSON.stringify(r));

// ---- HTML ----
console.log('-- HTML');
const html = '﻿<!DOCTYPE html>\n<style>\n\t.a{ background:linear-gradient(100deg,#12224d,#2f5fbf); }\n</style>\n<p style="background:red">x</p>\n<style>\n\tcode{ background:var(--code-bg,#f4f6fa); }\n</style>\n';
const h = fixBgHtml(html);
check('複数の <style> をすべて直す', h.added === 2, String(h.added));
check('BOM と改行 (LF) と <style> の外は、そのまま保つ', h.html.startsWith('﻿<!DOCTYPE html>\n<style>') && !h.html.includes('\r') && h.html.includes('<p style="background:red">x</p>'), JSON.stringify(h.html.slice(0, 120)));
check('HTML としても冪等', fixBgHtml(h.html).html === h.html, '');

console.log('');
if (fail === 0) {
	console.log('=== ' + pass + ' 件すべて成功 ===');
	process.exit(0);
}
console.log('=== ' + fail + ' 件失敗 (成功 ' + pass + ' 件) ===');
process.exit(1);
