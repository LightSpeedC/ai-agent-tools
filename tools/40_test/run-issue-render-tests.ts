/*
	issue（課題管理ツール）のフェーズ 3a のテスト: issue render（HTML の生成。開かない）。
	計画は p261103-01 (131-A ・ 134-A ・ 135-A ・ 129-A ・ 130-A)、仕様は notes/50_spec/課題ファイルの形と検査.html。

	期待値は、計画の決定と仕様から先に手で書いた（実装の出力から作っていない）。
	本物のプロジェクトには触らない。tmp/ の下に、ケースごとの小さなプロジェクトを作る。
	日付と時刻は、環境変数 ISSUE_TEST_TODAY ・ ISSUE_TEST_NOW で固定する。

	人を表す値は example.com のような仮の値にする（共通ルール「テストのルール」）。
*/
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..', '..');
const work = path.join(root, 'tmp', 'issue-render-tests');
const main = path.join(root, 'src', 'issue', 'main.ts');

let pass = 0;
let fail = 0;
function check(name: string, ok: boolean, detail: string = ''): void {
	if (ok) { pass++; console.log('  ✅ [OK] ' + name); }
	else { fail++; console.log('  ❌ [NG] ' + name + (detail ? '  ' + detail : '')); }
}

function fwd(p: string): string {
	return p.split('\\').join('/');
}

// ---- 材料 ----

/** project-uuid.txt (schema 2)。project_id はプロジェクトのフォルダ名 (計画 p261109-01 の 207-A ・ 208-A) */
const uuidText = (name: string): string => `schema: 2\nproject_uuid: 7b0c4e1a9f3d4a62b8d51c2e6f90a3b7\nproject_id: ${name}\n`;
const Items = 'notes/40_issues/items/';
const Todo = Items + 'todo/';
const Doing = Items + 'doing/';
const Done = Items + 'done/';
const Archived = Items + 'archived/';
const Out = 'notes/40_issues/_issues.html';
const Now1 = '2026/11/05 12:34:56';
const Now2 = '2026/11/05 18:00:00';

const KeyOrder = ['schema', 'id', 'title', 'group', 'created', 'from', 'confirmed', 'refs'];
const Defaults: Record<string, string> = {
	schema: '1', id: 'i261103-01', title: '題', group: 'html2md', created: '2026-11-03',
};

function issueText(over: Record<string, string | null> = {}, body: string = '\n本文\n'): string {
	const all: Record<string, string | null> = { ...Defaults, ...over };
	const keys = [...KeyOrder.filter((k) => k in all), ...Object.keys(all).filter((k) => !KeyOrder.includes(k))];
	const lines = keys.filter((k) => all[k] !== null).map((k) => k + ': ' + all[k]);
	return '---\n' + lines.join('\n') + '\n---\n' + body;
}

function mkProject(name: string, files: Record<string, string>): string {
	const dir = path.join(work, name);
	fs.rmSync(dir, { recursive: true, force: true });
	fs.mkdirSync(dir, { recursive: true });
	for (const [rel, text] of Object.entries(files)) {
		const full = path.join(dir, rel);
		fs.mkdirSync(path.dirname(full), { recursive: true });
		fs.writeFileSync(full, text);
	}
	return dir;
}

function std(name: string, files: Record<string, string> = {}): string {
	return mkProject(name, { [Items + 'project-uuid.txt']: uuidText(name), ...files });
}

/** 1x1 の png (画像の取り込みの試験用) */
const PngBase64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
function putPng(dir: string, name: string): void {
	const file = path.join(dir, 'notes', '40_issues', 'items', 'images', name);
	fs.mkdirSync(path.dirname(file), { recursive: true });
	fs.writeFileSync(file, Buffer.from(PngBase64, 'base64'));
}

type Result = { code: number; out: string; err: string };

function run(args: string[], dir: string, env: Record<string, string> = {}): Result {
	const e = { ...process.env, ISSUE_TEST_TODAY: '2026-11-05', ISSUE_TEST_NOW: Now1, ...env } as Record<string, string>;
	const r = spawnSync(process.execPath, [main, ...args, '--root', dir], { cwd: dir, env: e, encoding: 'utf8', timeout: 60000 });
	return { code: r.status ?? -1, out: (r.stdout ?? '').trim(), err: (r.stderr ?? '').trim() };
}

