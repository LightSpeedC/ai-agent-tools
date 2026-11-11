/*
	issue render: 課題の Markdown から、人が見る HTML を作る (開かない)。
	仕様は notes/50_spec/課題ファイルの形と検査.html (HTML の表示)、決めた経緯は計画 p261103-01
	(131-A 生成して commit しない ・ 134-A render と view を分ける ・ 135-A --standalone ・ 130-A 課題行の並び ・ 129-A 明暗の画像)。

	生成する HTML は、Git 管理外の _issues.html (既定) か、--out で指した場所に置く。
	--standalone は、渡す用の自己完結した HTML (画像を data: URI で埋め込み、ローカルへのリンクを外す)。
*/
import fs from 'node:fs';
import path from 'node:path';
import { DecisionIdPattern, Folders, ItemsRel, NamePattern, listMdNames, type Folder } from './check.ts';
import { loadDecisions, type DecisionView } from './decide.ts';
import { splitIssue } from './meta.ts';
import { Failure, StateOf, compareId, loadFile, todayJst } from './ops.ts';
import { BadgeOfState, escapeHtml, markdownToHtml } from './markdown.ts';

export type RenderOptions = {
	root: string;
	/** 出力するファイル (絶対パス) */
	outFile: string;
	standalone: boolean;
	/** 読むフォルダ (ids があれば、4 つすべてから探す) */
	folders: Folder[];
	group: string | null;
	ids: string[];
	warn: (message: string) => void;
	/** 互いにリンクする相手の HTML (_issues.html と _issues-archive.html。159-A)。ファイルが在るときだけリンクする */
	peer?: { file: string; label: string; always?: boolean };
};

export type RenderResult = { html: string; count: number };

const ImageTypes: Record<string, string> = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.svg': 'image/svg+xml', '.webp': 'image/webp' };

type Row = {
	id: string;
	folder: Folder;
	state: string;
	group: string;
	title: string;
	created: string;
	from: string | undefined;
	confirmed: string | undefined;
	refs: string[];
	/** プロジェクトの root からの相対パス */
	rel: string;
	/** Markdown のファイルがあるフォルダ (絶対パス) */
	dir: string;
	body: string;
};

function pad2(n: number): string {
	return String(n).padStart(2, '0');
}

/** 作った日時 (JST) の yyyy/mm/dd hh:mm:ss。試験だけが、環境変数 ISSUE_TEST_NOW で固定する */
function nowJst(): string {
	const fixed = process.env.ISSUE_TEST_NOW;
	if (fixed !== undefined && /^\d{4}\/\d{2}\/\d{2} \d{2}:\d{2}:\d{2}$/.test(fixed)) return fixed;
	const parts = new Intl.DateTimeFormat('ja-JP', {
		timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
	}).formatToParts(new Date());
	const v = (t: string): string => parts.find((p) => p.type === t)?.value ?? '';
	return `${v('year')}/${v('month')}/${v('day')} ${v('hour')}:${v('minute')}:${v('second')}`;
}

function toPosix(p: string): string {
	return p.split(path.sep).join('/');
}

/** items/ の 4 つのフォルダにある課題の番号 (ページに出すかどうかによらない。195-A) */
function allIssueIds(root: string): Set<string> {
	const ids = new Set<string>();
	for (const folder of Folders) {
		for (const name of listMdNames(path.join(root, ...ItemsRel.split('/'), folder))) {
			const m = NamePattern.exec(name);
			if (m !== null) ids.add(m[1]);
		}
	}
	return ids;
}

