/*
	生成した Markdown と元の HTML を機械的に検査する。

	リンクとクラス名の検査は、コードブロックとコードスパンの中を除く。
	HTML の書き方を説明する文書では、pre や code の中にコード例としてリンクが現れる。
	タグを実体参照でエスケープしても属性の中身は生のままなので、素朴に拾うと
	存在しないファイルへのリンクとして誤検出する。
*/

import * as fs from 'node:fs';
import * as path from 'node:path';
import {
	decodeEntities, getAttr, getMarkdownHeadingAnchor, getPlainText,
	resolveLink, stripNonContent, stripTagsRaw,
} from './htmlutil.ts';
import type { ConvertResult } from './context.ts';

/*
	Markdown のリンク先（[…](ここ)）。中に対応した括弧を 1 段まで含められる。
	[^)]* で取ると Grok_(chatbot) のような URL の最初の ) で切れ、残りの ) が
	「HTML に無い文言」になった（ai-chat-lite #1307）。GitHub も対応した括弧はリンク先として読む
*/
// 対応しない括弧や空白を含むものは、生成側が <…> で囲んで出す（i261003-02）。その形も読む
const LINK_DEST = '(?:<[^<>\\n]*>|(?:[^()]|\\([^()]*\\))*)';

function readText(p: string): string {
	let s = new TextDecoder('utf-8').decode(fs.readFileSync(p));
	if (s.charCodeAt(0) === 0xfeff) { s = s.substring(1); }
	return s;
}

function existsAny(p: string): boolean {
	return fs.existsSync(p);
}

/** 検査の対象から pre と code の中身を落とす */
export function stripCodeAreas(html: string): string {
	let t = html.replace(/<pre\b[\s\S]*?<\/pre>/g, '');
	t = t.replace(/<code\b[^>]*>[\s\S]*?<\/code>/g, '');
	return t;
}

