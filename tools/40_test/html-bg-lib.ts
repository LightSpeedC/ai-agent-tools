/*
	HTML の <style> の地を見る (p261031-01、74-A)。検査 (check-html-rules.ts) と直す道具 (fix-html-bg.ts) が共有する。

	共通ルール「HTMLデザインルール」の規則:
	  ・グラデーション・var() で塗る地の前に、色だけの地を直書きで書く
	  ・色だけの地には var() を使わない
	Windows のプレビュー (Explorer の Alt+P) は、グラデーションと var() を含む宣言を捨てる。
	色だけの地が前に無いと、白い字が白い地に乗って読めない。

	CSS は宣言のブロック (セレクタ { 宣言… }) ごとに見る。ブロックの中で、最初の「グラデーション・var() の地」の
	前に、色だけの地が無ければ外れ。直すときは、その地の最初の色 (var() なら既定値) を色だけの地として前に足す。
*/

const BLOCK = /([^{}]*)\{([^{}]*)\}/g;
const DECL = /(?<![\w-])(background(?:-color)?)\s*:\s*([^;{}]*)/g;
const NOT_COLOR = new Set(['none', 'transparent', 'inherit', 'initial', 'unset', 'currentcolor']);

const isFancy = (v: string): boolean => /gradient\(|var\(/.test(v);

function isSolid(v: string): boolean {
	const t = v.trim().replace(/\s*!important$/, '');
	if (isFancy(t)) { return false; }
	if (/^#[0-9a-fA-F]{3,8}$/.test(t) || /^(rgb|hsl)a?\([^()]*\)$/.test(t)) { return true; }
	return /^[a-zA-Z]+$/.test(t) && !NOT_COLOR.has(t.toLowerCase());
}

/** s[open] の '(' に対応する ')' の位置 */
function closeOf(s: string, open: number): number {
	let depth = 0;
	for (let i = open; i < s.length; i++) {
		if (s[i] === '(') { depth++; }
		else if (s[i] === ')') { depth--; if (depth === 0) { return i; } }
	}
	return -1;
}

function splitTop(s: string): string[] {
	const out: string[] = [];
	let depth = 0;
	let from = 0;
	for (let i = 0; i < s.length; i++) {
		if (s[i] === '(') { depth++; }
		else if (s[i] === ')') { depth--; }
		else if (s[i] === ',' && depth === 0) { out.push(s.slice(from, i)); from = i + 1; }
	}
	out.push(s.slice(from));
	return out;
}

/** 色の指定から、色だけの地に使える値を取り出す。var() は既定値を使う */
function colorOf(a: string): string | null {
	const t = a.trim();
	const hex = /^#[0-9a-fA-F]{3,8}\b/.exec(t);
	if (hex) { return hex[0]; }
	const fn = /^(rgb|hsl)a?\(/.exec(t);
	if (fn) { const c = closeOf(t, fn[0].length - 1); return c < 0 ? null : t.slice(0, c + 1); }
	if (t.startsWith('var(')) {
		const c = closeOf(t, 3);
		if (c < 0) { return null; }
		const parts = splitTop(t.slice(4, c));
		return parts.length < 2 ? null : colorOf(parts.slice(1).join(','));
	}
	return null;
}

const NOT_STOP = /^(-?[\d.]+(deg|turn|rad|grad)|to\s.*|circle.*|ellipse.*|closest-.*|farthest-.*|at\s.*)$/;

/** 地の値の最初の色 */
function firstColor(v: string): string | null {
	const g = /gradient\(/.exec(v);
	if (!g) { return colorOf(v); }
	const open = g.index + g[0].length - 1;
	const close = closeOf(v, open);
	if (close < 0) { return null; }
	const stop = splitTop(v.slice(open + 1, close)).map((x) => x.trim()).find((x) => !NOT_STOP.test(x));
	return stop == null ? null : colorOf(stop);
}

export interface BgFix { css: string; added: number; unresolved: string[] }

/** 色だけの地が前に無い、グラデーション・var() の地の一覧 (「セレクタ: 宣言」) */
export function findBgIssues(css: string): string[] {
	return scan(css, false).unresolved;
}

function scan(css: string, fix: boolean): BgFix {
	const unresolved: string[] = [];
	let added = 0;
	const out = css.replace(BLOCK, (whole: string, sel: string, body: string) => {
		let solid = false;
		for (const m of body.matchAll(DECL)) {
			if (isSolid(m[2])) { solid = true; continue; }
			if (!isFancy(m[2]) || solid) { continue; }
			const label = sel.trim().replace(/\s+/g, ' ') + ': ' + m[1] + ':' + m[2].trim().replace(/\s+/g, ' ').slice(0, 60);
			const c = fix ? firstColor(m[2]) : null;
			if (!fix || c == null) { unresolved.push(label); return whole; }
			const at = m.index ?? 0;
			const nl = body.lastIndexOf('\n', at - 1);
			const lineStart = nl + 1;
			const prefix = body.slice(lineStart, at);
			const text = nl >= 0 && /^[ \t]*$/.test(prefix)
				? body.slice(0, lineStart) + prefix + m[1] + ':' + c + ';\n' + body.slice(lineStart)
				: body.slice(0, at) + m[1] + ':' + c + '; ' + body.slice(at);
			added++;
			return sel + '{' + text + '}';
		}
		return whole;
	});
	return { css: out, added: added, unresolved: unresolved };
}

/** 色だけの地を足す。足せなかったもの (最初の色が取れない) は unresolved に挙げる */
export function fixBgCss(css: string): BgFix {
	const r = scan(css, true);
	return r;
}

/** HTML のすべての <style> を直す。<style> の外は触らない (BOM ・ 改行もそのまま) */
export function fixBgHtml(html: string): { html: string; added: number; unresolved: string[] } {
	let added = 0;
	const unresolved: string[] = [];
	const out = html.replace(/(<style[^>]*>)([\s\S]*?)(<\/style>)/g, (_w: string, a: string, css: string, b: string) => {
		const r = fixBgCss(css);
		added += r.added;
		unresolved.push(...r.unresolved);
		return a + r.css + b;
	});
	return { html: out, added: added, unresolved: unresolved };
}
