/*
	課題の本文 (Markdown) を HTML に直す。issue render が使う。
	仕様は notes/50_spec/課題ファイルの形と検査.html (HTML の表示)、決めた経緯は計画 p261103-01。

	外部のパッケージは使わず、課題の本文に出てくる範囲だけを扱う:
		見出し (## → h3、### → h4 …) ・ 段落 ・ 箇条書き (入れ子 ・ 番号つき ・ やること行) ・ コードブロック ・
		表 ・ 引用 ・ callout (> [!NOTE] 等) ・ 区切り線 ・ 太字 ・ インラインのコード ・ リンク ・ 画像 ・ <br>
	Markdown の中の HTML は、解釈せずエスケープする (<br> だけは改行として通す)。
*/

export type MdOptions = {
	/** 画像の src を決める (# の後ろは除いて渡す)。見つからなければ null */
	resolveImage(href: string): string | null;
	/** 画像でないリンクの href を決める (相対パスのもの)。リンクにしないなら null */
	resolveLink(href: string): string | null;
	/** 警告 (画像が見つからない等) */
	warn(message: string): void;
};

export function escapeHtml(text: string): string {
	return text.split('&').join('&amp;').split('<').join('&lt;').split('>').join('&gt;').split('"').join('&quot;');
}

/** やること行の状態のバッジの class */
export const BadgeOfState: Record<string, string> = { 未: 'b-none', 着手: 'b-warn', 済: 'b-ok' };

const CalloutClass: Record<string, string> = {
	NOTE: 'callout',
	TIP: 'callout callout-tip',
	IMPORTANT: 'callout callout-important',
	WARNING: 'callout callout-warning',
	CAUTION: 'callout callout-caution',
};

// ---- インライン ----

function imageHtml(alt: string, rawHref: string, o: MdOptions): string {
	const hash = rawHref.indexOf('#');
	const href = hash >= 0 ? rawHref.slice(0, hash) : rawHref;
	const fragment = hash >= 0 ? rawHref.slice(hash + 1) : '';
	// 明るい版 ・ 暗い版は両方を出し、表示の明暗で CSS が切り替える (129-A ・ 160-B)
	const theme = fragment === 'gh-light-mode-only' ? ' class="only-light"' : fragment === 'gh-dark-mode-only' ? ' class="only-dark"' : '';
	const src = o.resolveImage(href);
	if (src === null) {
		const name = href.split('/').pop() ?? href;
		return `[画像が見つからない: ${escapeHtml(name)}]`;
	}
	return `<img src="${escapeHtml(src)}" alt="${escapeHtml(alt)}"${theme}>`;
}

function linkHtml(text: string, href: string, o: MdOptions): string {
	const inner = inlineText(text, o);
	const scheme = /^([A-Za-z][A-Za-z0-9+.-]*):/.exec(href)?.[1]?.toLowerCase();
	if (scheme !== undefined) {
		if (scheme === 'http' || scheme === 'https' || scheme === 'mailto') return `<a href="${escapeHtml(href)}">${inner}</a>`;
		return inner; // javascript: ・ data: ・ file: 等は、リンクにしない
	}
	if (href.startsWith('#')) return `<a href="${escapeHtml(href)}">${inner}</a>`;
	const resolved = o.resolveLink(href);
	return resolved === null ? inner : `<a href="${escapeHtml(resolved)}">${inner}</a>`;
}

/** コードスパンを除いた部分のインライン (画像 ・ リンク ・ 太字 ・ <br>) */
function inlineText(raw: string, o: MdOptions): string {
	const tokens: string[] = [];
	const hold = (html: string): string => {
		tokens.push(html);
		return `\u0001${tokens.length - 1}\u0001`;
	};
	let t = raw.replace(/[\u0000\u0001]/g, '');
	t = t.replace(/<br\s*\/?>/gi, () => hold('<br>'));
	t = t.replace(/!\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g, (_m, alt: string, href: string) => hold(imageHtml(alt, href, o)));
	t = t.replace(/\[([^\]]+)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g, (_m, text: string, href: string) => hold(linkHtml(text, href, o)));
	t = escapeHtml(t).replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
	return t.replace(/\u0001(\d+)\u0001/g, (_m, n: string) => tokens[Number(n)]);
}