/** Markdown の見出し行から、GitHub のアンカーの一覧を作る */
function getHeadingAnchors(markdown: string): string[] {
	const heads: string[] = [];
	for (const m of markdown.matchAll(/^#{1,6}[ \t]+(.+)$/gm)) {
		heads.push(getMarkdownHeadingAnchor(m[1]));
	}
	return heads;
}

/**
 * Markdown 側のリンク切れとアンカー切れ。
 * expected には、この実行で生成する（または生成するはずだった）ファイルの絶対パスを渡す。
 * --dry-run では実際には書き出さないため、これを実在扱いにしないと全部リンク切れになる。
 *
 * markdownByPath は、この実行で変換した他ページの Markdown（絶対パス → 本文）。
 */
export function testMdLinks(result: ConvertResult, expected: Set<string> | null,
	markdownByPath: Map<string, string> | null): string[] {
	const dir = path.dirname(result.mdPath);
	const md = result.markdown;

	const heads = getHeadingAnchors(md);

	const bad: string[] = [];
	// フェンスとコードスパンの中は対象にしない。
	// 書き方を説明する文書では ![](images/xxx.svg) のような例がコードとして現れる
	let body = md.replace(/```[\s\S]*?```/g, '');
	body = body.replace(/`[^`\r\n]*`/g, '');
	for (const m of body.matchAll(new RegExp('!?\\[[^\\]]*\\]\\((' + LINK_DEST + ')\\)', 'g'))) {
		// <…> で囲んだリンク先は、囲みを外した中身が本体
		const link = m[1].startsWith('<') && m[1].endsWith('>') ? m[1].slice(1, -1) : m[1];

		// アイコンだけのリンクで代替テキストが無いと、ここが空になる。
		// GitHub では何も表示されず、リンクがあることに気づけない（i260912-05）。
		// 画像（!）は alt が空でも正当なので対象にしない
		if (m[0].startsWith('[]')) {
			bad.push('リンクの文字が空です（aria-label か title を付けてください）: ' + link);
		}

		if (/^(https?:|mailto:|tel:)/.test(link)) { continue; }
		if (link.startsWith('#')) {
			if (!heads.includes(link.substring(1))) { bad.push('アンカー先なし: ' + link); }
			continue;
		}
		const full = resolveLink(dir, link);
		if (full == null) { continue; }

		const inExpected = expected != null && expected.has(full.toLowerCase());
		if (!inExpected && !existsAny(full)) {
			bad.push('リンク切れ: ' + link);
			continue;
		}

		// 他ファイルへのアンカーも、リンク先の見出しから実在を確かめる
		const hashIdx = link.indexOf('#');
		if (hashIdx >= 0 && path.extname(full).toLowerCase() === '.md') {
			const anchor = link.substring(hashIdx + 1);
			let targetMd = markdownByPath?.get(full.toLowerCase());
			if (targetMd == null) {
				targetMd = existsAny(full) ? readText(full) : undefined;
			}
			if (targetMd != null && !getHeadingAnchors(targetMd).includes(anchor)) {
				bad.push('他ファイルのアンカー先なし: ' + link);
			}
		}
	}
	return bad;
}

/**
 * HTML 側のリンクが .md を指していないか、参照先が実在するか。
 * Markdown 側だけを検査すると、変換で .md になった分と区別できず見逃す。
 */
export function testHtmlLinks(htmlPath: string): string[] {
	let html = readText(htmlPath);
	html = html.replace(/<!--[\s\S]*?-->/g, '');
	html = stripCodeAreas(html);
	const dir = path.dirname(htmlPath);

	const bad: string[] = [];
	for (const m of html.matchAll(/href="([^"]+)"/g)) {
		const href = m[1];
		if (/^(https?:|mailto:|tel:|#)/.test(href)) { continue; }
		if (/\.md($|[#?])/.test(href)) {
			bad.push('.md を参照: ' + href + '（HTML には常に .html と書く）');
			continue;
		}
		const full = resolveLink(dir, href);
		if (full == null) { continue; }
		if (!existsAny(full)) { bad.push('リンク切れ: ' + href); }
	}
	return bad;
}

/**
 * 比較用に記号を落とす。Markdown 側と HTML 側に同じ処理をかけること。
 * 片方だけで落とすと、コード例に含まれる * や \ や <strong> が差分に見えて誤検出する。
 */
function normalize(s: string): string {
	let t = s;
	// 記法そのものがコード例として本文に現れることがあるので、両側で同じ扱いにする。
	// 画像は元が SVG なら HTML の本文に対応が無いため、両側から落とす
	t = t.replace(new RegExp('!\\[[^\\]]*\\]\\(' + LINK_DEST + '\\)', 'g'), '');
	t = t.replace(new RegExp('\\[([^\\]]*)\\]\\(' + LINK_DEST + '\\)', 'g'), '$1');
	// タグのまま出すもの。属性を持つものがあるので開きタグは属性まで含めて落とす
	t = t.replace(/<\/?(?:strong|em|br|del|ins|sup|sub|mark|kbd|abbr|small|q|cite|time|details|summary)\b[^>]*>/g, '');
	t = t.split('\\|').join('|');
	// 記法の記号（* ` | ~）とパス区切りの \ は、どちらの側に現れても落とす
	t = t.replace(/[*`|~\\]/g, '');
	// 色分けの代替として認めた記号
	t = t.replace(/[✅❌⚠⬜✖―]/g, '');
	// アイコンだけのリンクの代替として認めた記号（共通ルール「資料間のリンク」）。
	// 両側に同じ規則で効くので、本文に素で現れても取り違えない
	t = t.split('<<').join('').split('>>').join('').split('^^').join('');
	t = t.split('️').join('');   // 異体字セレクタ
	t = t.replace(/\s/g, '');
	return t;
}

/** Markdown の 1 行から、記法と色分けの代替記号を落として比較用の文字列にする */
function compareText(line: string): string {
	let s = line;
	s = s.replace(/^\s*>\s*\[!\w+\]\s*$/, '');
	s = s.replace(/^\s*>\s?/, '');
	s = s.replace(/^\s*#{1,6}\s*/, '');
	s = s.replace(/^\s*[-+]\s+/, '');
	s = s.replace(/^\s*\d+\.\s+/, '');
	return normalize(s);
}

/**
 * Markdown 側にしか存在しない文言が無いか。
 * 変換は記法の置き換えだけを行い、文言は HTML と同一にする決まりのため、
 * HTML の可視テキストに無い文字列が現れたら付け足しとみなす。
 */
export function testExtraText(result: ConvertResult): string[] {
	let html = readText(result.htmlPath);
	html = stripNonContent(html);

	// アイコンだけのリンクは、aria-label / title が可視テキストの代わりになる。
	// 末尾にまとめて足すだけだと、続く地の文と繋がった行（「…にする: 付録」）が
	// 一致しなくなるため、元の位置に埋めておく（i260912-05）
	html = html.replace(/(<a\b[^>]*>)([\s\S]*?)(<\/a>)/g, (m, g1: string, g2: string, g3: string) => {
		if (stripTagsRaw(g2).length > 0) { return m; }
		let label = getAttr(g1, 'aria-label');
		if (label.length === 0) { label = getAttr(g1, 'title'); }
		return g1 + label + g3;
	});

	// aria-label は属性なのでタグ除去で消える。画像の alt と突き合わせるため足す
	let labels = '';
	for (const m of html.matchAll(/aria-label="([^"]*)"/g)) {
		labels += decodeEntities(m[1]);
	}
	// data-columns も属性。chapters の表見出しはここにしか無い文言なので同じく足す
	// （カンマは Markdown 側の見出し行に出ないため、比較前に落としておく）
	for (const m of html.matchAll(/data-columns="([^"]*)"/g)) {
		labels += decodeEntities(m[1]).split(',').join('');
	}
	const plain = normalize(getPlainText(html) + labels);

	const extra: string[] = [];
	let inFence = false;
	let lineNo = 0;
	for (const line of result.markdown.split(/\r?\n/)) {
		lineNo++;
		// callout の中のコードフェンスは "> ```" の形になる。
		// 引用記号を外してから判定しないとフェンスの内外を取り違える
		const lineHead = line.trimStart().replace(/^>\s?/, '').trimStart();
		if (lineHead.startsWith('```')) {
			inFence = !inFence;
			continue;
		}
		if (inFence) { continue; }
		if (line.trim().length === 0) { continue; }
		// 表の区切り行は記法そのもの
		if (/^\s*\|?[\s:|-]+\|?\s*$/.test(line)) { continue; }

		let c = compareText(line);
		// 章見出しに付けた連番は HTML に無いので落とす
		c = c.replace(/^\d+\./, '');
		if (c.length < 2) { continue; }
		if (!plain.includes(c)) {
			let head = line.trim();
			if (head.length > 90) { head = head.substring(0, 90) + '…'; }
			extra.push(lineNo + ' 行目: ' + head);
		}
	}
	return extra;
}

/**
 * HTML の更新日が、ファイルの最終更新時刻より古くないか。
 * 体裁だけの変更では更新日を変えない決まりのため、警告に留める。
 */
export function testUpdatedDate(htmlPath: string): string {
	const html = readText(htmlPath);
	// 日本語の「作成: … / 更新: …」か、英語の「Created: … / Updated: …」（i261003-01）。
	// 書き方が揺れないよう、この 2 つの形だけを認める（混在や大小の違いは認めない）
	const m = /作成:\s*([\d-]+)\s*\/\s*更新:\s*([\d-]+)/.exec(html)
		?? /Created:\s*([\d-]+)\s*\/\s*Updated:\s*([\d-]+)/.exec(html);
	if (m == null) { return '作成日・更新日の記載が見つかりません'; }

	const written = m[2];
	if (!/^\d{4}-\d{2}-\d{2}$/.test(written)) {
		return '更新日の書式が不正です: ' + written;
	}
	const parts = written.split('-').map(Number);
	const parsed = new Date(parts[0], parts[1] - 1, parts[2]);
	if (isNaN(parsed.getTime())) {
		return '更新日の書式が不正です: ' + written;
	}

	const st = fs.statSync(htmlPath).mtime;
	const mtime = new Date(st.getFullYear(), st.getMonth(), st.getDate());
	if (parsed < mtime) {
		const y = mtime.getFullYear();
		const mo = String(mtime.getMonth() + 1).padStart(2, '0');
		const d = String(mtime.getDate()).padStart(2, '0');
		return '更新日が古い可能性: ヘッダ ' + written + ' / ファイル更新 '
			+ y + '-' + mo + '-' + d + '（体裁だけの変更ならこのままでよい）';
	}
	return '';
}
