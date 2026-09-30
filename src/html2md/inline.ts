/*
	インライン要素（リンク・強調・コード・バッジ・画像）を Markdown の記法にする。

	強調はここでは確定させず、センチネルで囲むだけにする。** で書けるかは前後の文字で
	決まり、その文字はブロックを組み立て終わるまで確定しないため。
*/

import * as Emphasis from './emphasis.ts';
import {
	decodeEntities, convertLinkTarget, getAttr, getClassList,
	getPlainText, hasClass, stripTagsRaw,
} from './htmlutil.ts';

/** バッジのクラス名 → Markdown で使う記号。ここに無い b-* は種類を表すラベル扱い */
const BadgeMarks: Record<string, string> = {
	'b-ok': '✅',
	'b-ng': '❌',
	'b-warn': '⚠',
	'b-none': '',
};

// アイコンだけのリンクを Markdown で表す記号。
// 対応は共通ルール「資料間のリンク」が定める（前へ ‹ ／ 次へ › ／ 目次 ⌂）
// 「<<」は退避したまま運ぶ。汎用タグ除去に飲まれるのを防ぐ（最終段で戻す）
const PrevMark = Emphasis.IconPrev;
const NextMark = '>>';
const TocMark = '^^';

export class InlineConverter {
	/**
	 * 以降の変換から外して最後に戻す文字列の退避先。ファイル単位で作り直す。
	 * コードスパンと、タグのまま残すインラインタグが入る。
	 */
	private codeSpans: string[] = [];

	/** 相対リンクを解決する基準。変換中の HTML があるフォルダ */
	private linkBaseDir = '';

	/** この実行で .md が生成されるページ（絶対パス）。ここへのリンクだけ .md にする */
	private convertedPages: Set<string> | null = null;

	/** 変換対象ページごとの見出しアンカーマップ（絶対パス → id → アンカー） */
	private crossAnchors: Map<string, Map<string, string>> | null = null;

	reset(): void {
		this.codeSpans = [];
	}

	/** リンクの置き換えに使う基準フォルダと、Markdown が生成されるページの一覧・アンカーマップ */
	setLinkBase(baseDir: string | null, pages: Set<string> | null,
		anchorsByFile: Map<string, Map<string, string>> | null): void {
		this.linkBaseDir = baseDir == null ? '' : baseDir;
		this.convertedPages = pages;
		this.crossAnchors = anchorsByFile;
	}

	private storeCodeSpan(text: string): string {
		const i = this.codeSpans.length;
		this.codeSpans.push(text);
		return Emphasis.CodeSpan + String(i) + Emphasis.StoreEnd;
	}

	/** 退避した文字列を本文に戻す */
	restoreCodeSpans(text: string): string {
		let t = text;
		for (let i = this.codeSpans.length - 1; i >= 0; i--) {
			const key = Emphasis.CodeSpan + String(i) + Emphasis.StoreEnd;
			t = t.split(key).join(this.codeSpans[i]);
		}
		return t;
	}

