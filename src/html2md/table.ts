/*
	表・リスト・目次を Markdown にする。

	C# 版（src/Html2MdCs/Table.cs）の移植。
*/

import { getAttr, getBlock, getClassList, getOpenTag, hasClass } from './htmlutil.ts';
import type { InlineConverter } from './inline.ts';

interface Cell {
	text: string;
	colSpan: number;
	rowSpan: number;
	isNum: boolean;
	isHead: boolean;
}

export class ListTableConverter {
	/*
		引数に修飾子を付けて宣言を兼ねる書き方（parameter property）は使わない。
		node は TypeScript を型注釈の除去だけで走らせるため、
		ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX で落ちる（bun は通る）。
		ランチャーは bun が無ければ node に落ちるので、両方で動く形にする。
	*/
	private readonly inline: InlineConverter;

	constructor(inline: InlineConverter) {
		this.inline = inline;
	}

	/**
	 * 表を Markdown のテーブルにする。
	 * Markdown にセル結合が無いため、rowspan / colspan は結合元に文字を置いて残りを空欄にする。
	 * 列全体が num のときだけ右寄せにする。
	 */
	convertTable(tableHtml: string, anchors: Map<string, string> | null): string {
		// thead があればその範囲の行をヘッダとみなす
		let headEnd = -1;
		const mHead = /<thead\b[^>]*>[\s\S]*?<\/thead>/.exec(tableHtml);
		if (mHead != null) { headEnd = mHead.index + mHead[0].length; }

		const rows: Cell[][] = [];
		for (const rm of tableHtml.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/g)) {
			const isHeadRow = headEnd >= 0 && rm.index < headEnd;
			const cells: Cell[] = [];
			for (const cm of rm[1].matchAll(/<(t[hd])\b([^>]*)>([\s\S]*?)<\/\1>/g)) {
				const attrs = cm[2];
				const cellClasses = getClassList('<td' + attrs + '>');
				// md-skip のセルは空セルにする（part/desc の省略時と同じ落とし方）。
				// colspan/rowspan の展開は列数がずれると崩れるため、行・列ごと削らない
				cells.push({
					text: hasClass(cellClasses, 'md-skip') ? '' : this.inline.convert(cm[3], anchors, true),
					colSpan: parseSpan(attrs, 'colspan'),
					rowSpan: parseSpan(attrs, 'rowspan'),
					isNum: hasClass(cellClasses, 'num'),
					isHead: isHeadRow || cm[1].toLowerCase() === 'th',
				});
			}
			if (cells.length > 0) { rows.push(cells); }
		}
		if (rows.length === 0) { return ''; }

		const grid = new Map<string, string>();
		const numCount = new Map<number, number>();
		const dataCount = new Map<number, number>();
		let maxCol = 0;
		// 行数は実際の <tr>（中身が空の行は rows に積んでいないので既に除かれている）
		// と常に一致する。rowspan から数え直すと、実際の行数を超える指定（HTML の
		// 誤り）のとき、実在しない行まで数えてしまい空行が出る（i260908-04）
		const rowCount = rows.length;

		for (let r = 0; r < rows.length; r++) {
			let c = 0;
			for (const cell of rows[r]) {
				while (grid.has(key(r, c))) { c++; }
				for (let dr = 0; dr < cell.rowSpan; dr++) {
					const rr = r + dr;
					if (rr >= rowCount) { break; }   // 実在しない行への展開は捨てる
					for (let dc = 0; dc < cell.colSpan; dc++) {
						const cc = c + dc;
						grid.set(key(rr, cc), (dr === 0 && dc === 0) ? cell.text : '');
					}
				}
				// 数値列の判定はヘッダを除いたデータ行だけで行う
				if (!cell.isHead) {
					increment(dataCount, c);
					if (cell.isNum) { increment(numCount, c); }
				}
				c += cell.colSpan;
				if (c > maxCol) { maxCol = c; }
			}
		}
		if (maxCol === 0 || rowCount === 0) { return ''; }