function render(dir: string, extra: string[] = [], env: Record<string, string> = {}): Result {
	return run(['render', ...extra], dir, env);
}

/** 生成した HTML を、文字列で読む (BOM は除く)。無ければ空 */
function html(dir: string, rel: string = Out): string {
	try { return fs.readFileSync(path.join(dir, rel), 'utf8').replace(/^\uFEFF/, ''); } catch { return ''; }
}

/** 生成した HTML の CSS に、そのセレクタの宣言があるか */
function html2cssHas(h: string, selector: string): boolean {
	return h.includes(selector + '{');
}

function exists(dir: string, rel: string): boolean {
	return fs.existsSync(path.join(dir, rel));
}

const A = 'i261103-01-a.md';
const B = 'i261103-02-b.md';
const C = 'i261103-03-c.md';
const D = 'i261103-04-d.md';

const base: Record<string, string> = {
	[Todo + A]: issueText({ id: 'i261103-01', title: 'A <b>題</b> & 記号', group: 'html2md' }),
	[Doing + B]: issueText({ id: 'i261103-02', title: '着手の題', group: 'less' }),
	[Done + C]: issueText({ id: 'i261103-03', title: '済の題', group: 'html2md' }),
	[Archived + D]: issueText({ id: 'i261103-04', title: '退避の題', group: 'less' }),
};

/** 本文 (Markdown) を 1 件の課題に入れて render し、HTML を返す */
function renderBody(name: string, body: string, extraFiles: Record<string, string> = {}): string {
	const dir = std(name, { [Todo + A]: issueText({}, '\n' + body + '\n'), ...extraFiles });
	render(dir);
	return html(dir);
}

// ---- 基本 ----

console.log('--- 基本');
{
	const dir = std('basic', base);
	const r = render(dir);
	const h = html(dir);
	check('render は、notes/40_issues/_issues.html を作る (終了コード 0)', r.code === 0 && h !== '', r.out + r.err);
	check('出力に、相対パスと課題の件数が出る (絶対パスは出ない)', r.out.includes('notes/40_issues/_issues.html') && r.out.includes('課題 3 件') && !r.out.includes(dir) && !r.out.includes(fwd(dir)), r.out);
	let bytes: Buffer = Buffer.alloc(0);
	try { bytes = fs.readFileSync(path.join(dir, Out)); } catch { /* 実装が無いとき。下で失敗にする */ }
	check('HTML は BOM 付き UTF-8 ・ LF', bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf && !bytes.includes(0x0d));
	check('HTML5 の文書で、md-skip を入れる (html2md が _issues.md を作らないため)', h.startsWith('<!DOCTYPE html>') && h.includes('<meta name="md-skip">'), h.slice(0, 80));
	check('title は「課題 (プロジェクトのフォルダ名)」', h.includes('<title>課題 (basic)</title>'), h.slice(0, 400));
	check('スクリプトを含まない (JS を使わずに畳める)', !h.includes('<script'));
	check('作った日時と件数が、末尾に出る', h.includes(Now1) && h.includes('課題 3 件 (未 1 件 ・ 着手 1 件 ・ 済 1 件)'));
}
{
	const dir = std('range', base);
	render(dir);
	check('既定の範囲は 未・着手・済 (archived は含めない)', ['i261103-01', 'i261103-02', 'i261103-03'].every((i) => html(dir).includes('id="' + i + '"')) && !html(dir).includes('id="i261103-04"'));
	render(dir, ['--all']);
	check('--all は archived も含める', html(dir).includes('id="i261103-04"') && html(dir).includes('archived 1 件'));
	render(dir, ['--state', '未,着手']);
	check('--state で絞れる (未・着手だけ)', html(dir).includes('id="i261103-01"') && html(dir).includes('id="i261103-02"') && !html(dir).includes('id="i261103-03"'));
	render(dir, ['--group', 'less']);
	check('--group で絞れる', html(dir).includes('id="i261103-02"') && !html(dir).includes('id="i261103-01"'));
	render(dir, ['i261103-03']);
	check('<id> を指せば、その課題だけを作る (どのフォルダでも)', html(dir).includes('id="i261103-03"') && !html(dir).includes('id="i261103-01"'));
	render(dir, ['i261103-04']);
	check('<id> が archived/ の課題でも作れる', html(dir).includes('id="i261103-04"'));
}