function loadRows(o: RenderOptions): Row[] {
	const rows: Row[] = [];
	const folders = o.ids.length > 0 ? [...Folders] : o.folders;
	for (const folder of folders) {
		const dir = path.join(o.root, ...ItemsRel.split('/'), folder);
		for (const name of listMdNames(dir)) {
			const nameMatch = NamePattern.exec(name);
			if (nameMatch === null) continue;
			const id = nameMatch[1];
			if (o.ids.length > 0 && !o.ids.includes(id)) continue;
			let loaded: ReturnType<typeof loadFile>;
			try {
				loaded = loadFile(o.root, folder, name);
			} catch {
				o.warn(`[警告] ${ItemsRel}/${folder}/${name}: 読めない`);
				continue;
			}
			const parts = splitIssue(loaded.text);
			if (parts.broken) {
				o.warn(`[警告] ${loaded.rel}: メタ情報を読めない (issue check で確かめる)`);
				continue;
			}
			const get = (k: string): string | undefined => parts.parsed.pairs.find((p) => p.key === k)?.value;
			const group = get('group') ?? '';
			if (o.group !== null && group !== o.group) continue;
			rows.push({
				id, folder, state: StateOf[folder], group, title: get('title') ?? '', created: get('created') ?? '',
				from: get('from'), confirmed: get('confirmed'),
				refs: (get('refs') ?? '').split(',').map((s) => s.trim()).filter((s) => s !== ''),
				rel: loaded.rel, dir, body: parts.body,
			});
		}
	}
	const sorted = rows.sort((a, b) => compareId(a.id, b.id));
	for (const id of o.ids) {
		if (!sorted.some((r) => r.id === id)) throw new Failure(`${id} の課題が見つからない`);
	}
	return sorted;
}

function groupOrder(o: RenderOptions, rows: Row[]): string[] {
	const present: string[] = [];
	for (const r of rows) if (!present.includes(r.group)) present.push(r.group);
	let listed: string[] = [];
	try {
		listed = fs.readFileSync(path.join(o.root, ...ItemsRel.split('/'), 'groups.txt'), 'utf8').split('\n').map((s) => s.trim()).filter((s) => s !== '');
	} catch {
		// groups.txt は任意
	}
	return [...listed.filter((g) => present.includes(g)), ...present.filter((g) => !listed.includes(g))];
}

function countsText(rows: Row[]): string {
	const n = (f: Folder): number => rows.filter((r) => r.folder === f).length;
	const archived = n('archived');
	return `課題 ${rows.length} 件 (未 ${n('todo')} 件 ・ 着手 ${n('doing')} 件 ・ 済 ${n('done')} 件${archived > 0 ? ` ・ archived ${archived} 件` : ''})`;
}

function chapterCss(n: number): string {
	const lines: string[] = [];
	for (let i = 0; i < n; i++) {
		const hue = n === 1 ? 280 : Math.round((280 - (i * 280) / (n - 1)) * 10) / 10;
		lines.push(`.ch${pad2(i + 1)}{ --accent:hsl(${hue},78%,25%); --accent2:hsl(${hue},58%,55%); --soft:hsl(${hue},28%,95%); }`);
	}
	// 暗い表示では、章の地 (--soft) だけを暗くする (164-A)
	const dark: string[] = [];
	for (let i = 0; i < n; i++) {
		const hue = n === 1 ? 280 : Math.round((280 - (i * 280) / (n - 1)) * 10) / 10;
		dark.push(`\t.ch${pad2(i + 1)}{ --soft:hsl(${hue},28%,14%); }`);
	}
	if (n > 0) lines.push(`@media (prefers-color-scheme: dark) {\n\t${dark.join('\n\t')}\n\t}`);
	return lines.join('\n\t');
}

