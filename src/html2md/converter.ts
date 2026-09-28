/*
	HTML を Markdown にする。

	C# 版（src/Html2MdCs/Converter.cs）の移植。
*/

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as Emphasis from './emphasis.ts';
import {
	buildCssVars, decodeEntities, extractBody, findChapterClass,
	getAttr, getBlock, getClassList, getMarkdownHeadingAnchor, getOpenTag,
	getPlainText, hasClass, isMdSkipPage, stripNonContent,
} from './htmlutil.ts';
import type { Block } from './htmlutil.ts';
import { InlineConverter } from './inline.ts';
import { ListTableConverter } from './table.ts';
import { exportSvg } from './svg.ts';
import { newContext } from './context.ts';
import type { ConvertContext, ConvertResult } from './context.ts';

export { isMdSkipPage };

/** callout の追加クラス → GitHub アラートの種別 */
const CalloutKinds: Record<string, string> = {
	'callout-note': 'NOTE',
	'callout-tip': 'TIP',
	'callout-important': 'IMPORTANT',
	'callout-warning': 'WARNING',
	'callout-caution': 'CAUTION',
};

/**
 * ブロックとして扱うタグ。ここに無いタグは走査で飛ばされ、中身が地の文になる。
 *
 * dt・dd・summary を個別に挙げているのは、親（dl・details）だけを挙げると
 * 中身がまとめて 1 段落になり、項目の境目が消えるため。
 */
const BlockTags = /<(section|figure|footer|blockquote|div|nav|table|main|article|aside|header|address|details|summary|dl|dt|dd|hr|h1|h2|h3|h4|h5|h6|p|ul|ol|pre|svg|a)\b/;

export class Converter {
	private readonly inline = new InlineConverter();
	private readonly listTable: ListTableConverter;

	/** この実行で .md が生成されるページ（絶対パス）。ここへのリンクだけ .md にする */
	convertedPages: Set<string> | null = null;

	/** ページごとの見出しアンカーマップ（絶対パス → id → アンカー） */
	crossFileAnchors: Map<string, Map<string, string>> | null = null;

	constructor() {
		this.listTable = new ListTableConverter(this.inline);
	}

	convertFile(htmlPath: string, write: boolean): ConvertResult {
		this.inline.reset();

		let html = new TextDecoder('utf-8').decode(fs.readFileSync(htmlPath));
		// BOM は本文の先頭に混ざるので落とす
		if (html.charCodeAt(0) === 0xfeff) { html = html.substring(1); }

		// style は次の行で落ちるので、その前に CSS 変数を読む
		const cssVars = buildCssVars(html);
		html = stripNonContent(html);
		const body = extractBody(html);

		const hasMinibar = /<div\b[^>]*class="[^"]*\bminibar\b/.test(body);
		const dir = path.dirname(htmlPath);
		const baseName = path.basename(htmlPath, path.extname(htmlPath));
		this.inline.setLinkBase(dir, this.convertedPages, this.crossFileAnchors);

		const ctx = newContext();
		ctx.anchors = buildAnchorMap(body);
		ctx.imagesDir = path.join(dir, 'images');
		ctx.basePrefix = baseName;
		ctx.hasMinibar = hasMinibar;
		ctx.write = write;
		ctx.cssVars = cssVars;

		const blocks = this.convertBlocks(body, ctx);
		let md = blocks.join('\n\n');

		// コードスパンを戻したあとで強調の記法を決める（前後の文字を見て判定するため）
		md = this.inline.restoreCodeSpans(md);
		md = Emphasis.resolve(md);

		md = md.replace(/[ \t]+\n/g, '\n');
		md = md.replace(/\n{3,}/g, '\n\n');
		md = md.replace(/\s+$/, '') + '\n';
		// 改行は LF にする。.editorconfig・.gitattributes が .md を LF と宣言しており、
		// CRLF で書くと git を通さない配布経路（zip・共有フォルダ）で宣言と実体が食い違う
		md = md.replace(/\r\n?/g, '\n');

