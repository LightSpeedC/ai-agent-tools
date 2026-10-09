/*
	インライン SVG を独立ファイルに切り出す。

	GitHub は Markdown 内のインライン SVG をサニタイズで除去するため、
	images/ に書き出して画像参照にする。
*/

import * as fs from 'node:fs';
import * as path from 'node:path';
import { decodeEntities, escapeRegex, getAttr, resolveCssVars } from './htmlutil.ts';
import type { ConvertContext } from './context.ts';
import { writeIfChanged } from './write-file.ts';

export interface SvgResult {
	fileName: string;
	label: string;
}

export function exportSvg(svgHtml: string, ctx: ConvertContext): SvgResult {
	const open = /^<svg\b([^>]*)>/s.exec(svgHtml);
	const openTag = open != null ? open[0] : '<svg>';

	ctx.figIndex++;
	const id = getAttr(openTag, 'id');
	// id 付きもページ名を前置する。id は「そのページの中で」一意なだけなので、
	// 前置しないと別ページの同じ id と images/ の同じファイルを取り合って
	// 無警告で上書きし合う（i260908-02。id 無しの側は元々前置していた）
	const fileName = id.length > 0
		? ctx.basePrefix + '-' + id + '.svg'
		: ctx.basePrefix + '-fig' + String(ctx.figIndex).padStart(2, '0') + '.svg';

	let body = open != null ? svgHtml.substring(open[0].length) : svgHtml;
	body = body.replace(/<\/svg>\s*$/s, '');

	// var(--accent) は切り出した先では解決されず、色が失われる。
	// 章のクラスの定義を先に見て、無ければ :root を見て静的に埋める
	body = resolveCssVars(body, ctx.cssVars, ctx.chapterClass);

	// 切り出したあとの id はファイル単位で一意ならよいので、短い名前に振り直す
	const ids: string[] = [];
	for (const m of body.matchAll(/\sid="([^"]+)"/g)) {
		if (!ids.includes(m[1])) { ids.push(m[1]); }
	}
	let k = 0;
	for (const old of ids) {
		k++;
		const neo = 'i' + k;
		body = body.replace(new RegExp('\\sid="' + escapeRegex(old) + '"', 'g'), ' id="' + neo + '"');
		body = body.replace(new RegExp('url\\(#' + escapeRegex(old) + '\\)', 'g'), 'url(#' + neo + ')');
		body = body.replace(new RegExp('href="#' + escapeRegex(old) + '"', 'g'), 'href="#' + neo + '"');
	}

	// 単体ファイルとして開けるよう xmlns と width / height を付ける
	const viewBox = getAttr(openTag, 'viewBox');
	const label = getAttr(openTag, 'aria-label');
	const font = getAttr(openTag, 'font-family');
	let w = '';
	let h = '';
	// 区切りは空白だけでなくカンマも許す（SVG の viewBox 仕様どおり。
	// i260908-04 の変換エンジン8。空白決め打ちだとカンマ区切りで width/height が付かない）
	const vb = /^\s*[\d.\-]+[\s,]+[\d.\-]+[\s,]+([\d.]+)[\s,]+([\d.]+)\s*$/.exec(viewBox);
	if (vb != null) {
		w = vb[1];
		h = vb[2];
	}

	let attrs = 'xmlns="http://www.w3.org/2000/svg"';
	if (viewBox.length > 0) { attrs += ' viewBox="' + viewBox + '"'; }
	if (w.length > 0 && h.length > 0) {
		attrs += ' width="' + w + '" height="' + h + '"';
	}
	attrs += ' role="img"';
	if (label.length > 0) { attrs += ' aria-label="' + label + '"'; }
	if (font.length > 0) { attrs += ' font-family="' + font + '"'; }

	// 透過のままだとダークモードで文字が読めないので白背景を敷く。
	// defs の直後に入れて、グラデーション定義より後ろに来るようにする
	const bg = '\t<rect width="100%" height="100%" fill="#ffffff"/>';
	const defsEnd = body.toLowerCase().indexOf('</defs>');
	if (defsEnd >= 0) {
		const cut = defsEnd + '</defs>'.length;
		body = body.substring(0, cut) + '\n' + bg + body.substring(cut);
	} else {
		body = '\n' + bg + body;
	}

	let svg = '<svg ' + attrs + '>' + body + '</svg>';
	// 改行は .md と揃えて LF にする
	svg = svg.replace(/\r\n?/g, '\n');
	if (!svg.endsWith('\n')) { svg += '\n'; }

	if (ctx.write) {
		if (!fs.existsSync(ctx.imagesDir)) { fs.mkdirSync(ctx.imagesDir, { recursive: true }); }
		writeIfChanged(path.join(ctx.imagesDir, fileName), new TextEncoder().encode(svg));
	}
	ctx.images.push(fileName);

	return { fileName: fileName, label: decodeEntities(label) };
}