const Css = `
	:root{
		--navy1:#12224d; --navy2:#2f5fbf;
		--ink:#1c2330; --ink-soft:#4a5568; --line:#d9dfe8; --code-bg:#f4f6fa;
		--link:#1a4fa0;
		--accent:#12224d; --accent2:#2f5fbf; --soft:#f2f5fb;
	}
	*{ box-sizing:border-box; }
	body{
		margin:0; background:#fff; color:var(--ink,#1c2330);
		font-family:"Segoe UI","Yu Gothic UI",Meiryo,sans-serif;
		font-size:15.5px; line-height:1.85;
	}
	.titlebar{
		background:#12224d;
		background:linear-gradient(135deg,var(--navy1,#12224d),var(--navy2,#2f5fbf));
		color:#fff; padding:34px 30px 30px;
	}
	.titlebar .inner{ max-width:1600px; margin:0 auto; }
	.titlebar h1{ font-size:1.95em; margin:0 0 8px; }
	.titlebar .lead{ margin:0 0 10px; font-size:.98em; color:#dce6fb; background:transparent; }
	.titlebar .date{ margin:0; font-size:.88em; color:#c6d5f5; background:transparent; }
	.wrap{ max-width:1600px; margin:0 auto; padding:0 30px; }
	.wrap a{ color:var(--link,#1a4fa0); background:transparent; }
	.backlink{ margin:18px 0 0; font-size:.94em; }
	section{
		background:#f2f5fb;
		background:linear-gradient(180deg,var(--soft,#f2f5fb),#fff);
		color:var(--ink,#1c2330);
		border:1px solid var(--line,#d9dfe8); border-radius:10px;
		padding:4px 26px 26px; margin:34px 0;
	}
	section h1{
		background:#12224d;
		background:linear-gradient(100deg,var(--accent,#12224d),var(--accent2,#2f5fbf));
		color:#fff; padding:14px 20px; margin:26px 0 20px;
		border-radius:8px; font-size:1.35em;
		box-shadow:0 3px 10px rgba(0,0,0,.18);
	}
	h2{
		border-left:6px solid var(--accent,#12224d);
		background:#f2f5fb;
		background:linear-gradient(90deg,var(--soft,#f2f5fb),#fff);
		color:var(--accent,#12224d);
		padding:6px 12px; margin:30px 0 12px; font-size:1.16em;
	}
	h3{
		border-bottom:2px dotted var(--accent2,#2f5fbf);
		display:inline-block; margin:20px 0 8px; padding-bottom:3px;
		color:var(--ink,#1c2330); background:transparent;
	}
	h4{ margin:16px 0 6px; color:var(--ink,#1c2330); background:transparent; }
	p{ margin:12px 0; }
	ul,ol{ margin:12px 0; padding-left:1.6em; }
	li{ margin:5px 0; }
	li.todo{ list-style:none; margin-left:-1.2em; }
	details{
		background:#fff; color:var(--ink,#1c2330);
		border:1px solid var(--line,#d9dfe8); border-radius:8px;
		margin:12px 0; padding:0 16px 8px;
		box-shadow:0 2px 6px rgba(0,0,0,.06);
	}
	summary{
		cursor:pointer; padding:10px 0; font-weight:600;
		background:transparent; color:var(--ink,#1c2330);
	}
	.no{
		display:inline-block; margin-right:10px; padding:0 8px; border-radius:6px;
		background:#f4f6fa; color:#17335f; border:1px solid var(--line,#d9dfe8);
		font-family:Consolas,"Courier New",monospace; font-size:.88em; font-weight:400;
	}
	.meta{ margin:4px 0 10px; color:var(--ink-soft,#4a5568); background:transparent; font-size:.9em; }
	.badge{
		display:inline-block; padding:0 9px; border-radius:6px; margin-right:8px;
		background:#5a6472; color:#fff; font-size:.85em; font-weight:700; white-space:nowrap;
	}
	.b-ok{ background:#1d7a3c; background:linear-gradient(100deg,#1d7a3c,#45b56c); color:#fff; }
	.b-warn{ background:#b8620a; background:linear-gradient(100deg,#b8620a,#f0a548); color:#fff; }
	.b-ng{ background:#a51f22; background:linear-gradient(100deg,#a51f22,#e05a5c); color:#fff; }
	.b-none{ background:#5a6472; background:linear-gradient(100deg,#5a6472,#97a1ae); color:#fff; }
	code{
		background:#f4f6fa;
		background:var(--code-bg,#f4f6fa); color:#17335f;
		border:1px solid var(--line,#d9dfe8);
		padding:1px 5px; border-radius:4px; font-size:.93em;
		font-family:Consolas,"Courier New",monospace;
	}
	pre{
		background:#f4f6fa;
		background:var(--code-bg,#f4f6fa); color:#17335f;
		border:1px solid var(--line,#d9dfe8); border-left:5px solid var(--accent2,#2f5fbf);
		border-radius:6px; padding:13px 16px; overflow-x:auto; margin:14px 0;
	}
	pre code{ border:none; padding:0; background:transparent; }
	img{ max-width:100%; height:auto; }
	blockquote{
		margin:14px 0; padding:4px 16px; border-left:4px solid var(--line,#d9dfe8);
		background:#fafbfe; color:var(--ink-soft,#4a5568);
	}
	.tablewrap{ overflow-x:auto; margin:14px 0; }
	table{
		border-collapse:collapse; width:100%; font-size:.94em;
		border-radius:8px; overflow:hidden; box-shadow:0 2px 6px rgba(0,0,0,.08);
	}
	th{
		background:#12224d;
		background:linear-gradient(100deg,var(--accent,#12224d),var(--accent2,#2f5fbf));
		color:#fff; text-align:left; padding:9px 12px; white-space:nowrap;
	}
	td{ padding:9px 12px; border-bottom:1px solid var(--line,#d9dfe8); vertical-align:top; }
	td.num{ text-align:right; white-space:nowrap; }
	th.num{ text-align:right; }
	tr:nth-child(even) td{ background:#fafbfe; color:var(--ink,#1c2330); }
	.callout{
		border-left:6px solid var(--accent,#12224d);
		background:#f2f5fb;
		background:linear-gradient(180deg,var(--soft,#f2f5fb),#fff);
		color:var(--ink,#1c2330);
		border-radius:0 8px 8px 0; padding:4px 16px; margin:16px 0;
	}
	.callout-tip{ border-left-color:#1d7a3c; }
	.callout-important{ border-left-color:#2f5fbf; }
	.callout-warning{ border-left-color:#b8620a; }
	.callout-caution{ border-left-color:#a51f22; }
	.toc{ margin:26px 0 6px; }
	.toc ol{ list-style:none; display:flex; flex-wrap:wrap; gap:8px; padding:0; margin:0; }
	.toc ol a{
		display:inline-block; max-width:100%;
		background:#12224d;
		background:linear-gradient(100deg,var(--accent,#12224d),var(--accent2,#2f5fbf));
		color:#fff; text-decoration:none; padding:9px 13px;
		border-radius:6px; font-size:.95em; line-height:1.45; font-weight:700;
	}
	footer{
		max-width:1600px; margin:0 auto; padding:18px 30px 24px;
		border-top:1px solid var(--line,#d9dfe8);
		background:#fff; color:var(--ink-soft,#4a5568); font-size:.94em;
	}
	footer a{ color:var(--link,#1a4fa0); background:transparent; }
	.wrap a.home, footer a.home{
		display:inline-block; vertical-align:middle; line-height:1; text-decoration:none;
		background:#12224d;
		background:linear-gradient(100deg,var(--navy1,#12224d),var(--navy2,#2f5fbf));
		color:#fff; padding:3px 9px; border-radius:6px;
	}
	a.home svg{ display:block; }
	.legacy{ margin-left:12px; }
	.only-dark{ display:none; }
	@media (prefers-color-scheme: dark) {
		.only-light{ display:none; }
		.only-dark{ display:inline; }
	}
	/* 暗い表示の環境でだけ、暗い配色にする (162-B ・ 164-A)。タイトルバー ・ h1 ・ バッジ ・ 表の見出しは濃い色のまま */
	@media (prefers-color-scheme: dark) {
		:root{ --ink:#e3e8f0; --ink-soft:#a9b4c4; --line:#2e3746; --code-bg:#1c2230; --link:#8ab4ff; --soft:hsl(220,28%,14%); }
		body, footer, details{ background:#12161f; color:#e3e8f0; }
		section, .callout{ background:#12161f; background:linear-gradient(180deg,var(--soft,#1a2130),#12161f); color:#e3e8f0; }
		h2{ background:#12161f; background:linear-gradient(90deg,var(--soft,#1a2130),#12161f); color:var(--accent2,#2f5fbf); }
		summary, h3, h4{ color:#e3e8f0; }
		code, pre, .no{ background:#1c2230; color:#cfe0ff; }
		blockquote, tr:nth-child(even) td{ background:#171c27; color:#e3e8f0; }
		.wrap a, footer a{ color:#8ab4ff; }
	}`;