		const mdPath = htmlPath.replace(/\.[^.\\/]*$/, '') + '.md';
		if (write) { fs.writeFileSync(mdPath, new TextEncoder().encode(md)); }

		return { htmlPath: htmlPath, mdPath: mdPath, markdown: md, images: ctx.images };
	}

	/**
	 * 見出しの記号を決める。章（section 内の h1）は h2 相当に下げる。
	 * ミニタイトルバーを使う構成では minibar が章の区切りになるので、配下をもう 1 段下げる。
	 *
	 * 章の外の見出し（目次・索引の案内など）は章と同じ立場なので 1 段上げる。
	 */
	private headingMark(ctx: ConvertContext, htmlLevel: number): string {
		const shift = ctx.hasMinibar ? 2 : 1;
		let level = htmlLevel + shift;
		if (!ctx.inSection && htmlLevel >= 2) { level--; }
		if (level > 6) { level = 6; }
		return '#'.repeat(level) + ' ';
	}

	/**
	 * ブロック要素で囲まれていない地の文を 1 段落として足す。
	 * 空白だけなら何もしない。
	 */
	private addInlineText(html: string, ctx: ConvertContext, outBlocks: string[]): void {
		if (html == null || html.length === 0) { return; }
		const text = this.inline.convert(html, ctx.anchors, false);
		if (text.length > 0) { outBlocks.push(text); }
	}

	/**
	 * 定義リストを箇条書きにする。dt が項目、dd はその下に 4 字下げてぶら下げる。
	 * Markdown に定義リストは無いため、足す記号が - だけで済む形を選んだ。
	 * dt を太字にしない。** は HTML に無い装飾になる。
	 */
	private convertDefList(inner: string, ctx: ConvertContext, outBlocks: string[]): void {
		const lines: string[] = [];
		let i = 0;

		for (;;) {
			const m = /<(dt|dd)\b/.exec(inner.substring(i));
			if (m == null) { break; }
			const start = i + m.index;
			const tag = m[1].toLowerCase();
			const block = getBlock(inner, start, tag);
			i = start + block.outer.length;

			// md-skip は dt・dd のどちらでも、その要素 1 つだけを落とす
			const classes = getClassList(getOpenTag(block.outer));
			if (hasClass(classes, 'md-skip')) { continue; }

			let text = this.inline.convert(block.inner, ctx.anchors, false);
			// 項目の中で改行すると箇条書きが切れる
			text = text.replace(/\s*\r?\n\s*/g, ' ').trim();
			if (text.length === 0) { continue; }
			lines.push((tag === 'dd' ? '    - ' : '- ') + text);
		}

		if (lines.length > 0) { outBlocks.push(lines.join('\n')); }
	}

	/**
	 * 折りたたみはタグのまま出す。GitHub が解釈するため畳みが効く。
	 * summary の後ろと閉じる前に空行を置く。空行が無いと中身が HTML として読まれ、
	 * Markdown の記法が効かない。
	 *
	 * md-flat が付いていれば、畳まずに summary を見出し・中身をその配下の本文にする
	 * （タグ対応仕様の決着 12）。
	 */
	private convertDetails(inner: string, classes: string[], ctx: ConvertContext, outBlocks: string[]): void {
		let summaryText = '';
		const sm = /<summary\b[^>]*>([\s\S]*?)<\/summary>/i.exec(inner);
		if (sm != null) {
			summaryText = this.inline.convert(sm[1], ctx.anchors, false);
			summaryText = summaryText.replace(/\s*\r?\n\s*/g, ' ').trim();
			inner = inner.substring(0, sm.index) + inner.substring(sm.index + sm[0].length);
		}

		const sub = this.convertBlocks(inner, ctx);

		if (hasClass(classes, 'md-flat')) {
			// 見出しに出す分は本文と同じ扱いなので、強調の記法は最終段の判定に任せる
			if (summaryText.length > 0) { outBlocks.push(this.headingMark(ctx, 2) + summaryText); }
			outBlocks.push(...sub);
			return;
		}

		const d: string[] = [];
		d.push('<details>');
		// summary の行は HTML ブロックの中なので ** が効かない。強調はタグで確定させる
		d.push('<summary>' + Emphasis.resolveAsTags(summaryText) + '</summary>');
		for (const b of sub) {
			d.push('');
			d.push(b);
		}
		d.push('');
		d.push('</details>');
		outBlocks.push(d.join('\n'));
	}

	private convertBlocks(html: string, ctx: ConvertContext): string[] {
		const outBlocks: string[] = [];
		if (html == null || html.length === 0) { return outBlocks; }

		const anchors = ctx.anchors;
		let i = 0;

		for (;;) {
			// a は「段落の外に単独」のときだけブロックにする（仕様どおり）。
			// 単独かどうかを確かめずに拾うと、地の文の途中にあるリンクまで
			// 切り出され、またいで掛かる strong 等の閉じタグが対岸に残されて
			// 消えていた（i260908-04）。単独でなければこの a はここでは拾わず、
			// 直後から探し直す（地の文としてまとめて後段に流れる）
			let searchFrom = i;
			let m: RegExpExecArray | null;
			let start = -1;
			let tag = '';
			let block: Block = { outer: '', inner: '' };
			for (;;) {
				m = BlockTags.exec(html.substring(searchFrom));
				if (m == null) { break; }
				const candStart = searchFrom + m.index;
				const candTag = m[1].toLowerCase();
				const candBlock = getBlock(html, candStart, candTag);
				if (candTag === 'a') {
					const before = html.substring(i, candStart);
					const afterEnd = findNextBlockStart(html, candStart + candBlock.outer.length);
					const after = html.substring(candStart + candBlock.outer.length, afterEnd);
					if (getPlainText(before).trim().length > 0 || getPlainText(after).trim().length > 0) {
						searchFrom = candStart + candBlock.outer.length;
						continue;
					}
				}
				start = candStart; tag = candTag; block = candBlock;
				break;
			}
			if (m == null) {
				// 最後のブロックより後ろに残ったテキスト
				this.addInlineText(html.substring(i), ctx, outBlocks);
				break;
			}
			// ブロックの手前に地の文がある場合、それも 1 段落として出す
			this.addInlineText(html.substring(i, start), ctx, outBlocks);
			i = start + block.outer.length;
			const openTag = getOpenTag(block.outer);
			const classes = getClassList(openTag);

			if (hasClass(classes, 'md-skip')) { continue; }

			switch (tag) {
				case 'section': {
					// 章のクラスは配下の SVG が var() を解決するのに使う
					const prevClass = ctx.chapterClass;
					// 入れ子の section を抜けたとき、外側がまだ section の中であることを
					// 忘れない（i260908-04 の変換エンジン2。無条件に false へ戻すと、
					// 入れ子から戻った直後の見出しレベル計算が章の外扱いになっていた）
					const prevInSection = ctx.inSection;
					const found = findChapterClass(classes);
					if (found.length > 0) { ctx.chapterClass = found; }
					ctx.inSection = true;
					outBlocks.push(...this.convertBlocks(block.inner, ctx));
					ctx.inSection = prevInSection;
					ctx.chapterClass = prevClass;
					break;
				}

				case 'footer':
				case 'nav':
				// 文書構造のタグ。中身をそのまま処理する
				case 'main':
				case 'article':
				case 'aside':
				case 'header':
				case 'address':
				// details の外に単独で置かれた summary。中身を段落として出す
				case 'summary':
				// dl の外に単独で置かれた dt・dd も同じ
				case 'dt':
				case 'dd':
				// figure も同じ経路に合流させる。以前は最初の svg と figcaption だけを
				// 正規表現で拾い、それ以外（img・2個目以降の svg・p・table 等）を
				// 黙って捨てていた（i260908-04）。svg は一般の 'svg' ケースが、
				// img はインライン変換が、figcaption は地の文として、それぞれ既に
				// 正しく扱えるため、特別扱いをやめるだけで直る
				case 'figure':
					outBlocks.push(...this.convertBlocks(block.inner, ctx));
					break;

				case 'hr':
					outBlocks.push('---');
					break;

				case 'dl':
					this.convertDefList(block.inner, ctx, outBlocks);
					break;

				case 'details':
					this.convertDetails(block.inner, classes, ctx, outBlocks);
					break;

				case 'blockquote': {
					const sub = this.convertBlocks(block.inner, ctx);
					const q: string[] = [];
					let first = true;
					for (const b of sub) {
						if (!first) { q.push('>'); }
						first = false;
						for (const line of b.split('\n')) { q.push(('> ' + line).replace(/\s+$/, '')); }
					}
					if (q.length > 0) { outBlocks.push(q.join('\n')); }
					break;
				}

				case 'div':
					this.convertDiv(block, classes, ctx, outBlocks);
					break;

				case 'svg': {
					const info = exportSvg(block.outer, ctx);
					outBlocks.push('![' + info.label + '](images/' + info.fileName + ')');
					break;
				}

				case 'table': {
					// caption は表の見出し。Markdown に記法が無いので表の直前の段落にする
					const tabCap = /<caption\b[^>]*>([\s\S]*?)<\/caption>/.exec(block.outer);
					if (tabCap != null) {
						const cap = this.inline.convert(tabCap[1], anchors, false);
						if (cap.length > 0) { outBlocks.push(cap); }
					}
					const t = this.listTable.convertTable(block.outer, anchors);
					if (t.length > 0) { outBlocks.push(t); }
					break;
				}

				case 'h1': {
					const text = this.inline.convert(block.inner, anchors, false);
					if (ctx.inTitlebar) {
						// タイトルバーの h1 は文書のタイトル
						if (text.length > 0) { outBlocks.push('# ' + text); }
					} else {
						ctx.chapterNo++;
						outBlocks.push(this.headingMark(ctx, 1) + ctx.chapterNo + '. ' + text);
					}
					break;
				}

				case 'h2': {
					const text = this.inline.convert(block.inner, anchors, false);
					if (text.length === 0) { break; }
					outBlocks.push(this.headingMark(ctx, 2) + text);
					break;
				}

				case 'h3':
				case 'h4':
				case 'h5':
				case 'h6': {
					const level = Number(tag.substring(1));
					const text = this.inline.convert(block.inner, anchors, false);
					if (text.length > 0) { outBlocks.push(this.headingMark(ctx, level) + text); }
					break;
				}

				case 'p': {
					const text = this.inline.convert(block.inner, anchors, false);
					if (text.length === 0) { break; }
					// タイトルバー内の作成日・更新日は引用行にする
					const isMeta = hasClass(classes, 'date') || hasClass(classes, 'meta');
					if (isMeta || (ctx.inTitlebar && text.startsWith('📅'))) {
						outBlocks.push('> ' + text.replace(/\s*\r?\n\s*/g, ' '));
					} else {
						outBlocks.push(text);
					}
					break;
				}

				case 'ul': {
					const items = hasClass(classes, 'chapters')
						? this.listTable.convertChapters(block.outer, anchors)
						: this.listTable.convertList(block.outer, 'ul', anchors, 0);
					if (items.length > 0) { outBlocks.push(items); }
					break;
				}

				case 'ol': {
					const items = hasClass(classes, 'toc')
						? this.listTable.convertToc(block.outer, anchors)
						: this.listTable.convertList(block.outer, 'ol', anchors, 0);
					if (items.length > 0) { outBlocks.push(items); }
					break;
				}

				case 'pre':
					outBlocks.push(convertPre(block.inner));
					break;

				case 'a': {
					// 段落の外に単独で置かれたリンク（.doclink など）
					const text = this.inline.convert(block.outer, anchors, false);
					if (text.length > 0) { outBlocks.push(text); }
					break;
				}
			}
		}

		return outBlocks.filter(b => b != null && b.length > 0);
	}

	private convertDiv(block: Block, classes: string[], ctx: ConvertContext, outBlocks: string[]): void {
		const anchors = ctx.anchors;

		if (hasClass(classes, 'callout')) {
			let kind = 'NOTE';
			for (const c of classes) {
				const found = CalloutKinds[c];
				if (found !== undefined) { kind = found; }
			}
			const sub = this.convertBlocks(block.inner, ctx);
			const q: string[] = [];
			q.push('> [!' + kind + ']');
			for (const b of sub) {
				for (const line of b.split('\n')) { q.push(('> ' + line).replace(/\s+$/, '')); }
			}
			outBlocks.push(q.join('\n'));
			return;
		}

		if (hasClass(classes, 'titlebar')) {
			ctx.inTitlebar = true;
			outBlocks.push(...this.convertBlocks(block.inner, ctx));
			ctx.inTitlebar = false;
			return;
		}

		if (hasClass(classes, 'minibar')) {
			const text = this.inline.convert(block.inner, anchors, false);
			if (text.length > 0) { outBlocks.push('## ' + text); }
			return;
		}

		if (hasClass(classes, 'toc')) {
			const h = /<h2\b[^>]*>([\s\S]*?)<\/h2>/.exec(block.outer);
			if (h != null) {
				outBlocks.push('## ' + this.inline.convert(h[1], anchors, false));
			}
			const items = this.listTable.convertToc(block.outer, anchors);
			if (items.length > 0) { outBlocks.push(items); }
			return;
		}

		// 日付のクラス名は date に統一したが、meta を使っている既存プロジェクトも受ける
		if (hasClass(classes, 'date') || hasClass(classes, 'meta')) {
			const text = this.inline.convert(block.inner, anchors, false);
			if (text.length > 0) { outBlocks.push('> ' + text.replace(/\s*\r?\n\s*/g, ' ')); }
			return;
		}

		// .wrap や .inner のような位置合わせだけのラッパは中身をそのまま処理する
		outBlocks.push(...this.convertBlocks(block.inner, ctx));
	}
}

