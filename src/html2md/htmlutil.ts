/*
	HTML の文字列を扱う共通処理。

	C# 版（src/Html2Md/HtmlUtil.cs）の移植。
	正規表現だけで解析するため、対象は自分たちで書いた整形済みの HTML に限る。
*/

import * as fs from 'node:fs';
import * as path from 'node:path';

/** 実体参照を文字に戻す。&amp; は他を壊さないよう最後に処理する */
export function decodeEntities(text: string): string {
	if (text == null || text.length === 0) { return ''; }
	let t = text;
	t = t.split('&nbsp;').join(' ');
	t = t.split('&lt;').join('<');
	t = t.split('&gt;').join('>');
	t = t.split('&quot;').join('"');
	t = t.split('&apos;').join("'");
	t = t.split('&laquo;').join('«');
	t = t.split('&raquo;').join('»');
	t = t.split('&mdash;').join('—');
	t = t.split('&ndash;').join('–');
	t = t.split('&hellip;').join('…');
	t = t.split('&times;').join('×');
	t = t.split('&rarr;').join('→');
	t = t.split('&larr;').join('←');
	t = t.split('&copy;').join('©');
	t = t.replace(/&#(\d+);/g, (m, d: string) => {
		const code = Number(d);
		if (!Number.isInteger(code)) { return m; }
		try { return String.fromCodePoint(code); } catch { return m; }
	});
	t = t.replace(/&#x([0-9a-fA-F]+);/g, (m, h: string) => {
		const code = parseInt(h, 16);
		if (!Number.isInteger(code)) { return m; }
		try { return String.fromCodePoint(code); } catch { return m; }
	});
	t = t.split('&amp;').join('&');
	return t;
}

/** 開きタグの class 属性を空白で分割して返す */
export function getClassList(openTag: string): string[] {
	if (openTag == null || openTag.length === 0) { return []; }
	const m = /^<[^>]*?\sclass="([^"]*)"/.exec(openTag);
	if (m == null) { return []; }
	return m[1].split(/[ \t\r\n]+/).filter(s => s.length > 0);
}

export function hasClass(classes: string[], name: string): boolean {
	for (const c of classes) {
		if (c === name) { return true; }
	}
	return false;
}

/** 開きタグから属性値を取り出す。見つからなければ空文字 */
export function getAttr(openTag: string, name: string): string {
	if (openTag == null || openTag.length === 0) { return ''; }
	const m = new RegExp('\\s' + escapeRegex(name) + '="([^"]*)"').exec(openTag);
	if (m == null) { return ''; }
	return m[1];
}