/** 決定の CSS (p261108-02)。決定があるときだけ足す (無いプロジェクトの出力を変えないため) */
const DecisionCss = `
	details.decision{ margin:8px 0; padding:0 14px 6px; box-shadow:none; }
	details.decision summary{ font-weight:500; padding:6px 0; }
	.dno{
		display:inline-block; margin-right:10px; padding:0 8px; border-radius:6px;
		background:#f4f6fa; color:#17335f; border:1px solid var(--line,#d9dfe8);
		font-family:Consolas,"Courier New",monospace; font-size:.88em; font-weight:400;
	}
	details.decision.superseded{ background:#f1f3f6; color:#5a6472; }
	details.decision.superseded summary{ color:#5a6472; background:transparent; }
	@media (prefers-color-scheme: dark) {
		.dno{ background:#1c2230; color:#cfe0ff; }
		details.decision.superseded, details.decision.superseded summary{ background:#1a1e26; color:#97a1ae; }
	}`;

const HomeIcon ='<svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><path fill="currentColor" d="M8 1 1 7h2v7h4v-4h2v4h4V7h2z"/></svg>';

/** 日時の部分 (span.gen) を除いた文字列。「中身が同じか」を比べるのに使う */
function withoutGenerated(html: string): string {
	return html.replace(/<span class="gen">[^<]*<\/span>/g, '<span class="gen"></span>');
}