/**
 * a が「段落の外に単独」かどうかを見るための先読み。
 * 次のブロックタグが始まる位置（無ければ末尾）を返すだけで、その候補自体が
 * さらに単独でない a かどうかまでは追わない（近似で十分。二重に単独でない
 * a が連続する入力は現実的に考えにくい）。
 */
function findNextBlockStart(html: string, fromIndex: number): number {
	const m = BlockTags.exec(html.substring(fromIndex));
	return m == null ? html.length : fromIndex + m.index;
}

/**
 * 見出しの HTML から、GitHub のアンカーを求める（i260929-03）。
 *
 * 見出しを書き出すときと同じ順（インライン変換 → コードを戻す → 強調を決める）で
 * Markdown の見出しの文字列を作り、検査と同じ getMarkdownHeadingAnchor に渡す。
 * HTML からタグを落とした文字列で計算すると、書き出しで足すもの（バッジの ✅ と
 * 前後の空白、課題番号の後ろの空白）が入らず、実際の見出しとずれる。
 *
 * 変換器は別に作る。本文の変換器が退避したコードを混ぜないため。
 * prefix は章番号（「1. 」）。
 */
function headingAnchor(innerHtml: string, prefix: string): string {
	const conv = new InlineConverter();
	let t = conv.convert(innerHtml, null, false);
	// summary を見出しにするときと同じく、改行は空白にする
	t = t.replace(/\s*\r?\n\s*/g, ' ').trim();
	t = conv.restoreCodeSpans(t);
	t = Emphasis.resolve(t);
	return getMarkdownHeadingAnchor((prefix + t).trim());
}