		const sep: string[] = [];
		for (let c = 0; c < maxCol; c++) {
			const n = numCount.get(c) ?? 0;
			const d = dataCount.get(c) ?? 0;
			sep.push((n > 0 && n === d) ? '---:' : '---');
		}

		const lines: string[] = [];
		for (let r = 0; r < rowCount; r++) {
			const cols: string[] = [];
			for (let c = 0; c < maxCol; c++) {
				cols.push(grid.get(key(r, c)) ?? '');
			}
			lines.push('| ' + cols.join(' | ') + ' |');
			if (r === 0) { lines.push('|' + sep.join('|') + '|'); }
		}
		return lines.join('\n');
	}

	/** リストを変換する。入れ子は 4 空白ずつ字下げする */
	convertList(listHtml: string, tag: string, anchors: Map<string, string> | null, depth: number): string {
		// リストの中身。閉じられていない場合も末尾までを中身とする
		const inner = getBlock(listHtml, 0, tag).inner;
		const indent = ' '.repeat(4 * depth);
		const outLines: string[] = [];
		let n = 0;
		let i = 0;

		for (;;) {
			const m = /<li\b/.exec(inner.substring(i));
			if (m == null) { break; }
			const start = i + m.index;
			const block = getBlock(inner, start, 'li');
			i = start + block.outer.length;

			const liClasses = getClassList(getOpenTag(block.outer));
			if (hasClass(liClasses, 'md-skip')) { continue; }

			let liInner = block.inner;

			// 入れ子のリストを取り出してから、残りを 1 行のテキストにする
			const nested: Array<[string, string]> = [];
			for (;;) {
				const nm = /<(ul|ol)\b/.exec(liInner);
				if (nm == null) { break; }
				const nTag = nm[1].toLowerCase();
				const nBlock = getBlock(liInner, nm.index, nTag).outer;
				nested.push([nTag, nBlock]);
				liInner = liInner.substring(0, nm.index) + liInner.substring(nm.index + nBlock.length);
			}

			let text = this.inline.convert(liInner, anchors, false);
			text = text.replace(/\s*\r?\n\s*/g, ' ');
			if (text.length === 0 && nested.length === 0) { continue; }
			n++;
			if (tag === 'ol') {
				outLines.push(indent + n + '. ' + text);
			} else {
				outLines.push(indent + '- ' + text);
			}

			for (const [nTag, nBlock] of nested) {
				const sub = this.convertList(nBlock, nTag, anchors, depth + 1);
				if (sub.length > 0) { outLines.push(sub); }
			}
		}
		return outLines.join('\n');
	}

	/** 目次を、生成後の見出しアンカーに向けた番号付きリストにする */
	convertToc(tocHtml: string, anchors: Map<string, string>): string {
		const outLines: string[] = [];
		let n = 0;
		for (const li of tocHtml.matchAll(/<li\b([^>]*)>([\s\S]*?)<\/li>/g)) {
			// md-skip の項目は番号も消費させない（残りが 1 から連番になる）
			const liClasses = getClassList('<li' + li[1] + '>');
			if (hasClass(liClasses, 'md-skip')) { continue; }

			const a = /<a\b[^>]*href="#([^"]+)"[^>]*>([\s\S]*?)<\/a>/.exec(li[2]);
			if (a == null) { continue; }
			n++;
			const id = a[1];
			const text = this.inline.convert(a[2], anchors, false);
			const anchor = anchors.get(id) ?? id;
			outLines.push(n + '. [' + text + '](#' + anchor + ')');
		}
		return outLines.join('\n');
	}

	/**
	 * class="chapters" のリストを、data-columns の 3 列見出しを持つ表にする。
	 * タグ対応仕様の決着 10 を参照。data-columns が無い・列数が 3 でなければ
	 * エラーで止める（黙って見出しの無い表を出さない）。
	 * part / desc は行ごとに省略でき、その列は空セルになる。
	 */
	convertChapters(ulHtml: string, anchors: Map<string, string> | null): string {
		// ulHtml は開きタグから始まる（block.outer）。開きタグ部分から属性を取る
		const openEnd = ulHtml.indexOf('>');
		const openTag = openEnd >= 0 ? ulHtml.substring(0, openEnd + 1) : ulHtml;
		const columnsAttr = getAttr(openTag, 'data-columns');
		if (columnsAttr.length === 0) {
			throw new Error(
				'class="chapters" には data-columns が必須です（例: data-columns="部,タイトル,内容"）。'
				+ '表の見出しは HTML に書かれた文言しか使えません。');
		}
		const headers = columnsAttr.split(',');
		if (headers.length !== 3) {
			throw new Error('data-columns は 3 列で指定してください（part, ttl, desc に対応）: ' + columnsAttr);
		}

		const inner = getBlock(ulHtml, 0, 'ul').inner;
		const rows: string[][] = [];
		let i = 0;
		for (;;) {
			const m = /<li\b/.exec(inner.substring(i));
			if (m == null) { break; }
			const start = i + m.index;
			const block = getBlock(inner, start, 'li');
			i = start + block.outer.length;

			// md-skip の項目は行ごと落とす（空セルの行を残すと表に空行が並ぶ）
			const liClasses = getClassList(getOpenTag(block.outer));
			if (hasClass(liClasses, 'md-skip')) { continue; }

			const liInner = block.inner;

			const part = this.extractSpanText(liInner, 'part', anchors);
			const desc = this.extractSpanText(liInner, 'desc', anchors);

			// ttl は生のまま取り出し、a で囲む href があれば合成 <a> にして inline.convert に
			// 通す。ほかのリンクと同じ経路（.md 置換・他ファイルのアンカー張り替え）を通すため。
			//
			// href は「ttl を囲む a」からだけ取る。li 内の最初の a を無条件に使うと、
			// desc 側だけにリンクがあるケースでも ttl が誤ってリンク化される
			const ttlRaw = extractSpanRaw(liInner, 'ttl');
			let href = '';
			for (const aTag of liInner.matchAll(/<a\b([^>]*)>[\s\S]*?<\/a>/g)) {
				if (/class\s*=\s*"[^"]*\bttl\b[^"]*"/.test(aTag[0])) {
					href = getAttr('<a' + aTag[1] + '>', 'href');
					break;
				}
			}
			let ttl: string;
			if (href.length > 0 && ttlRaw.length > 0) {
				ttl = this.inline.convert('<a href="' + href + '">' + ttlRaw + '</a>', anchors, true);
			} else {
				ttl = this.inline.convert(ttlRaw, anchors, true);
			}
			ttl = ttl.replace(/\s*\r?\n\s*/g, ' ');

			if (part.length === 0 && ttl.length === 0 && desc.length === 0) { continue; }
			rows.push([part, ttl, desc]);
		}
		if (rows.length === 0) { return ''; }

		const lines: string[] = [];
		lines.push('| ' + headers.join(' | ') + ' |');
		lines.push('|---|---|---|');
		for (const row of rows) {
			lines.push('| ' + row.join(' | ') + ' |');
		}
		return lines.join('\n');
	}

	private extractSpanText(html: string, className: string, anchors: Map<string, string> | null): string {
		const raw = extractSpanRaw(html, className);
		if (raw.length === 0) { return ''; }
		const text = this.inline.convert(raw, anchors, true);
		return text.replace(/\s*\r?\n\s*/g, ' ');
	}
}

/** 指定クラスの span の中身を、変換せず生の HTML のまま返す */
function extractSpanRaw(html: string, className: string): string {
	for (const m of html.matchAll(/<span\b([^>]*)>([\s\S]*?)<\/span>/g)) {
		if (hasClass(getClassList('<span' + m[1] + '>'), className)) {
			return m[2];
		}
	}
	return '';
}

function key(r: number, c: number): string {
	return r + ',' + c;
}

function parseSpan(attrs: string, name: string): number {
	const m = new RegExp(name + '="(\\d+)"').exec(attrs);
	if (m == null) { return 1; }
	const v = Number(m[1]);
	if (!Number.isInteger(v) || v < 1) { return 1; }
	return v;
}

function increment(map: Map<number, number>, k: number): void {
	map.set(k, (map.get(k) ?? 0) + 1);
}