function inline(raw: string, o: MdOptions): string {
	return raw.split(/(`[^`]+`)/g).map((part, i) => (i % 2 === 1 ? `<code>${escapeHtml(part.slice(1, -1))}</code>` : inlineText(part, o))).join('');
}

// ---- ブロック ----

const Fence = /^```\s*([^\s`]*)\s*$/;
const Heading = /^(#{1,6})\s+(.*?)\s*#*\s*$/;
const Rule = /^(\*{3,}|-{3,}|_{3,})\s*$/;
const ListItem = /^(\s*)([-*+]|\d+\.)\s+(.*)$/;
const TableSeparator = /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?\s*$/;
const TodoText = /^\[(未|着手|済)\]\s+(.*)$/;

function indentOf(spaces: string): number {
	return spaces.split('\t').join('    ').length;
}

function isBlockStart(line: string, next: string | undefined): boolean {
	return Fence.test(line) || Heading.test(line) || Rule.test(line) || line.startsWith('>') || ListItem.test(line) || (line.includes('|') && next !== undefined && TableSeparator.test(next));
}

function splitCells(line: string): string[] {
	let s = line.trim();
	if (s.startsWith('|')) s = s.slice(1);
	if (s.endsWith('|')) s = s.slice(0, -1);
	return s.split('\\|').join('\u0002').split('|').map((c) => c.trim().split('\u0002').join('|'));
}

function tableHtml(header: string[], align: string[], rows: string[][], o: MdOptions): string {
	const cell = (tag: string, text: string, i: number): string => {
		const cls = align[i] === 'right' ? ' class="num"' : '';
		return `<${tag}${cls}>${inline(text, o)}</${tag}>`;
	};
	const head = `<thead><tr>${header.map((h, i) => cell('th', h, i)).join('')}</tr></thead>`;
	const body = `<tbody>${rows.map((r) => `<tr>${header.map((_h, i) => cell('td', r[i] ?? '', i)).join('')}</tr>`).join('')}</tbody>`;
	return `<div class="tablewrap"><table>${head}${body}</table></div>`;
}

type Item = { indent: number; ordered: boolean; text: string };

function listHtml(items: Item[], o: MdOptions): string {
	const stack: { indent: number; tag: string }[] = [];
	let out = '';
	for (const item of items) {
		while (stack.length > 0 && item.indent < stack[stack.length - 1].indent) {
			out += `</li></${(stack.pop() as { tag: string }).tag}>`;
		}
		const top = stack[stack.length - 1];
		if (top === undefined || item.indent > top.indent) {
			const tag = item.ordered ? 'ol' : 'ul';
			out += `<${tag}>`;
			stack.push({ indent: item.indent, tag });
		} else {
			out += '</li>';
		}
		const todo = TodoText.exec(item.text);
		if (todo !== null) out += `<li class="todo"><span class="badge ${BadgeOfState[todo[1]]}">${todo[1]}</span> ${inline(todo[2], o)}`;
		else out += `<li>${inline(item.text, o)}`;
	}
	while (stack.length > 0) out += `</li></${(stack.pop() as { tag: string }).tag}>`;
	return out;
}

export function markdownToHtml(md: string, o: MdOptions): string {
	const lines = md.replace(/\r\n?/g, '\n').split('\n');
	const out: string[] = [];
	let i = 0;
	while (i < lines.length) {
		const line = lines[i];
		if (line.trim() === '') { i++; continue; }

		const fence = Fence.exec(line);
		if (fence !== null) {
			const code: string[] = [];
			i++;
			while (i < lines.length && !/^```\s*$/.test(lines[i])) code.push(lines[i++]);
			i++; // 閉じの ```
			const lang = fence[1] !== '' ? ` class="language-${escapeHtml(fence[1])}"` : '';
			out.push(`<pre><code${lang}>${escapeHtml(code.join('\n'))}</code></pre>`);
			continue;
		}

		const heading = Heading.exec(line);
		if (heading !== null) {
			const level = Math.min(heading[1].length + 1, 6);
			out.push(`<h${level}>${inline(heading[2], o)}</h${level}>`);
			i++;
			continue;
		}

		if (Rule.test(line)) { out.push('<hr>'); i++; continue; }

		if (line.startsWith('>')) {
			const quoted: string[] = [];
			while (i < lines.length && lines[i].startsWith('>')) quoted.push(lines[i++].replace(/^>\s?/, ''));
			const alert = /^\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]\s*$/i.exec(quoted[0]);
			if (alert !== null) out.push(`<div class="${CalloutClass[alert[1].toUpperCase()]}">${markdownToHtml(quoted.slice(1).join('\n'), o)}</div>`);
			else out.push(`<blockquote>${markdownToHtml(quoted.join('\n'), o)}</blockquote>`);
			continue;
		}

		if (line.includes('|') && i + 1 < lines.length && TableSeparator.test(lines[i + 1])) {
			const header = splitCells(line);
			const align = splitCells(lines[i + 1]).map((c) => (c.endsWith(':') ? (c.startsWith(':') ? 'center' : 'right') : ''));
			i += 2;
			const rows: string[][] = [];
			while (i < lines.length && lines[i].trim() !== '' && lines[i].includes('|')) rows.push(splitCells(lines[i++]));
			out.push(tableHtml(header, align, rows, o));
			continue;
		}

		if (ListItem.test(line)) {
			const items: Item[] = [];
			while (i < lines.length) {
				const m = ListItem.exec(lines[i]);
				if (m !== null) {
					items.push({ indent: indentOf(m[1]), ordered: /^\d/.test(m[2]), text: m[3] });
					i++;
				} else if (lines[i].trim() === '') {
					// 空行のあとも、字下げされた行か、箇条書きなら、同じ一覧が続く
					const next = lines.slice(i + 1).find((l) => l.trim() !== '');
					if (next !== undefined && (ListItem.test(next) || /^\s/.test(next))) i++;
					else break;
				} else if (/^\s/.test(lines[i]) && items.length > 0) {
					items[items.length - 1].text += ' ' + lines[i].trim();
					i++;
				} else {
					break;
				}
			}
			out.push(listHtml(items, o));
			continue;
		}

		const para: string[] = [line];
		i++;
		while (i < lines.length && lines[i].trim() !== '' && !isBlockStart(lines[i], lines[i + 1])) para.push(lines[i++]);
		out.push(`<p>${inline(para.join('\n'), o)}</p>`);
	}
	return out.join('\n');
}