/**
 * 他ファイルへのアンカー付きリンクを張り替えるための事前パス用。
 * 読み込み済みの HTML から、このファイルの見出しアンカーマップだけを作る。
 */
export function buildAnchorsFromHtml(html: string): Map<string, string> {
	html = stripNonContent(html);
	const body = extractBody(html);
	return buildAnchorMap(body);
}

/**
 * section の id → 生成後の見出しアンカー（目次のリンク張り替え用）。
 *
 * section を 1 つずつ切り出して中の h1 を探す。正規表現で
 * <section>〜<h1> をまとめて拾うと、h1 を持たない
 * <section class="toc"> が次の章の h1 まで飲み込み、
 * 最初の章の id が登録されないまま章番号だけ進む。
 */
function buildAnchorMap(body: string): Map<string, string> {
	const map = new Map<string, string>();
	let no = 0;
	let i = 0;
	for (;;) {
		const m = /<section\b/.exec(body.substring(i));
		if (m == null) { break; }
		const start = i + m.index;
		const block = getBlock(body, start, 'section');
		i = start + block.outer.length;

		const h1 = /<h1\b[^>]*>([\s\S]*?)<\/h1>/.exec(block.outer);
		if (h1 == null) { continue; }   // 目次など h1 を持たない section は章に数えない
		no++;
		const id = getAttr(getOpenTag(block.outer), 'id');
		if (id.length === 0) { continue; }
		map.set(id, headingAnchor(h1[1], no + '. '));
	}
	// h2 / h3 に id が振られている場合も拾う
	for (const m of body.matchAll(/<h([23])\b([^>]*)>([\s\S]*?)<\/h\1>/g)) {
		const id = getAttr('<h' + m[1] + m[2] + '>', 'id');
		if (id.length === 0 || map.has(id)) { continue; }
		map.set(id, headingAnchor(m[3], ''));
	}
	collectFlatDetailsAnchors(body, map, null);
	return map;
}