	/** インライン要素を変換する。inTable のときはセル区切りを壊さないようにする */
	convert(html: string, anchors: Map<string, string> | null, inTable: boolean): string {
		if (html == null || html.length === 0) { return ''; }
		let s = html;

		// セル内に置かれたコードブロックは 1 行のコード表記に落とす
		s = s.replace(/<pre\b[^>]*>\s*<code\b[^>]*>([\s\S]*?)<\/code>\s*<\/pre>/g, (_m, g1: string) => {
			let code = decodeEntities(g1.replace(/<[^>]+>/g, ''));
			code = code.replace(/\r?\n/g, ' ').split('`').join("'");
			code = code.trim();
			// 表のセルでは、コードスパンの中でも | を \| にする（GFM はセル内の
			// code の | も列区切りとして数える）。退避後に一括エスケープすると
			// 中身が対象から外れて素通りするため、退避前にここで処理する。
			if (inTable) { code = code.split('|').join('\\|'); }
			return this.storeCodeSpan('`' + code + '`');
		});

		// コードスパンは退避する（中身を他の変換の対象から外すため）
		s = s.replace(/<code\b[^>]*>([\s\S]*?)<\/code>/g, (_m, g1: string) => {
			let code = decodeEntities(g1.replace(/<[^>]+>/g, ''));
			if (inTable) { code = code.split('|').join('\\|'); }
			return this.storeCodeSpan('`' + code + '`');
		});

		// バッジは色でしか区別していないので、記号＋太字の文字情報に落とす。
		// 記号は太字の外に置く（内側に入れると ** が開かない）
		s = s.replace(/<span\b([^>]*)>([\s\S]*?)<\/span>/g, (_m, g1: string, g2: string) => {
			const classes = getClassList('<span' + g1 + '>');
			if (hasClass(classes, 'md-skip')) { return ''; }
			const inner = g2;
			// 課題番号（.no）は CSS の余白でしか本文と離れていないため、空白 1 個を
			// 補って続く文と分ける。余白は Markdown に持ち込めない（決着 12）
			if (hasClass(classes, 'no')) { return inner + ' '; }
			const mark = getBadgeMark(classes);
			if (mark == null) { return inner; }
			const text = stripTagsRaw(inner);
			if (text.length === 0) { return ''; }
			const body = Emphasis.StrongBegin + text + Emphasis.StrongEnd;
			// バッジは CSS の余白で本文と離れていたので、空白 1 個を補って続く文と分ける
			if (mark.length > 0) { return mark + ' ' + body + ' '; }
			return body + ' ';
		});

		// 画像
		s = s.replace(/<img\b([^>]*?)\/?>/g, (_m, g1: string) => {
			const tag = '<img' + g1 + '>';
			const src = getAttr(tag, 'src');
			if (src.length === 0) { return ''; }
			const alt = getAttr(tag, 'alt');
			return '![' + alt + '](' + src + ')';
		});

		// リンク: 拡張子を .md に置き換え、ページ内アンカーは見出しアンカーへ張り替える
		s = s.replace(/<a\b([^>]*)>([\s\S]*?)<\/a>/g, (_m, g1: string, g2: string) => {
			const tag = '<a' + g1 + '>';
			let href = getAttr(tag, 'href');
			let text = stripTagsRaw(g2);
			// 中身が絵（SVG）だけのリンクは、タグを落とすと文字が残らない。
			// 代替テキストを探して記号に置き換える（i260912-05）
			if (text.trim().length === 0) { text = iconLinkText(tag, g2); }
			if (href.length === 0) { return text; }
			if (href.startsWith('#')) {
				const key = href.substring(1);
				const mapped = anchors?.get(key);
				if (mapped != null) { href = '#' + mapped; }
			} else {
				href = convertLinkTarget(href, this.linkBaseDir, this.convertedPages, this.crossAnchors);
			}
			return '[' + text + '](' + href + ')';
		});

		// 強調はセンチネルで囲むだけにして、記法は最終段で決める
		s = s.replace(/<(strong|b)\b[^>]*>([\s\S]*?)<\/\1>/g, (_m, _t: string, inner: string) => {
			if (getPlainText(inner).length === 0) { return ''; }
			return Emphasis.StrongBegin + inner + Emphasis.StrongEnd;
		});
		s = s.replace(/<(em|i)\b[^>]*>([\s\S]*?)<\/\1>/g, (_m, _t: string, inner: string) => {
			if (getPlainText(inner).length === 0) { return ''; }
			return Emphasis.EmBegin + inner + Emphasis.EmEnd;
		});

		// 取り消し線。GitHub は ~~ を解釈するが、** と同じ前後判定を受けるので
		// 記法にするかタグにするかは最終段で決める
		s = s.replace(/<(del)\b[^>]*>([\s\S]*?)<\/\1>/g, (_m, _t: string, inner: string) => {
			if (getPlainText(inner).length === 0) { return ''; }
			return Emphasis.DelBegin + inner + Emphasis.DelEnd;
		});

		// GitHub が解釈するインラインタグは、タグのまま残す。平文に落とすより情報が残る。
		// 開きと閉じだけ退避し、中身は通常の変換を通す。
		s = s.replace(/<\/?(?:ins|sup|sub|mark|kbd|q)\b[^>]*>/g, m => this.storeCodeSpan(m));

		// <br> はタグ除去で消えないよう退避する
		s = s.replace(/<br\s*\/?>/g, Emphasis.Break);

		// 残ったタグを落とす
		s = s.replace(/<[^>]+>/g, '');
		s = decodeEntities(s);
		s = s.replace(/\s+/g, ' ');

		// <br> はタグのまま出す。表の中と外で表現を揃える
		s = s.split(Emphasis.Break).join('<br>');
		// 退避しておいた「<<」を戻す（タグ除去を通り過ぎた後）
		s = s.split(Emphasis.IconPrev).join('<<');

		if (inTable) {
			// セル区切りとの衝突を避ける
			s = s.split('|').join('\\|');
		}
		return s.trim();
	}
}

/**
 * 中身が絵（SVG）だけのリンクに与える文字。
 *
 *   1. aria-label → title → SVG の中の <title> の順で代替テキストを探す
 *   2. 決まった語なら記号に置き換える。表に無い語はその語をそのまま文字にする
 *   3. 代替テキストが無ければ、共通ルールが定めるクラス（backlink）を見る
 *   4. どれも無ければ空を返す。Markdown を壊さず、検査側で指摘する
 *
 * SVG の形（path の d）では判別しない。共通ルールはアイコンの意味だけを
 * 定めており、d の実値に規定が無いため、辞書を持っても当たる保証が無い。
 */
function iconLinkText(tag: string, inner: string): string {
	let label = getAttr(tag, 'aria-label');
	if (label.length === 0) { label = getAttr(tag, 'title'); }
	if (label.length === 0) {
		const t = /<title\b[^>]*>([\s\S]*?)<\/title>/.exec(inner);
		if (t != null) { label = stripTagsRaw(t[1]); }
	}

	label = label.trim();
	if (label.length === 0) {
		const classes = getClassList(tag);
		if (hasClass(classes, 'backlink')) { return TocMark; }
		return '';
	}
	return markForLabel(label);
}

/** 代替テキストを記号にする。表に無い語はそのまま返す */
function markForLabel(label: string): string {
	if (label === '前へ' || label === '前' || isWord(label, 'prev') || isWord(label, 'previous')) { return PrevMark; }
	if (label === '次へ' || label === '次' || isWord(label, 'next')) { return NextMark; }
	if (label === '目次' || label === '戻る' || isWord(label, 'toc')
		|| isWord(label, 'contents') || isWord(label, 'home') || isWord(label, 'index')) { return TocMark; }
	return label;
}

function isWord(label: string, word: string): boolean {
	return label.toLowerCase() === word.toLowerCase();
}

/**
 * バッジのクラスから記号を求める。バッジでなければ null。
 * 記号が決まらない b-* は種類を表すラベルなので空文字（太字だけにする）。
 */
function getBadgeMark(classes: string[]): string | null {
	let isBadge = hasClass(classes, 'badge');
	let mark: string | null = null;
	for (const c of classes) {
		if (!c.startsWith('b-')) { continue; }
		const found = BadgeMarks[c];
		if (found !== undefined) {
			mark = found;
			isBadge = true;
			break;
		}
		// b-esm のような種類のラベル
		isBadge = true;
		mark = '';
	}
	if (!isBadge) { return null; }
	return mark == null ? '' : mark;
}