export function renderHtml(o: RenderOptions): RenderResult {
	const rows = loadRows(o);
	const outDir = path.dirname(o.outFile);
	const underRoot = (abs: string): boolean => {
		const rel = path.relative(o.root, abs);
		return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel);
	};
	const relFromOut = (abs: string): string | null => {
		const rel = path.relative(outDir, abs);
		return path.isAbsolute(rel) ? null : toPosix(rel);
	};
	const decode = (s: string): string => {
		try { return decodeURIComponent(s); } catch { return s; }
	};

	const ids = new Set(rows.map((r) => r.id));
	const groups = groupOrder(o, rows);
	const body = (row: Row): string => markdownToHtml(row.body, {
		warn: o.warn,
		resolveImage: (href) => {
			const abs = path.resolve(row.dir, decode(href));
			const type = ImageTypes[path.extname(abs).toLowerCase()];
			if (type === undefined || !underRoot(abs) || !fs.existsSync(abs)) {
				o.warn(`[警告] ${row.rel}: 画像が見つからない: ${href}`);
				return null;
			}
			if (o.standalone) return `data:${type};base64,${fs.readFileSync(abs).toString('base64')}`;
			const rel = relFromOut(abs);
			if (rel === null) o.warn(`[警告] ${row.rel}: 画像の相対パスを作れない: ${href}`);
			return rel;
		},
		resolveLink: (href) => {
			if (o.standalone) return null;
			const hash = href.indexOf('#');
			const target = path.resolve(row.dir, decode(hash >= 0 ? href.slice(0, hash) : href));
			if (!underRoot(target) || !fs.existsSync(target)) return null;
			const rel = relFromOut(target);
			return rel === null ? null : rel + (hash >= 0 ? href.slice(hash) : '');
		},
	});

	// 決定 (p261108-02)。親の番号ごとに束ね、覆した ・ 覆された の対応を引けるようにする
	const decisions = loadDecisions(o.root, o.warn);
	const parentOf = (d: DecisionView): string => DecisionIdPattern.exec(d.id)?.[1] ?? '';
	const decisionsOf = new Map<string, DecisionView[]>();
	for (const d of decisions) {
		const list = decisionsOf.get(parentOf(d)) ?? [];
		list.push(d);
		decisionsOf.set(parentOf(d), list);
	}
	const splitIds = (s: string | undefined): string[] => (s ?? '').split(',').map((x) => x.trim()).filter((x) => x !== '');
	const replacedBy = new Map<string, string[]>();
	for (const d of decisions) {
		for (const old of splitIds(d.meta.replaces)) replacedBy.set(old, [...(replacedBy.get(old) ?? []), d.id]);
	}
	const idLink = (id: string): string => `<a href="#${escapeHtml(id)}">${escapeHtml(id)}</a>`;
	const decisionHtml = (d: DecisionView): string => {
		const chosen = d.meta.chosen ?? '';
		// 複数の案を選んだ決定は、選んだ字ごとに案の文を並べる (217-A)
		const picked = chosen.split(',').filter((c) => c !== '');
		const chosenText = picked.map((c) => { const x = d.options.find((y) => y.key === c); return escapeHtml(c) + (x !== undefined ? ': ' + escapeHtml(x.text) : ''); }).join(' ・ ');
		const newer = replacedBy.get(d.id) ?? [];
		const older = splitIds(d.meta.replaces);
		const notes: string[] = [];
		if (newer.length > 0) notes.push(`→ ${newer.map(idLink).join(', ')} で覆した`);
		if (older.length > 0) notes.push(`← ${older.map(idLink).join(', ')} を覆した`);
		// 249-A: 決めた以外の決定は、状態を印にして出す (選んだ字は、推す案 ・ 仮に選んだ案)
		const status = d.meta.status ?? '決めた';
		const mark = status === '決めた' ? '' : ` <span class="badge ${status === '答え待ち' ? 'b-warn' : 'b-none'}">${escapeHtml(status)}</span>`;
		const summary = `<span class="dno">${escapeHtml(d.id)}</span>${escapeHtml(d.meta.title ?? '')} → ${chosenText}${mark}`
			+ (notes.length > 0 ? ` (${notes.join(' ・ ')})` : '');
		const meta: string[] = [`決めた日 ${escapeHtml(d.meta.decided ?? '')}`];
		const refs = splitIds(d.meta.refs);
		if (refs.length > 0) meta.push('参照 ' + refs.map((r) => (ids.has(r) ? idLink(r) : escapeHtml(r))).join(', '));
		if (!o.standalone) {
			const rel = relFromOut(path.join(o.root, ...d.file.split('/')));
			if (rel !== null) meta.push(`<a href="${escapeHtml(rel)}">ファイル</a>`);
		}
		const bodyHtml = markdownToHtml(d.body, { warn: o.warn, resolveImage: () => null, resolveLink: () => null });
		return `<details class="decision${newer.length > 0 ? ' superseded' : ''}" id="${escapeHtml(d.id)}"><summary>${summary}</summary>\n`
			+ `<p class="meta">${meta.join(' ・ ')}</p>\n${bodyHtml}\n</details>`;
	};

	const detailsHtml = (row: Row): string => {
		const open = row.folder === 'todo' || row.folder === 'doing' ? ' open' : '';
		const stateText = row.folder === 'archived' ? '済 ・ archived' : row.state;
		const meta: string[] = [`作成 ${escapeHtml(row.created)}`];
		if (row.from !== undefined) meta.push(`報告元 ${escapeHtml(row.from)} (${row.confirmed === 'true' ? '確認済み' : '確認待ち'})`);
		if (row.refs.length > 0) meta.push('参照 ' + row.refs.map((r) => (ids.has(r) ? `<a href="#${escapeHtml(r)}">${escapeHtml(r)}</a>` : escapeHtml(r))).join(', '));
		if (!o.standalone) {
			const rel = relFromOut(path.join(o.root, ...row.rel.split('/')));
			if (rel !== null) meta.push(`<a href="${escapeHtml(rel)}">ファイル</a>`);
		}
		const mineDecisions = decisionsOf.get(row.id) ?? [];
		const decisionPart = mineDecisions.length > 0 ? `\n<h4>決定</h4>\n${mineDecisions.map(decisionHtml).join('\n')}` : '';
		return `<details id="${row.id}"${open}><summary><span class="no">${row.id}</span><span class="badge ${BadgeOfState[row.state]}">${stateText}</span>${escapeHtml(row.title)}</summary>\n`
			+ `<p class="meta">${meta.join(' ・ ')}</p>\n${body(row)}${decisionPart}\n</details>`;
	};

	// 親が課題でない決定 (計画 ・ 調査) と、親の課題が items/ に無い決定は、絞らずに出すときだけ、最後の章にまとめる (185-A ・ 195-A)
	const filtered = o.ids.length > 0 || o.group !== null;
	const issueIds = allIssueIds(o.root);
	// archived だけのページ (_issues-archive.html ・ --state archived) には出さない (197-A。_issues.html と重ならないため)
	const archivedOnly = o.folders.every((f) => f === 'archived');
	const planDecisions = filtered || archivedOnly ? [] : decisions.filter((d) => !issueIds.has(parentOf(d)));
	const chapterNames = planDecisions.length > 0 ? [...groups, '課題の外の決定'] : groups;
	const shownDecisions = rows.reduce((n, r) => n + (decisionsOf.get(r.id)?.length ?? 0), 0) + planDecisions.length;

	const counts = countsText(rows) + (shownDecisions > 0 ? ` ・ 決定 ${shownDecisions} 件` : '');
	const now = nowJst();
	const today = todayJst();
	const project = escapeHtml(path.basename(o.root));
	const links: string[] = [];
	if (!o.standalone) {
		const readme = relFromOut(path.join(o.root, 'README.html'));
		if (readme !== null) links.push(`<a class="home" href="${escapeHtml(readme)}" aria-label="戻る" title="README へ戻る">${HomeIcon}</a>`);
		const legacy = path.join(o.root, 'notes', '40_issues', 'issues-legacy.html');
		const legacyRel = fs.existsSync(legacy) ? relFromOut(legacy) : null;
		const peerRel = o.peer !== undefined && (o.peer.always === true || fs.existsSync(o.peer.file)) ? relFromOut(o.peer.file) : null;
		if (peerRel !== null && o.peer !== undefined) links.push(`<a class="legacy" href="${escapeHtml(peerRel)}">${escapeHtml(o.peer.label)}</a>`);
		if (legacyRel !== null) links.push(`<a class="legacy" href="${escapeHtml(legacyRel)}">過去の課題 (旧 HTML)</a>`);
	}

	const toc = chapterNames.map((g, i) => `<li class="ch${pad2(i + 1)}"><a href="#ch${pad2(i + 1)}">${escapeHtml(g)}</a></li>`).join('\n\t\t');
	const sections = groups.map((g, i) => {
		const mine = rows.filter((r) => r.group === g);
		const n = pad2(i + 1);
		return `<section class="ch${n}" id="ch${n}">\n\t<h1>${escapeHtml(g)} (${mine.length} 件)</h1>\n${mine.map(detailsHtml).join('\n')}\n</section>`;
	});
	if (planDecisions.length > 0) {
		const n = pad2(chapterNames.length);
		const parents = [...new Set(planDecisions.map(parentOf))];
		const parts = parents.map((p) => `\t<h2>${escapeHtml(p)}</h2>\n${planDecisions.filter((d) => parentOf(d) === p).map(decisionHtml).join('\n')}`);
		sections.push(`<section class="ch${n}" id="ch${n}">\n\t<h1>課題の外の決定 (${planDecisions.length} 件)</h1>\n${parts.join('\n')}\n</section>`);
	}

	const html = `<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="format-detection" content="telephone=no">
<meta name="md-skip">
<title>課題 (${project})</title>
<style>${Css}
	${chapterCss(chapterNames.length)}${decisions.length > 0 ? DecisionCss : ''}
</style>
</head>
<body>

<div class="titlebar">
	<div class="inner">
		<h1>課題 (${project})</h1>
		<p class="lead">${counts}</p>
		<p class="date">📅 作成: <span class="gen">${today}</span> / 更新: <span class="gen">${today}</span></p>
	</div>
</div>

<div class="wrap">
${links.length > 0 ? `<p class="backlink">${links.join('')}</p>\n` : ''}
<div class="toc">
	<h2>目次</h2>
	<ol>
		${toc}
	</ol>
</div>

${sections.join('\n\n')}

</div>

<footer>
	${o.standalone ? '' : `<p>${links[0] ?? ''}</p>\n\t`}<p>作った日時: <span class="gen">${now}</span> (JST) ・ ${counts}</p>
</footer>

</body>
</html>
`;
	return { html, count: rows.length };
}

/** 中身が同じ (日時の部分を除く) なら書かない。BOM 付き UTF-8 ・ LF で書く */
export function writeIfChanged(file: string, html: string): 'created' | 'updated' | 'unchanged' {
	let existing: string | null = null;
	try {
		existing = fs.readFileSync(file, 'utf8').replace(/^﻿/, '');
	} catch {
		// 無ければ作る
	}
	if (existing !== null && withoutGenerated(existing) === withoutGenerated(html)) return 'unchanged';
	fs.mkdirSync(path.dirname(file), { recursive: true });
	fs.writeFileSync(file, '﻿' + html);
	return existing === null ? 'created' : 'updated';
}