// ---- 課題行 ----

console.log('--- 課題行 (130-A: 番号 → バッジ → 題)');
{
	const dir = std('rows', base);
	render(dir);
	const h = html(dir);
	check('未は、番号 → バッジ (b-none) → 題 の順で、開いている (open)', h.includes('<details id="i261103-01" open><summary><span class="no">i261103-01</span><span class="badge b-none">未</span>'), h.slice(h.indexOf('<details')));
	check('着手は、バッジが b-warn で、開いている', h.includes('<details id="i261103-02" open><summary><span class="no">i261103-02</span><span class="badge b-warn">着手</span>'));
	check('済は、バッジが b-ok で、閉じている (open が無い)', h.includes('<details id="i261103-03"><summary><span class="no">i261103-03</span><span class="badge b-ok">済</span>'));
	render(dir, ['--all']);
	check('archived/ の課題は、バッジに archived と出る', html(dir).includes('<span class="badge b-ok">済 ・ archived</span>'));
	check('題と記号は、エスケープする (A <b>題</b> & 記号)', html(dir).includes('A &lt;b&gt;題&lt;/b&gt; &amp; 記号') && !html(dir).includes('<b>題</b>'));
}
{
	const dir = std('sections', base);
	render(dir);
	const h = html(dir);
	check('グループごとに、章 (section.chNN) を作る。見出しはグループ名と件数', h.includes('<section class="ch01" id="ch01">') && h.includes('<h1>html2md (2 件)</h1>') && h.includes('<section class="ch02" id="ch02">') && h.includes('<h1>less (1 件)</h1>'), h.slice(h.indexOf('<section')));
	check('目次に、章へのリンクがある', h.includes('href="#ch01"') && h.includes('href="#ch02"'));
	check('章の色 (.ch01 ・ .ch02) を CSS に持つ', h.includes('.ch01{') && h.includes('.ch02{'));
}
{
	const dir = std('sections-order', { ...base, [Items + 'groups.txt']: 'less\nhtml2md\n' });
	render(dir);
	const h = html(dir);
	check('groups.txt があれば、その並びが章の順 (less が ch01、html2md が ch02)',
		h.indexOf('<section class="ch01" id="ch01">') < h.indexOf('<h1>less (1 件)</h1>') && h.indexOf('<h1>less (1 件)</h1>') < h.indexOf('<section class="ch02" id="ch02">') && h.indexOf('<section class="ch02" id="ch02">') < h.indexOf('<h1>html2md (2 件)</h1>'), h.slice(h.indexOf('<section')));
}
{
	const dir = std('sort', {
		[Doing + 'i261103-09-z.md']: issueText({ id: 'i261103-09' }),
		[Todo + 'i261103-0L-l.md']: issueText({ id: 'i261103-0L' }),
		[Todo + 'i261103-0a-a.md']: issueText({ id: 'i261103-0a' }),
	});
	render(dir);
	const h = html(dir);
	check('章の中は id の順 (09 ・ 0a ・ 0L。L は a の後の 36 進数の順)', h.indexOf('id="i261103-09"') < h.indexOf('id="i261103-0a"') && h.indexOf('id="i261103-0a"') < h.indexOf('id="i261103-0L"'));
}
{
	const dir = std('meta-info', {
		[Todo + A]: issueText({ id: 'i261103-01', from: 'project-a #1', confirmed: 'false', refs: 'i261103-02, p261103-01' }),
		[Todo + B]: issueText({ id: 'i261103-02' }),
	});
	render(dir);
	const h = html(dir);
	check('作成日と、報告元 (確認待ち) を出す', h.includes('作成 2026-11-03') && h.includes('報告元 project-a #1 (確認待ち)'), h);
	check('refs の課題は、ページの中のリンク (#id) にする。ほかの番号は文字のまま', h.includes('<a href="#i261103-02">i261103-02</a>') && h.includes('p261103-01') && !h.includes('href="#p261103-01"'));
	const dirChat = std('meta-info-chat', { [Todo + A]: issueText({ id: 'i261103-01', refs: 'i261103-02, #1923' }), [Todo + B]: issueText({ id: 'i261103-02' }) });
	render(dirChat);
	check('refs の chat の発言の番号 (#1923) は、リンクにせず文字のまま出す (i261111-07)', html(dirChat).includes('参照 <a href="#i261103-02">i261103-02</a>, #1923') && !html(dirChat).includes('href="##1923"'), html(dirChat));
	const dir2 = std('meta-info-confirmed', { [Done + A]: issueText({ id: 'i261103-01', from: 'project-a #1', confirmed: 'true' }) });
	render(dir2);
	check('報告元の確認が true なら (確認済み)', html(dir2).includes('報告元 project-a #1 (確認済み)'), html(dir2));
}
{
	const dir = std('empty');
	const r = render(dir);
	check('課題が 0 件でも、ページを作って終了コード 0', r.code === 0 && html(dir).includes('課題 0 件'), r.out + r.err);
}