/**
 * md-flat の details（summary が見出しに展開される）の id → 見出しアンカー（i260921-01）。
 *
 * id は details 自身が持つとは限らず、直接くるむ li・section が持つこともある
 * （課題一覧のように「1件 = li > details」という形にする資料があるため）。
 * section・li・div・ul・ol を辿りながら「直近の id 持ちの li/section」を運び、
 * details に着いた時点で自分の id が無ければそれを使う。
 */
function collectFlatDetailsAnchors(html: string, map: Map<string, string>, ancestorId: string | null): void {
	let i = 0;
	for (;;) {
		const m = /<(section|li|details|div|ul|ol)\b/i.exec(html.substring(i));
		if (m == null) { break; }
		const tag = m[1].toLowerCase();
		const start = i + m.index;
		const block = getBlock(html, start, tag);
		i = start + block.outer.length;

		const openTag = getOpenTag(block.outer);
		const ownId = getAttr(openTag, 'id');

		if (tag === 'details') {
			const classes = getClassList(openTag);
			if (hasClass(classes, 'md-flat')) {
				const id = ownId.length > 0 ? ownId : (ancestorId ?? '');
				if (id.length > 0 && !map.has(id)) {
					const sm = /<summary\b[^>]*>([\s\S]*?)<\/summary>/i.exec(block.inner);
					if (sm != null) { map.set(id, headingAnchor(sm[1], '')); }
				}
			}
		}

		const nextAncestorId = (tag === 'li' || tag === 'section') && ownId.length > 0 ? ownId : ancestorId;
		collectFlatDetailsAnchors(block.inner, map, nextAncestorId);
	}
}

function convertPre(blockInner: string): string {
	let inner = blockInner;
	let lang = '';
	const codeM = /<code\b([^>]*)>([\s\S]*?)<\/code>/.exec(inner);
	if (codeM != null) {
		for (const c of getClassList('<code' + codeM[1] + '>')) {
			if (c.startsWith('language-')) {
				lang = c.substring('language-'.length);
			}
		}
		inner = codeM[2];
	}
	let code = decodeEntities(inner.replace(/<[^>]+>/g, ''));
	code = code.replace(/\r\n/g, '\n');
	// 前後の空行だけを落とす（行頭のインデントは保つ）
	code = code.replace(/^(\s*\n)+/, '');
	code = code.replace(/(\n\s*)+$/, '');
	return '```' + lang + '\n' + code + '\n```';
}
