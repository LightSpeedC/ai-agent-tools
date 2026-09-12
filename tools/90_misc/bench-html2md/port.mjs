

// html2md の変換の中核を JavaScript に移した見積もり用の実装。
//
// 本丸（実際の HTML → Markdown 変換）で処理系を比べるために置いている。
// 実装の本体ではなく、exe・ps1 と置き換えられるものでもない。
//
// 移したのは変換だけで、次は入っていない。
//   ・変換後の検査（リンク切れ・アンカー・HTML に無い文言・更新日）
//   ・SVG の切り出しと CSS 変数の解決
//   ・chapters の表化、他ファイルへのアンカー張り替え
// exe と ps1 はこれらも走らせるため、出てくる数字は同じ範囲ではない。
// 詳しくは同じフォルダの 結果.html に書いた。

import fs from 'node:fs';
import path from 'node:path';

// ---- 小物 ----------------------------------------------------------------

function decodeEntities(s) {
	return s
		.replace(/&lt;/g, '<').replace(/&gt;/g, '>')
		.replace(/&quot;/g, '"').replace(/&#39;/g, "'")
		.replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&');
}

function getAttr(tag, name) {
	const m = new RegExp(name + '\\s*=\\s*"([^"]*)"', 'i').exec(tag);
	return m ? m[1] : '';
}

function classList(tag) {
	const c = getAttr(tag, 'class');
	return c ? c.split(/\s+/).filter(Boolean) : [];
}

function openTag(block) {
	const i = block.indexOf('>');
	return i < 0 ? block : block.slice(0, i + 1);
}

// 入れ子を数えて対応する閉じタグまでを切り出す
function getBlock(html, start, tag) {
	const open = new RegExp('<' + tag + '\\b', 'gi');
	const close = new RegExp('</' + tag + '\\s*>', 'gi');
	let depth = 0;
	let i = start;
	while (i < html.length) {
		open.lastIndex = i;
		close.lastIndex = i;
		const o = open.exec(html);
		const c = close.exec(html);
		if (!c) break;
		if (o && o.index < c.index) { depth++; i = o.index + 1; continue; }
		depth--;
		if (depth === 0) {
			const outer = html.slice(start, c.index + c[0].length);
			const innerStart = start + outer.indexOf('>') + 1;
			return { outer: outer, inner: html.slice(innerStart, c.index) };
		}
		i = c.index + 1;
	}
	return { outer: html.slice(start), inner: html.slice(start) };
}

function anchorOf(text) {
	return text.toLowerCase()
		.replace(/[^\p{L}\p{N} -]/gu, '')
		.trim().replace(/\s+/g, '-');
}

// ---- インライン ----------------------------------------------------------

const BADGES = { 'b-ok': '✅', 'b-ng': '❌', 'b-warn': '⚠', 'b-none': '⬜' };

function isPunct(ch) {
	return ch !== undefined && /[!-\/:-@\[-`{-~。、「」（）［］]/u.test(ch);
}

// ** で囲めるか（前後の文字で判定する）。囲めなければタグで出す
function canEmphasize(text, start, len) {
	if (len <= 0) return false;
	const before = start > 0 ? text[start - 1] : ' ';
	const after = start + len < text.length ? text[start + len] : ' ';
	const first = text[start];
	const last = text[start + len - 1];
	if (/\s/.test(first) || /\s/.test(last)) return false;
	if (isPunct(first) && !(/\s/.test(before) || isPunct(before))) return false;
	if (isPunct(last) && !(/\s/.test(after) || isPunct(after))) return false;
	return true;
}

function stripTagsRaw(html) {
	return html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

function convertInline(html, inTable) {
	if (!html) return '';
	let s = html;
	const codes = [];

	s = s.replace(/<code\b[^>]*>([\s\S]*?)<\/code>/g, function (_, inner) {
		let code = decodeEntities(inner.replace(/<[^>]+>/g, ''));
		if (inTable) code = code.replace(/\|/g, '\\|');
		codes.push('`' + code + '`');
		return '' + (codes.length - 1) + '';
	});

	s = s.replace(/<span\b([^>]*)>([\s\S]*?)<\/span>/g, function (_, attrs, inner) {
		const cls = classList('<span' + attrs + '>');
		if (cls.indexOf('md-skip') >= 0) return '';
		if (cls.indexOf('no') >= 0) return inner + ' ';
		if (cls.indexOf('badge') < 0) return inner;
		const text = stripTagsRaw(inner);
		if (!text) return '';
		let mark = '';
		for (const c of cls) { if (BADGES[c]) mark = BADGES[c]; }
		const body = '' + text + '';
		return (mark ? mark + ' ' : '') + body + ' ';
	});

	s = s.replace(/<img\b([^>]*?)\/?>/g, function (_, attrs) {
		const tag = '<img' + attrs + '>';
		const src = getAttr(tag, 'src');
		if (!src) return '';
		return '![' + getAttr(tag, 'alt') + '](' + src + ')';
	});

	s = s.replace(/<a\b([^>]*)>([\s\S]*?)<\/a>/g, function (_, attrs, inner) {
		const tag = '<a' + attrs + '>';
		let href = getAttr(tag, 'href');
		const text = stripTagsRaw(inner);
		if (!href) return text;
		if (!/^(https?:|mailto:|tel:|#)/.test(href)) href = href.replace(/\.html(?=$|[#?])/, '.md');
		return '[' + text + '](' + href + ')';
	});

	s = s.replace(/<(strong|b)\b[^>]*>([\s\S]*?)<\/\1>/g, function (_, __, inner) {
		return stripTagsRaw(inner) ? '' + inner + '' : '';
	});
	s = s.replace(/<(em|i)\b[^>]*>([\s\S]*?)<\/\1>/g, function (_, __, inner) {
		return stripTagsRaw(inner) ? '' + inner + '' : '';
	});
	s = s.replace(/<br\s*\/?>/g, '');
	s = s.replace(/<[^>]+>/g, '');
	s = decodeEntities(s);
	s = s.replace(/\s+/g, ' ');
	s = s.replace(//g, '<br>');
	if (inTable) s = s.replace(/\|/g, '\\|');
	s = s.replace(/(\d+)/g, function (_, i) { return codes[Number(i)]; });
	return s.trim();
}

// センチネルで囲んだ強調を、内側から ** かタグに確定させる
function resolveEmphasis(text) {
	let t = text;
	const pair = /[]([^-]*)[]/;
	for (;;) {
		const m = pair.exec(t);
		if (!m) break;
		const strong = t[m.index] === '';
		const raw = m[1];
		const inner = raw.trim();
		const prefix = t.slice(0, m.index);
		const suffix = t.slice(m.index + m[0].length);
		if (!inner) { t = prefix + suffix; continue; }
		const lead = raw.slice(0, raw.length - raw.trimStart().length);
		const trail = raw.slice(raw.trimEnd().length);
		const mark = strong ? '**' : '*';
		const tag = strong ? 'strong' : 'em';
		let rep;
		if (canEmphasize(prefix + lead + inner + trail + suffix, prefix.length + lead.length, inner.length)) {
			rep = mark + inner + mark;
		} else {
			rep = '<' + tag + '>' + inner + '</' + tag + '>';
		}
		t = prefix + lead + rep + trail + suffix;
	}
	return t;
}

// ---- ブロック ------------------------------------------------------------

const BLOCK_TAGS = /<(section|figure|footer|blockquote|div|nav|table|main|article|aside|header|details|dl|dt|dd|hr|h1|h2|h3|h4|h5|h6|p|ul|ol|pre|a)\b/i;
const CALLOUTS = {
	'callout-tip': 'TIP', 'callout-important': 'IMPORTANT',
	'callout-warning': 'WARNING', 'callout-caution': 'CAUTION',
};

function convertTable(html) {
	const rows = [];
	const trRe = /<tr\b[^>]*>([\s\S]*?)<\/tr>/g;
	let m;
	while ((m = trRe.exec(html)) !== null) {
		const cells = [];
		const cellRe = /<(th|td)\b([^>]*)>([\s\S]*?)<\/\1>/g;
		let c;
		while ((c = cellRe.exec(m[1])) !== null) {
			const cls = classList('<' + c[1] + c[2] + '>');
			cells.push({
				head: c[1].toLowerCase() === 'th',
				num: cls.indexOf('num') >= 0,
				text: cls.indexOf('md-skip') >= 0 ? '' : convertInline(c[3], true),
			});
		}
		if (cells.length) rows.push(cells);
	}
	if (!rows.length) return '';
	const out = [];
	const head = rows[0];
	out.push('| ' + head.map(function (c) { return c.text; }).join(' | ') + ' |');
	out.push('|' + head.map(function (_, i) {
		return rows.some(function (r) { return r[i] && r[i].num; }) ? '---:' : '---';
	}).join('|') + '|');
	for (let i = 1; i < rows.length; i++) {
		out.push('| ' + rows[i].map(function (c) { return c.text; }).join(' | ') + ' |');
	}
	return out.join('\n');
}

function convertList(html, tag, depth) {
	const inner = getBlock(html, 0, tag).inner;
	const indent = ' '.repeat(4 * depth);
	const out = [];
	let n = 0;
	let i = 0;
	for (;;) {
		const m = /<li\b/i.exec(inner.slice(i));
		if (!m) break;
		const start = i + m.index;
		const block = getBlock(inner, start, 'li');
		i = start + block.outer.length;
		if (classList(openTag(block.outer)).indexOf('md-skip') >= 0) continue;
		let liInner = block.inner;
		const nested = [];
		for (;;) {
			const nm = /<(ul|ol)\b/i.exec(liInner);
			if (!nm) break;
			const nb = getBlock(liInner, nm.index, nm[1].toLowerCase());
			nested.push([nm[1].toLowerCase(), nb.outer]);
			liInner = liInner.slice(0, nm.index) + liInner.slice(nm.index + nb.outer.length);
		}
		const text = convertInline(liInner, false).replace(/\s*\r?\n\s*/g, ' ');
		if (!text && !nested.length) continue;
		n++;
		out.push(indent + (tag === 'ol' ? n + '. ' : '- ') + text);
		for (const ns of nested) {
			const sub = convertList(ns[1], ns[0], depth + 1);
			if (sub) out.push(sub);
		}
	}
	return out.join('\n');
}

function headingMark(ctx, level) {
	let l = level + 1;
	if (!ctx.inSection && level >= 2) l--;
	return '#'.repeat(Math.min(l, 6)) + ' ';
}

function convertBlocks(html, ctx) {
	const out = [];
	let i = 0;
	for (;;) {
		const m = BLOCK_TAGS.exec(html.slice(i));
		if (!m) {
			const rest = convertInline(html.slice(i), false);
			if (rest) out.push(rest);
			break;
		}
		const start = i + m.index;
		const lead = convertInline(html.slice(i, start), false);
		if (lead) out.push(lead);
		const tag = m[1].toLowerCase();
		const block = getBlock(html, start, tag);
		i = start + block.outer.length;
		const cls = classList(openTag(block.outer));
		if (cls.indexOf('md-skip') >= 0) continue;

		switch (tag) {
			case 'section': {
				ctx.inSection = true;
				out.push.apply(out, convertBlocks(block.inner, ctx));
				ctx.inSection = false;
				break;
			}
			case 'h1': {
				if (ctx.inSection) {
					ctx.chapter++;
					out.push('## ' + ctx.chapter + '. ' + convertInline(block.inner, false));
				} else {
					out.push('# ' + convertInline(block.inner, false));
				}
				break;
			}
			case 'h2': case 'h3': case 'h4': case 'h5': case 'h6': {
				out.push(headingMark(ctx, Number(tag[1])) + convertInline(block.inner, false));
				break;
			}
			case 'p': {
				const text = convertInline(block.inner, false);
				if (!text) break;
				if (cls.indexOf('date') >= 0 || cls.indexOf('lead') >= 0) out.push('> ' + text);
				else out.push(text);
				break;
			}
			case 'table': out.push(convertTable(block.inner)); break;
			case 'ul': case 'ol': {
				const items = convertList(block.outer, tag, 0);
				if (items) out.push(items);
				break;
			}
			case 'pre': {
				const cm = /<code\b([^>]*)>([\s\S]*?)<\/code>/.exec(block.inner);
				const lang = cm ? (/language-([A-Za-z0-9]+)/.exec(cm[1]) || [, ''])[1] : '';
				const body = decodeEntities((cm ? cm[2] : block.inner).replace(/<[^>]+>/g, ''));
				out.push('```' + (lang || '') + '\n' + body.replace(/\r?\n$/, '') + '\n```');
				break;
			}
			case 'hr': out.push('---'); break;
			case 'details': {
				const sm = /<summary\b[^>]*>([\s\S]*?)<\/summary>/.exec(block.inner);
				const summary = sm ? resolveEmphasis(convertInline(sm[1], false)) : '';
				const rest = sm ? block.inner.replace(sm[0], '') : block.inner;
				const sub = convertBlocks(rest, ctx);
				const d = ['<details>', '<summary>' + summary + '</summary>'];
				for (const b of sub) { d.push(''); d.push(b); }
				d.push(''); d.push('</details>');
				out.push(d.join('\n'));
				break;
			}
			case 'dl': {
				const lines = [];
				const re = /<(dt|dd)\b[^>]*>([\s\S]*?)<\/\1>/g;
				let dm;
				while ((dm = re.exec(block.inner)) !== null) {
					const text = convertInline(dm[2], false).replace(/\s*\r?\n\s*/g, ' ').trim();
					if (text) lines.push((dm[1] === 'dd' ? '    - ' : '- ') + text);
				}
				if (lines.length) out.push(lines.join('\n'));
				break;
			}
			case 'blockquote': {
				const sub = convertBlocks(block.inner, ctx);
				out.push(sub.map(function (b) { return '> ' + b; }).join('\n>\n'));
				break;
			}
			case 'div': {
				let kind = '';
				for (const c of cls) { if (CALLOUTS[c]) kind = CALLOUTS[c]; }
				if (cls.indexOf('callout') >= 0) {
					const sub = convertBlocks(block.inner, ctx);
					out.push('> [!' + (kind || 'NOTE') + ']\n' +
						sub.map(function (b) { return '> ' + b; }).join('\n>\n'));
				} else {
					out.push.apply(out, convertBlocks(block.inner, ctx));
				}
				break;
			}
			default:
				out.push.apply(out, convertBlocks(block.inner, ctx));
				break;
		}
	}
	return out;
}

// ---- ファイル単位 --------------------------------------------------------

function convertFile(htmlPath, write) {
	let html = fs.readFileSync(htmlPath, 'utf8').replace(/^﻿/, '');
	html = html.replace(/<script\b[\s\S]*?<\/script>/gi, '')
		.replace(/<style\b[\s\S]*?<\/style>/gi, '')
		.replace(/<!--[\s\S]*?-->/g, '')
		.replace(/<svg\b[\s\S]*?<\/svg>/gi, '');
	const bm = /<body\b[^>]*>([\s\S]*)<\/body>/i.exec(html);
	const body = bm ? bm[1] : html;

	const ctx = { inSection: false, chapter: 0 };
	let md = convertBlocks(body, ctx).join('\n\n');
	md = resolveEmphasis(md);
	md = md.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n');
	md = md.trimEnd() + '\n';
	md = md.replace(/\r\n?/g, '\n');
	if (write) fs.writeFileSync(htmlPath.replace(/\.html$/i, '.md'), md, 'utf8');
	return md.split('\n').length;
}

function walkHtml(root) {
	const out = [];
	const dirs = [root];
	while (dirs.length) {
		const dir = dirs.pop();
		const base = path.basename(dir);
		if (base === '.git' || base === 'images' || base === 'node_modules') continue;
		for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
			const full = path.join(dir, e.name);
			if (e.isDirectory()) { dirs.push(full); continue; }
			if (/\.html$/i.test(e.name) && e.name !== 'index.html') out.push(full);
		}
	}
	return out;
}

function main() {
	const root = process.argv[2];
	if (!root) { console.error('使い方: port.js <対象フォルダ>'); process.exit(2); }
	const start = process.hrtime.bigint();
	let files = 0;
	let lines = 0;
	for (const f of walkHtml(root)) {
		files++;
		lines += convertFile(f, true);
	}
	const ms = Number((process.hrtime.bigint() - start) / 1000000n);
	console.log('files=' + files + ' lines=' + lines + ' inner_ms=' + ms);
}

main();