// ---- 本文 (Markdown) ----

console.log('--- 本文 (Markdown の変換)');
{
	const h = renderBody('md-basic', '## 見出し\n\n### 小見出し\n\n段落の **太字** と `code` と [リンク](https://example.com/x)。');
	check('## は h3、### は h4 になる (ページの h1 は章、課題が summary)', h.includes('<h3>見出し</h3>') && h.includes('<h4>小見出し</h4>'), h);
	check('段落 ・ 太字 ・ インラインのコード ・ リンク', h.includes('<p>段落の <strong>太字</strong> と <code>code</code> と <a href="https://example.com/x">リンク</a>。</p>'), h);
}
{
	const h = renderBody('md-list', '- a\n- b\n  - c\n\n1. 一\n2. 二');
	check('箇条書き (入れ子を含む) と番号つきの一覧', h.includes('<li>a</li>') && h.includes('<ol>') && h.includes('<li>二</li>') && (h.match(/<ul>/g) ?? []).length >= 2 && h.includes('<li>c</li>'), h);
}
{
	const h = renderBody('md-todo', '## やること\n- [未] 文 1\n- [着手] 文 2\n- [済] 文 3');
	check('やること行は、状態のバッジつきの li になる', h.includes('<li class="todo"><span class="badge b-none">未</span> 文 1</li>') && h.includes('<span class="badge b-warn">着手</span> 文 2') && h.includes('<span class="badge b-ok">済</span> 文 3'), h);
}
{
	const h = renderBody('md-code', '```ts\nconst a = 1 < 2;\n```');
	check('コードブロックは、言語つきの pre ・ code で、中身をエスケープする', h.includes('<pre><code class="language-ts">const a = 1 &lt; 2;</code></pre>'), h);
}
{
	const h = renderBody('md-table', '| 列 1 | 数 |\n|---|---:|\n| 値 1 | 10 |');
	check('表は、tablewrap の中の table になる (数値の列は num で右寄せ)', h.includes('<div class="tablewrap">') && h.includes('<th>列 1</th>') && h.includes('<td>値 1</td>') && h.includes('<td class="num">10</td>'), h);
	check('右寄せの列は、見出しも右寄せにする (数値と見出しの位置を揃える。画面で見て分かった不具合)', h.includes('<th class="num">数</th>') && html2cssHas(h, 'th.num'), h);
}
{
	const h = renderBody('md-callout', '> [!WARNING]\n> 注意する\n\n> [!NOTE]\n> 補足\n\n> 引用です');
	check('callout (WARNING ・ NOTE) と、ふつうの引用', h.includes('<div class="callout callout-warning">') && h.includes('<p>注意する</p>') && h.includes('<div class="callout">') && h.includes('<blockquote>'), h);
}
{
	const h = renderBody('md-escape', '<script>alert(1)</script>\n\n`<b>` と a<br>b');
	check('Markdown の中の HTML は、解釈せずエスケープする (script が実行されない)', h.includes('&lt;script&gt;alert(1)&lt;/script&gt;') && !h.includes('<script'), h);
	check('<br> だけは、改行として通す', h.includes('a<br>b'));
}
{
	// html2md は日本語の中の太字を <strong> のまま書く。属性の無い <strong> と </strong> は太字として通す
	const h = renderBody('md-strong', '前<strong>太字</strong>後 と <strong onclick="x">属性付き</strong>');
	check('属性の無い <strong> は太字として通す (文字のまま出さない)', h.includes('前<strong>太字</strong>後') && !h.includes('&lt;strong&gt;太字'), h);
	check('属性付きの <strong> は通さずエスケープする', !h.includes('onclick="x"'), h);
}
{
	const h = renderBody('md-js-link', '[x](javascript:alert(1))');
	check('javascript: のリンクは、リンクにしない', !h.includes('href="javascript:'), h);
}