export function escapeRegex(s: string): string {
	return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * タグだけを落とし、実体参照はそのまま残す（バッジ・リンクテキスト・alt 用）。
 *
 * ここでデコードすると、本文中の「&lt;p&gt;」のような文字列が実体参照つきの
 * まま残っていればタグ除去では無視されるが、先にデコードして本物の "<p>" に
 * してしまうと、convert の最終段にある汎用タグ除去が実タグと誤認して消してしまう。
 * デコードは、タグ除去がすべて終わった後（convert の最終段）でまとめて行う。
 */
export function stripTagsRaw(html: string): string {
	if (html == null || html.length === 0) { return ''; }
	let t = html.replace(/<[^>]+>/g, ' ');
	t = t.replace(/\s+/g, ' ');
	return t.trim();
}

/** タグと実体参照を落として素のテキストにする（アンカー計算・突き合わせ用） */
export function getPlainText(html: string): string {
	if (html == null || html.length === 0) { return ''; }
	let t = html.replace(/<[^>]+>/g, ' ');
	t = decodeEntities(t);
	t = t.replace(/\s+/g, ' ');
	return t.trim();
}

/**
 * 見出しのアンカー計算専用（i260903-02）。タグは消すだけで、タグの境界に
 * 空白を挿さない。
 *
 * `getPlainText()` はタグをすべて空白 1 個に置き換えるため、
 * `見出し（<code>-c</code>を廃止）` のように前後に空白の無いインライン要素が
 * あると、実際には隣接しているはずの文字の間に余計な空白が生まれる。
 * `getAnchor()` はその空白をハイフンに変えるため、`-c` 自身が持つハイフンと
 * 連続して `--c` のような二重ハイフンになり、GitHub が実際に生成するアンカー
 * とずれる。GitHub 側は見出しのレンダリング後のテキストをそのまま使うため、
 * タグの境界だからといって空白は入らない。
 */
export function getAnchorText(html: string): string {
	if (html == null || html.length === 0) { return ''; }
	let t = html.replace(/<[^>]+>/g, '');
	t = decodeEntities(t);
	t = t.replace(/\s+/g, ' ');
	return t.trim();
}

/**
 * GitHub の見出しアンカーを見出しテキストから求める。
 * 小文字化 → 記号を落とす → 空白 1 文字をハイフン 1 個にする。
 */
export function getAnchor(heading: string): string {
	if (heading == null || heading.length === 0) { return ''; }
	let a = heading.trim().toLowerCase();
	// \p{L} 文字 / \p{N} 数字 / \p{M} 結合文字 / 空白 / _ / - 以外を落とす
	a = a.replace(/[^\p{L}\p{N}\p{M}\s_-]/gu, '');
	a = a.trim().replace(/\s/g, '-');
	return a;
}

/**
 * リンク先の拡張子を .md に差し替える。他ファイルへのアンカーは、
 * リンク先ファイルの見出しアンカーマップ（crossAnchors）を引いて張り替える。
 * 見つからなければ元のアンカーのまま残す（同一ファイル内の張り替えと同じ落とし方）。
 *
 * 置き換えるのは、この実行で .md が生成されるページへのリンクだけ。
 * 探索フォルダの外にある HTML や md-skip のページを .md で指すと、
 * 存在しないファイルを指すことになる。
 */
export function convertLinkTarget(href: string, baseDir: string | null,
	convertedPages: Set<string> | null,
	crossAnchors: Map<string, Map<string, string>> | null): string {
	if (href == null || href.length === 0) { return ''; }
	if (/^(https?:|mailto:|tel:|#)/.test(href)) { return href; }

	// 対象が分からないときは従来どおり全部置き換える（単体で呼ばれた場合）
	if (convertedPages == null || baseDir == null || baseDir.length === 0) {
		return href.replace(/\.html(?=$|[#?])/, '.md');
	}

	// 大小を区別しない突き合わせ。呼び出し側は小文字にして持っている
	// （C# 版は StringComparer.OrdinalIgnoreCase の HashSet を使っていた）
	const resolved = resolveLink(baseDir, href);
	if (resolved == null) { return href; }
	const full = resolved.toLowerCase();
	// 今回の対象集合に入っていれば、変換後にできると仮定してよい。入っていなくても、
	// 既に生成済みの .md がディスク上にあれば同じに扱う（個別・部分実行を繰り返しても、
	// 一度生成しきれば結果が変わらないようにするため。i260910-04 の C 案）
	if (!convertedPages.has(full) && !mdFileExists(resolved)) { return href; }

	const hashIdx = href.indexOf('#');
	if (hashIdx >= 0 && crossAnchors != null) {
		const targetAnchors = crossAnchors.get(full);
		if (targetAnchors != null) {
			const id = href.substring(hashIdx + 1);
			const mapped = targetAnchors.get(id);
			if (mapped != null) {
				href = href.substring(0, hashIdx) + '#' + mapped;
			}
		}
	}
	return href.replace(/\.html(?=$|[#?])/, '.md');
}

/** 切り出したブロックと、その中身 */
export interface Block {
	/** 開きタグから閉じタグまで（閉じタグが無ければ末尾まで） */
	outer: string;
	/** 開きタグと閉じタグの間（閉じタグが無ければ開きタグより後ろ全部） */
	inner: string;
}

/** 閉じタグを持たないタグ。ブロックとして走査するものだけを挙げる */
function isVoidTag(tag: string): boolean {
	return tag === 'hr';
}

/**
 * start 位置から始まるタグのブロックと中身を切り出す（同名タグの入れ子に対応）。
 * タグ名の直後の文字を確かめるので、<p> が <pre> に一致することはない。
 *
 * 中身の範囲はここで一緒に決める。ブロック全体を返して呼び出し側で
 * 閉じタグを探し直すと、子要素の閉じタグを自分のものと取り違える。
 * 閉じられていない要素（書き込み途中のログ HTML 等）では最後の子要素が失われていた。
 */
export function getBlock(html: string, start: number, tag: string): Block {
	const open = '<' + tag;
	const close = '</' + tag + '>';
	let contentStart = html.indexOf('>', start);
	contentStart = contentStart < 0 ? html.length : contentStart + 1;

	// 空要素は閉じタグを持たない。開きタグだけをブロックとする。
	// 閉じタグを探させると見つからず、後ろが丸ごと 1 ブロックに飲み込まれる
	if (isVoidTag(tag)) {
		return { outer: html.substring(start, contentStart), inner: '' };
	}

	const lower = html.toLowerCase();
	const openLower = open.toLowerCase();
	const closeLower = close.toLowerCase();

	let depth = 0;
	let i = start;
	while (i < html.length) {
		const no = lower.indexOf(openLower, i);
		const nc = lower.indexOf(closeLower, i);
		// 閉じタグが無い。末尾までをブロックとし、中身も末尾までとする
		if (nc < 0) {
			return { outer: html.substring(start), inner: html.substring(contentStart) };
		}
		if (no >= 0 && no < nc) {
			const after = (no + open.length < html.length) ? html[no + open.length] : ' ';
			if (after === '>' || after === '/' || /\s/.test(after)) { depth++; }
			i = no + open.length;
			continue;
		}
		depth--;
		i = nc + close.length;
		if (depth <= 0) {
			// nc がこのブロックに対応する閉じタグ
			const len = nc - contentStart;
			const inner = len > 0 ? html.substring(contentStart, nc) : '';
			return { outer: html.substring(start, i), inner: inner };
		}
	}
	return { outer: html.substring(start), inner: html.substring(contentStart) };
}

/** ブロックの先頭の開きタグを返す */
export function getOpenTag(block: string): string {
	const i = block.indexOf('>');
	if (i < 0) { return block; }
	return block.substring(0, i + 1);
}

/** 相対リンクを絶対パスに直す。外部リンク・アンカーだけの場合は null */
export function resolveLink(baseDir: string, href: string): string | null {
	if (href == null || href.length === 0) { return null; }
	if (/^(https?:|mailto:|tel:)/.test(href)) { return null; }
	if (href.startsWith('#')) { return null; }
	// クエリ文字列も落とす。付けたままだと "page.html?x=1" という
	// 実在しないパスとして解決され、実在チェックに当たらない（i260908-04 の変換エンジン3）
	const target = href.split(/[#?]/)[0];
	if (target.length === 0) { return null; }
	try {
		return path.resolve(baseDir, target);
	} catch {
		return null;
	}
}

/** 対応する .md がディスク上に既に実在するか（今回の対象集合に無いページの既存生成物を拾うため） */
function mdFileExists(htmlPath: string): boolean {
	const mdPath = htmlPath.replace(/\.[^.\\/]*$/, '') + '.md';
	try {
		return fs.existsSync(mdPath);
	} catch {
		return false;
	}
}

/**
 * ページ全体を Markdown に出さない指定があるか。
 * <meta name="md-skip"> を head に置いたページは変換しない。
 */
export function isMdSkipPage(html: string): boolean {
	return /<meta\b[^>]*\sname="md-skip"/i.test(html);
}

/** コメント・style・script・head を落とす */
export function stripNonContent(html: string): string {
	let t = html.replace(/<!--[\s\S]*?-->/g, '');
	t = t.replace(/<style\b[^>]*>[\s\S]*?<\/style>/g, '');
	t = t.replace(/<script\b[^>]*>[\s\S]*?<\/script>/g, '');
	t = t.replace(/<head\b[^>]*>[\s\S]*?<\/head>/g, '');
	return t;
}

/**
 * @media や @supports のブロックを中身ごと落とす。
 * 入れ子があるため、括弧を数えて終端を決める。
 */
function stripAtBlocks(css: string): string {
	let sb = '';
	let i = 0;
	for (;;) {
		const at = css.indexOf('@', i);
		if (at < 0) { sb += css.substring(i); break; }
		const brace = css.indexOf('{', at);
		if (brace < 0) { sb += css.substring(i); break; }
		sb += css.substring(i, at);
		let depth = 0;
		let end = -1;
		for (let q = brace; q < css.length; q++) {
			if (css[q] === '{') { depth++; }
			else if (css[q] === '}') { depth--; if (depth === 0) { end = q; break; } }
		}
		if (end < 0) { break; }
		i = end + 1;
	}
	return sb;
}

/**
 * style から CSS 変数を読む。返すのは「セレクタの鍵 → 変数名 → 値」。
 * :root は空文字の鍵で持ち、章のクラスは chNN の鍵で持つ。
 *
 * SVG を単体ファイルに切り出すと var() が解決されず色が失われるため、
 * 切り出すときに静的に埋める。@media の中と JS による上書きは対象外。
 */
export function buildCssVars(html: string): Map<string, Map<string, string>> {
	const map = new Map<string, Map<string, string>>();

	for (const st of html.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/g)) {
		let css = st[1].replace(/\/\*[\s\S]*?\*\//g, '');
		css = stripAtBlocks(css);
		for (const rule of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
			const decl = rule[2];
			if (decl.indexOf('--') < 0) { continue; }

			const keys: string[] = [];
			for (const one of rule[1].split(',')) {
				const sel = one.trim();
				if (sel === ':root') { keys.push(''); }
				else {
					const c = /^\.(ch\d+)$/.exec(sel);
					if (c != null) { keys.push(c[1]); }
				}
			}
			if (keys.length === 0) { continue; }

			for (const d of decl.matchAll(/(--[\w-]+)\s*:\s*([^;]+)/g)) {
				const name = d[1];
				const val = d[2].trim();
				for (const key of keys) {
					let table = map.get(key);
					if (table == null) { table = new Map<string, string>(); map.set(key, table); }
					table.set(name, val);
				}
			}
		}
	}
	return map;
}

/**
 * var(--x) と var(--x, 既定値) を実際の値に置き換える。
 * 章のクラスの定義を先に見て、無ければ :root を見る。どちらにも無ければ
 * 既定値、それも無ければ元の記述を残す。
 *
 * 正規表現で括るとフォールバックに hsl(...) のような括弧が入ったときに
 * 途中で切れるため、括弧を数えて取り出す。
 */
export function resolveCssVars(s: string, vars: Map<string, Map<string, string>> | null,
	chapterClass: string): string {
	if (vars == null || vars.size === 0 || s == null || s.length === 0) { return s; }
	if (s.toLowerCase().indexOf('var(') < 0) { return s; }

	let sb = '';
	let i = 0;
	for (;;) {
		const p = s.toLowerCase().indexOf('var(', i);
		if (p < 0) { sb += s.substring(i); break; }
		sb += s.substring(i, p);

		const brace = p + 3;
		let depth = 0;
		let end = -1;
		for (let q = brace; q < s.length; q++) {
			if (s[q] === '(') { depth++; }
			else if (s[q] === ')') { depth--; if (depth === 0) { end = q; break; } }
		}
		if (end < 0) { sb += s.substring(p); break; }

		const inner = s.substring(brace + 1, end);
		sb += resolveOneVar(inner, vars, chapterClass, s.substring(p, end + 1));
		i = end + 1;
	}
	return sb;
}

function resolveOneVar(inner: string, vars: Map<string, Map<string, string>>,
	chapterClass: string, original: string): string {
	const comma = inner.indexOf(',');
	const name = (comma < 0 ? inner : inner.substring(0, comma)).trim();
	const fallback = comma < 0 ? '' : inner.substring(comma + 1).trim();

	let found: string | undefined;
	if (chapterClass != null && chapterClass.length > 0) {
		found = vars.get(chapterClass)?.get(name);
	}
	if (found == null) {
		found = vars.get('')?.get(name);
	}
	if (found != null) { return resolveCssVars(found, vars, chapterClass); }
	if (fallback.length > 0) { return resolveCssVars(fallback, vars, chapterClass); }
	return original;
}

/** クラスの一覧から章のクラス（chNN）を返す。無ければ空文字 */
export function findChapterClass(classes: string[] | null): string {
	if (classes == null) { return ''; }
	for (const c of classes) {
		if (/^ch\d+$/.test(c)) { return c; }
	}
	return '';
}

/** body の中身を取り出す。body が無ければ全体を返す */
export function extractBody(html: string): string {
	const lower = html.toLowerCase();
	let bs = lower.indexOf('<body');
	if (bs < 0) { return html; }
	bs = html.indexOf('>', bs) + 1;
	let be = lower.indexOf('</body>');
	if (be < 0) { be = html.length; }
	return html.substring(bs, be);
}