// ---- 画像 ----

console.log('--- 画像 (128-A ・ 129-A)');
{
	const dir = std('img', { [Todo + A]: issueText({}, '\n![図 1](../images/i261103-01-x.png)\n') });
	putPng(dir, 'i261103-01-x.png');
	const r = render(dir);
	check('画像は、出力から見た相対パスにする (../images/ → items/images/)', html(dir).includes('<img src="items/images/i261103-01-x.png" alt="図 1">'), r.out + html(dir));
}
{
	const dir = std('img-out', { [Todo + A]: issueText({}, '\n![図 1](../images/i261103-01-x.png)\n') });
	putPng(dir, 'i261103-01-x.png');
	const r = render(dir, ['--out', 'tmp/view.html']);
	check('--out で指した場所に作る。画像のパスは、その場所から見た相対パス', r.code === 0 && html(dir, 'tmp/view.html').includes('src="../notes/40_issues/items/images/i261103-01-x.png"') && !exists(dir, Out), r.out + r.err);
}
{
	const dir = std('img-missing', { [Todo + A]: issueText({}, '\n![図 1](../images/無い.png)\n') });
	const r = render(dir);
	check('画像が見つからなければ、文字に置き換えて警告を出す (終了コードは 0)', r.code === 0 && html(dir).includes('[画像が見つからない: 無い.png]') && r.err.includes('[警告]'), r.out + r.err);
}
{
	const dir = std('img-theme', { [Todo + A]: issueText({}, '\n![x](../images/a-light.png#gh-light-mode-only)\n![x](../images/a-dark.png#gh-dark-mode-only)\n') });
	putPng(dir, 'a-light.png');
	putPng(dir, 'a-dark.png');
	render(dir);
	// 160-B: 129-A のとおり、両方を出して表示の明暗で切り替える (明るい版だけにした実装を戻した)
	const h = html(dir);
	check('160-B: 明るい版は class="only-light" で出す', /<img src="[^"]*a-light\.png" alt="x" class="only-light">/.test(h), h);
	check('160-B: 暗い版も class="only-dark" で出す', /<img src="[^"]*a-dark\.png" alt="x" class="only-dark">/.test(h), h);
	check('160-B: 明るい表示では暗い版を隠す (CSS)', /\.only-dark\s*\{\s*display:\s*none/.test(h), h);
	check('160-B: 暗い表示では明るい版を隠し、暗い版を出す (CSS)', /@media \(prefers-color-scheme: dark\)\s*\{[^@]*\.only-light\s*\{\s*display:\s*none[^@]*\.only-dark\s*\{\s*display:\s*inline/.test(h), h);
}
// 162-B ・ 164-A: 暗い表示の環境でだけ、暗い配色にする (明るい表示は淡い背景のまま)
{
	const dir = std('dark', { [Todo + A]: issueText({}, '\n本文\n') });
	render(dir);
	const h = html(dir);
	const dark = h.match(/@media \(prefers-color-scheme: dark\)\s*\{[\s\S]*?\n\t\}/g) ?? [];
	const all = dark.join('\n');
	check('162-B: 明るい表示の body は白地のまま', /body\{\s*margin:0; background:#fff;/.test(h), h);
	check('164-A: 暗い表示では body の地を #12161f にする', /body[^{]*\{[^}]*background:#12161f/.test(all), all);
	check('164-A: 暗い表示の本文の色は #e3e8f0', all.includes('--ink:#e3e8f0'), all);
	check('164-A: 暗い表示のリンクは #8ab4ff', all.includes('--link:#8ab4ff'), all);
	check('164-A: 暗い表示の code の地は #1c2230、文字は #cfe0ff', /background:#1c2230;[^}]*color:#cfe0ff/.test(all), all);
	check('164-A: 暗い表示の表のしまは #171c27', all.includes('#171c27'), all);
	check('164-A: 章の地 (--soft) は、暗い表示で明度 14% にする', /\.ch01\{\s*--soft:hsl\(280,28%,14%\);/.test(all), all);
}
{
	const dir = std('img-plain', { [Todo + A]: issueText({}, '\n![x](../images/p.png)\n') });
	putPng(dir, 'p.png');
	render(dir);
	check('160-B: 印の無い画像には class を付けない', /<img src="[^"]*p\.png" alt="x">/.test(html(dir)), html(dir));
}
{
	const dir = std('standalone', { ...base, [Todo + A]: issueText({ id: 'i261103-01', group: 'html2md' }, '\n![図 1](../images/i261103-01-x.png)\n\n[別の資料](../../../README.md)\n') });
	putPng(dir, 'i261103-01-x.png');
	fs.writeFileSync(path.join(dir, 'notes', '40_issues', 'issues-legacy.html'), '<html></html>\n');
	const r = render(dir, ['--standalone', '--out', 'tmp/share.html']);
	const h = html(dir, 'tmp/share.html');
	check('--standalone は、画像を data: URI で埋め込む (items/images への参照を残さない)', r.code === 0 && h.includes('src="data:image/png;base64,' + PngBase64 + '"') && !h.includes('items/images'), r.out + r.err);
	check('--standalone は、ローカルへのリンク (戻る ・ 旧 HTML ・ ほかのファイル) を外す', !h.includes('README.html') && !h.includes('issues-legacy.html') && !h.includes('href="../') && h.includes('別の資料'), h);
	check('--standalone でも、ページの中のリンク (#id ・ 目次) は残る', h.includes('href="#ch01"'));
}
{
	const dir = std('standalone-noout', base);
	check('--standalone を --out なしで使えば終了コード 5 (_issues.html は、ローカルで見る版のため)', render(dir, ['--standalone']).code === 5 && !exists(dir, Out));
}

// ---- 旧 HTML と戻るリンク ----

console.log('--- リンク');
{
	const dir = std('links', base);
	fs.writeFileSync(path.join(dir, 'notes', '40_issues', 'issues-legacy.html'), '<html></html>\n');
	render(dir);
	check('戻るリンク (README.html) と、旧 HTML (issues-legacy.html) へのリンクが、ページの先頭にある', html(dir).includes('href="../../README.html"') && html(dir).includes('href="issues-legacy.html"'), html(dir).slice(0, 3000));
}
{
	const dir = std('links-nolegacy', base);
	render(dir);
	check('旧 HTML が無ければ、そのリンクは出さない', !html(dir).includes('issues-legacy.html'));
}

// ---- 書き換えの条件 ----

console.log('--- 同じ中身なら書かない');
{
	const dir = std('unchanged', base);
	const first = render(dir, [], { ISSUE_TEST_NOW: Now1 });
	const before = html(dir);
	const second = render(dir, [], { ISSUE_TEST_NOW: Now2 });
	check('1 回目は「作った」、同じ中身の 2 回目は「変更なし」で、ファイルを書き換えない (日時だけが違っても)', first.out.includes('作った') && second.out.includes('変更なし') && html(dir) === before && html(dir).includes(Now1) && !html(dir).includes(Now2), first.out + ' / ' + second.out);
	fs.writeFileSync(path.join(dir, Todo + A), issueText({ id: 'i261103-01', title: '直した題', group: 'html2md' }));
	const third = render(dir, [], { ISSUE_TEST_NOW: Now2 });
	check('課題の中身が変われば「作り直した」で、日時も新しくなる', third.out.includes('作り直した') && html(dir).includes('直した題') && html(dir).includes(Now2), third.out);
}
{
	const dir = std('json', base);
	const r = render(dir, ['--json']);
	let p: { file?: string; issues?: number; written?: string; warnings?: number } = {};
	try { p = JSON.parse(r.out); } catch { /* 下で失敗にする */ }
	check('--json は { file, issues, written, warnings } を出す', p.file === Out && p.issues === 3 && p.written === 'created' && p.warnings === 0, r.out);
}
{
	const dir = std('broken', { [Todo + A]: issueText({ id: 'i261103-01' }), [Todo + B]: 'メタ情報が無い\n' });
	const r = render(dir);
	check('メタ情報が読めない課題は、飛ばして警告を出す (終了コードは 0)', r.code === 0 && html(dir).includes('id="i261103-01"') && r.err.includes('[警告]'), r.out + r.err);
}
{
	const dir = std('args', base);
	check('知らないオプションは終了コード 5', render(dir, ['--bogus']).code === 5);
	check('id の形でない引数は終了コード 5', render(dir, ['xyz']).code === 5);
	check('見つからない id は終了コード 1', render(dir, ['i261103-99']).code === 1);
	check('--out に値が無ければ終了コード 5', run(['render', '--out'], dir).code === 5);
	check('--state に知らない語を渡せば終了コード 5', render(dir, ['--state', '完了']).code === 5);
	check('render は、課題のファイルを書き換えない', fs.readFileSync(path.join(dir, Todo + A), 'utf8') === base[Todo + A]);
}

// ---- 決定 (p261108-02。185-A ・ 186-A ・ 187-A) ----

console.log('--- 決定');
const Dec = 'notes/40_issues/decisions/';
function decisionText(id: string, parent: string, title: string, chosen: string, extra: string = '', body: string = ''): string {
	return `---\nschema: 1\nid: ${id}\ntitle: ${title}\nparent: ${parent}\ndecided: 2026-11-08\nchosen: ${chosen}\n${extra}---\n\n## 案\n\n- A: 案 A の文\n- B: 案 B の文\n${body}`;
}
const decFiles: Record<string, string> = {
	...base,
	[Dec + 'i261103-01-d1-出し方.md']: decisionText('i261103-01-d1', 'i261103-01', '出し方 <x>', 'A'),
	[Dec + 'i261103-01-d2-覆す.md']: decisionText('i261103-01-d2', 'i261103-01', '覆した決定', 'B', 'replaces: i261103-01-d1\n'),
	[Dec + 'p261108-02-d1-計画.md']: decisionText('p261108-02-d1', 'p261108-02', '計画の問い', 'A', '', '\n本文の補足\n'),
	[Dec + 'p261108-02-d2-両方.md']: decisionText('p261108-02-d2', 'p261108-02', '両方の問い', 'A,B'),
	// 195-A: 親の課題が items/ に無い決定は、課題の外の決定の章へ。archived の課題 (既定では出さない) の決定は、どこにも出さない
	[Dec + 'i261103-09-d1-無い課題.md']: decisionText('i261103-09-d1', 'i261103-09', '親の無い問い', 'A'),
	[Dec + 'i261103-04-d1-退避.md']: decisionText('i261103-04-d1', 'i261103-04', '退避の課題の問い', 'A'),
};
{
	const dir = std('decisions', decFiles);
	const r = render(dir);
	const h = html(dir);
	const issueA = h.slice(h.indexOf('<details id="i261103-01"'), h.indexOf('<details id="i261103-03"'));
	check('親が課題の決定は、その課題の details の中に出る (185-A)', issueA.includes('id="i261103-01-d1"') && issueA.includes('id="i261103-01-d2"'), issueA.slice(0, 300));
	check('課題の中に「決定」の見出しを置く', issueA.includes('<h4>決定</h4>'));
	check('決定の無い課題には、決定の見出しを足さない', !h.slice(h.indexOf('<details id="i261103-03"')).split('</details>')[0].includes('<h4>決定</h4>'));
	check('決定は details.decision で、既定で閉じる (186-A)', /<details class="decision[^"]*" id="i261103-01-d1">/.test(h));
	check('summary は番号 ・ 問い (エスケープ) ・ 選んだ字と案の文', /<summary><span class="dno">i261103-01-d1<\/span>出し方 &lt;x&gt; → A: 案 A の文/.test(h), h.slice(h.indexOf('i261103-01-d1'), h.indexOf('i261103-01-d1') + 200));
	check('中に全部の案が出る', issueA.includes('案 B の文'));
	check('217-A: 複数を選んだ決定の summary は、選んだ字ごとに案の文を出す', /→ A: 案 A の文 ・ B: 案 B の文/.test(h), h.slice(h.indexOf('p261108-02-d2'), h.indexOf('p261108-02-d2') + 200));
	check('summary の番号は span.no にしない (課題の数え方を変えない)', (h.match(/<span class="no">/g) ?? []).length === 3);
	check('覆された決定は superseded で、→ 新しい番号のリンクが付く (187-A)', /<details class="decision superseded" id="i261103-01-d1">/.test(h) && h.includes('→ <a href="#i261103-01-d2">i261103-01-d2</a> で覆した'));
	check('覆した側には ← 古い番号が付く', h.includes('← <a href="#i261103-01-d1">i261103-01-d1</a> を覆した'));
	check('superseded の灰色の CSS がある', html2cssHas(h, 'details.decision.superseded'));
	check('親が課題でない決定は、最後の「課題の外の決定」の章に出る (185-A ・ 195-A)', /<h1>課題の外の決定 \(3 件\)<\/h1>/.test(h) && h.indexOf('<h1>課題の外の決定') > h.indexOf('id="i261103-01-d1"'), h.slice(h.indexOf('課題の外'), h.indexOf('課題の外') + 80));
	check('課題の外の決定の章は、親の番号ごとの h2 で分ける', h.includes('<h2>p261108-02</h2>') && h.includes('本文の補足'));
	check('親の課題が items/ に無い決定も、課題の外の決定の章に出る (195-A)', h.includes('<h2>i261103-09</h2>') && h.indexOf('id="i261103-09-d1"') > h.indexOf('<h1>課題の外の決定'));
	check('親の課題が items/ にあるが、ページに出していない (archived) 決定は、どこにも出さない', !h.includes('id="i261103-04-d1"'));
	check('課題の外の決定の章も目次に入る', /<li class="ch03"><a href="#ch03">課題の外の決定<\/a><\/li>/.test(h));
	check('件数に決定を混ぜず、「・ 決定 n 件」(出した数) を足す', h.includes('課題 3 件 (未 1 件 ・ 着手 1 件 ・ 済 1 件) ・ 決定 5 件'), r.out);
}
{
	const dir = std('decisions-filter', decFiles);
	render(dir, ['--group', 'html2md']);
	const h = html(dir);
	check('--group で絞ったときは、課題の外の決定の章を出さない', !h.includes('課題の外の決定') && h.includes('id="i261103-01-d1"'));
	render(dir, ['i261103-03']);
	check('番号で絞ったときも、課題の外の決定の章を出さない', !html(dir).includes('課題の外の決定'));
	render(dir, ['--state', 'archived']);
	const ah = html(dir);
	check('archived だけのページには、課題の外の決定の章を出さない (197-A)', !ah.includes('課題の外の決定') && ah.includes('id="i261103-04-d1"'), ah.slice(ah.indexOf('<section'), ah.indexOf('<section') + 200));
}
{
	const a = std('decisions-none-a', base);
	const b = std('decisions-none-b', { ...base, [Dec + '.keep']: '' });
	render(a);
	render(b);
	check('決定が無いときは、決定の部品を何も出さない', !html(a).includes('class="decision') && !html(a).includes('課題の外の決定') && !html(a).includes('<h4>決定</h4>') && !html(a).includes('・ 決定'));
	check('decisions/ が空でも、無いときと同じ出力', html(a).replace(/decisions-none-a/g, 'X') === html(b).replace(/decisions-none-b/g, 'X'));
}

console.log('');
console.log(`=== issue (render): ${pass} 件成功 ・ ${fail} 件失敗 ===`);
fs.rmSync(work, { recursive: true, force: true });
process.exit(fail === 0 ? 0 : 1);
