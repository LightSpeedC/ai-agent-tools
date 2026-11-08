/*
	旧 issues.html (1 ファイルに全件) の課題を読み、新しい形 (1 件 1 ファイル) へ移す計画を立てる。
	計画は p261105-01 (各プロジェクトの課題の移行) と p261106-01 (143-A: 済みも移す)。

	既定は読み取りだけ (--dry-run)。--apply で items/ へ書く (165-A ・ 166-A)。
	読めない形は、推測で補わず「読めなかった」に出す。

	旧 HTML の形:
		section > h1 (グループ)
		  details > summary (状態のバッジ ・ span.no か code.no の番号 ・ 件名) + div.issue-body (本文)
	本文の中に details (入れ子) があってもよい。課題として数えるのは、章の直下の details だけ。
*/
import fs from 'node:fs';
import path from 'node:path';
import { getBlock, getPlainText } from '../html2md/htmlutil.ts';
import { Failure, UsageError, listIssues, slugFromTitle } from './ops.ts';
import { Converter } from '../html2md/converter.ts';
import { markdownToHtml, type MdOptions } from './markdown.ts';
import { ItemsRel } from './check.ts';
import { States } from './meta.ts';
import type { Folder } from './check.ts';

/** legacyId: 番号を直して書いたとき (182-A。連番の小文字の l → L) の、元の番号 */
export type LegacyIssue = { id: string; state: string; title: string; group: string; bodyHtml: string; legacyId?: string };

/**
 * バッジの class が表す状態 (181-A)。字が 未 ・ 着手 ・ 済 でないとき (ai-chat-lite の ☑ 等) に使う。
 * 字が 未 ・ 着手 ・ 済 なら、字を優先する
 */
const StateOfBadgeClass: Record<string, string> = {
	'b-done': '済', 'b-ok': '済',
	'b-wip': '着手', 'b-warn': '着手', 'b-doing': '着手',
	'b-todo': '未', 'b-none': '未',
};

/** バッジ (span.badge) の開きタグの属性と中身から、状態を決める。決まらなければ空 */
function stateOfBadge(attrs: string, inner: string): string {
	const text = getPlainText(inner).trim();
	if ((States as readonly string[]).includes(text)) return text;
	const cls = /class="([^"]*)"/.exec(attrs)?.[1] ?? '';
	for (const c of cls.split(/\s+/)) if (StateOfBadgeClass[c] !== undefined) return StateOfBadgeClass[c];
	return '';
}

/**
 * 本文の相対リンク (href ・ src) の前に prefix を足す。置き場が notes/40_issues/ から items/<状態>/ へ 2 段深くなるため。
 * 外のリンク (スキーム付き ・ // ・ /)、ページ内 (#)、mailto 等は変えない
 */
export function rebaseLinks(html: string, prefix: string): string {
	return html.replace(/\b(href|src)="([^"]*)"/g, (all, attr: string, url: string) => {
		if (url === '' || url.startsWith('#') || url.startsWith('/') || /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(url)) return all;
		return `${attr}="${prefix}${url}"`;
	});
}
export type LegacyProblem = { where: string; message: string };

const IdPattern = /^i\d{6}-[0-9a-zA-Z]{2}$/;
const BadgePattern = /<span\b([^>]*class="badge[^"]*"[^>]*)>([\s\S]*?)<\/span>/;
/** 番号: span か code で、class に no の語を持つもの (ai-agent-rules は code に書く。#1830)。中身は 2 番目の組 */
const NoPattern = /<(span|code)\b[^>]*class="(?:[^"]*\s)?no(?:\s[^"]*)?"[^>]*>([\s\S]*?)<\/\1>/;

/** 件数の表示 (ai-chat-lite のグループの summary の span.count)。グループ名から除く */
const CountPattern = /<span\b[^>]*class="(?:[^"]*\s)?count(?:\s[^"]*)?"[^>]*>[\s\S]*?<\/span>/g;
/** グループの見出しの候補: section の中の h1 (ai-agent-tools) と、div.groupbar の h2 (ai-agent-rules)。summary の中のものは除く */
const HeadingPattern = /<h1\b[^>]*>([\s\S]*?)<\/h1>|<div\b[^>]*class="(?:[^"]*\s)?groupbar(?:\s[^"]*)?"[^>]*>[\s\S]*?<h2\b[^>]*>([\s\S]*?)<\/h2>/g;

type Heading = { at: number; text: string };

/** summary の中にある範囲 [開始, 終わり)。見出しの候補から除くため */
function summaryRanges(html: string): [number, number][] {
	const ranges: [number, number][] = [];
	const re = /<summary\b/gi;
	let m: RegExpExecArray | null;
	while ((m = re.exec(html)) !== null) {
		const b = getBlock(html, m.index, 'summary');
		ranges.push([m.index, m.index + b.outer.length]);
		re.lastIndex = m.index + b.outer.length;
	}
	return ranges;
}

function headingsOf(html: string): Heading[] {
	const ranges = summaryRanges(html);
	const inSummary = (at: number): boolean => ranges.some(([s, e]) => at >= s && at < e);
	const out: Heading[] = [];
	let m: RegExpExecArray | null;
	HeadingPattern.lastIndex = 0;
	while ((m = HeadingPattern.exec(html)) !== null) {
		if (inSummary(m.index)) continue;
		out.push({ at: m.index, text: getPlainText(m[1] ?? m[2] ?? '').replace(/\s+/g, ' ').trim() });
	}
	return out;
}

/**
 * 旧 HTML 全体から、課題を読む。読めなかったものは problems に出す (179-A: 作りに頼らない読み方)。
 *   - 番号 (span.no か code.no) を summary に持つ details を、1 件の課題とみなす。本文は summary より後ろ全部
 *   - 番号を持たない details で、中に番号を持つ details があるものは、グループとみなして中へ入る (ai-chat-lite)
 *   - グループは、外側のグループの details の summary、無ければ、その課題より前で最も近い見出し
 *     (section の h1 か div.groupbar の h2。summary の中のものは除く)
 *   - 課題の本文 (の中の details) は、課題として数えない
 */
export function parseLegacyIssues(html: string): { issues: LegacyIssue[]; problems: LegacyProblem[] } {
	const issues: LegacyIssue[] = [];
	const problems: LegacyProblem[] = [];
	const seen = new Set<string>();
	const headings = headingsOf(html);
	const headingBefore = (at: number): string => {
		let text = '';
		for (const h of headings) {
			if (h.at < at) text = h.text;
			else break;
		}
		return text;
	};
	walk(html, 0, html.length, null);
	return { issues, problems };

	function walk(text: string, from: number, to: number, parentGroup: string | null): void {
		let at = from;
		for (;;) {
			const start = text.indexOf('<details', at);
			if (start < 0 || start >= to) break;
			const block = getBlock(text, start, 'details');
			at = start + block.outer.length;
			const contentStart = text.indexOf('>', start) + 1;
			const inner = block.inner;
			const summaryStart = inner.indexOf('<summary');
			const summary = summaryStart < 0 ? null : getBlock(inner, summaryStart, 'summary');
			const hasNo = summary !== null && NoPattern.test(summary.inner);
			if (!hasNo && summary !== null && NoPattern.test(inner)) {
				// 番号を持つ課題を中に持つ、グループの details
				const name = getPlainText(summary.inner.replace(new RegExp(BadgePattern.source, 'g'), '').replace(CountPattern, '')).replace(/\s+/g, ' ').trim();
				const innerFrom = contentStart + summaryStart + summary.outer.length;
				walk(text, innerFrom, contentStart + inner.length, name);
				continue;
			}
			readDetails(inner, parentGroup ?? headingBefore(start), issues, problems, seen);
		}
	}
}

function readDetails(inner: string, group: string, issues: LegacyIssue[], problems: LegacyProblem[], seen: Set<string>): void {
	const summaryStart = inner.indexOf('<summary');
	if (summaryStart < 0) {
		problems.push({ where: group, message: 'summary が無い (課題の見出しを読めない)' });
		return;
	}
	const summary = getBlock(inner, summaryStart, 'summary');
	const badge = BadgePattern.exec(summary.inner);
	const no = NoPattern.exec(summary.inner);
	// 件名は、状態のバッジと番号を除いた、タグのない 1 行
	const titleHtml = summary.inner.replace(new RegExp(BadgePattern.source, 'g'), '').replace(new RegExp(NoPattern.source, 'g'), '');
	const title = getPlainText(titleHtml).replace(/\s+/g, ' ').trim();
	const where = group + ' / ' + title;

	const legacy = no === null ? '' : getPlainText(no[2]).trim();
	if (!IdPattern.test(legacy)) {
		problems.push({ where, message: '番号 (span.no か code.no) が無い、または i + yymmdd-nn の形でない' });
		return;
	}
	// 182-A: 連番の小文字の l は、読み間違えないよう L と書く決まり。直して書き、元の番号を残す
	const id = legacy.slice(0, 8) + legacy.slice(8).replace(/l/g, 'L');
	const state = badge === null ? '' : stateOfBadge(badge[1], badge[2]);
	if (!(States as readonly string[]).includes(state)) {
		problems.push({ where: id + ' ' + where, message: `状態のバッジが 未 ・ 着手 ・ 済 のどれでもない (${JSON.stringify(state)})` });
		return;
	}
	if (seen.has(id)) {
		problems.push({ where: id + ' ' + where, message: '番号が重複している (先に読んだ課題を残し、これは読まない)' });
		return;
	}
	seen.add(id);

	// 本文は summary より後ろ全部 (div.issue-body でも、p と ul が直接並ぶ形でもよい)
	let bodyHtml = inner.slice(summaryStart + summary.outer.length).trim();
	const wrapped = /^<div\b[^>]*class="[^"]*\bissue-body\b[^"]*"[^>]*>/.exec(bodyHtml);
	if (wrapped !== null) {
		const b = getBlock(bodyHtml, 0, 'div');
		if (b.outer.length === bodyHtml.length) bodyHtml = b.inner;
	}
	// 本文もやることも無いまま書くと、空の課題ができて気づけない (#1832)
	if (getPlainText(bodyHtml).trim() === '') {
		problems.push({ where: id + ' ' + where, message: '本文もやることも空 (旧 HTML の作りを読めていない見込み。書かない)' });
		return;
	}
	issues.push(legacy === id ? { id, state, title, group, bodyHtml } : { id, state, title, group, bodyHtml, legacyId: legacy });
}

// ---- 移す計画 ----

export type PlannedMove = LegacyIssue & { folder: Folder; source: string };
export type MigratePlan = {
	/** 読んだ課題の数 (読めなかったものは数えない) */
	read: number;
	/** 旧 HTML ごとの、読んだ課題の数 */
	sources: { file: string; count: number }[];
	move: PlannedMove[];
	/** すでに items/ にある番号 (移さない) */
	exists: string[];
	unreadable: LegacyProblem[];
	/** 旧の記録の食い違い (済なのに未 ・ 着手のやることがある)。--apply は、これが残っていれば書かない (169-A) */
	conflicts: { id: string; where: string; message: string }[];
	/** 移した後の中身が、旧 HTML と食い違うもの (183-A。本文の文字数 ・ やることの数)。--apply は、これが残っていれば書かない */
	mismatches: { id: string; where: string; message: string }[];
	/** 本文の文字数 (空白を除く) の合計。旧 HTML と、移した後 (Markdown を HTML に戻したもの) */
	size: { sourceChars: number; convertedChars: number; sourceTodos: number; convertedTodos: number };
};

/** 本文の文字数: タグを除き、空白をすべて除いた長さ (書き方の違いで空白が増減するため) */
function textLength(html: string): number {
	return getPlainText(html).replace(/\s+/g, '').length;
}

/** 旧 HTML のやることの数: 状態を読めるバッジで始まる li */
function sourceTodoCount(html: string): number {
	let n = 0;
	const re = /<li\b[^>]*>\s*<span\b([^>]*class="badge[^"]*"[^>]*)>([\s\S]*?)<\/span>/g;
	let m: RegExpExecArray | null;
	while ((m = re.exec(html)) !== null) if (stateOfBadge(m[1], m[2]) !== '') n++;
	return n;
}

/** Markdown のやることの数: - [未 ・ 着手 ・ 済] の行 (callout の > の中も数える) */
function markdownTodoCount(md: string): number {
	return (md.match(/^(?:\s*>)*\s*- \[(?:未|着手|済)\]/gm) ?? []).length;
}

const PlainMdOptions: MdOptions = { resolveImage: (h) => h, resolveLink: (h) => h, warn: () => {} };

/** 1 件の、旧 HTML と移した後 (Markdown) の食い違い。無ければ空 */
function compareBody(bodyHtml: string, md: string): { message: string; sourceChars: number; convertedChars: number; sourceTodos: number; convertedTodos: number } {
	const sourceChars = textLength(bodyHtml);
	const convertedChars = textLength(markdownToHtml(md, PlainMdOptions));
	const sourceTodos = sourceTodoCount(bodyHtml);
	const convertedTodos = markdownTodoCount(md);
	const why: string[] = [];
	if (sourceTodos !== convertedTodos) why.push(`やることの数 ${sourceTodos} → ${convertedTodos}`);
	// バッジの字が - [状態] に変わる等で少しずれうる。1 割 (少なくとも 10 字) を超えたら食い違いとみなす
	if (Math.abs(sourceChars - convertedChars) > Math.max(10, sourceChars * 0.1)) why.push(`本文の文字数 ${sourceChars} → ${convertedChars}`);
	return { message: why.join(' ・ '), sourceChars, convertedChars, sourceTodos, convertedTodos };
}

/** 移す課題を、書く前に Markdown にして、旧 HTML と比べる (183-A) */
function findMismatches(plan: MigratePlan): void {
	const converter = new Converter();
	plan.mismatches = [];
	plan.size = { sourceChars: 0, convertedChars: 0, sourceTodos: 0, convertedTodos: 0 };
	for (const m of plan.move) {
		const c = compareBody(m.bodyHtml, bodyToMarkdown(rebaseLinks(m.bodyHtml, '../../'), converter));
		plan.size.sourceChars += c.sourceChars;
		plan.size.convertedChars += c.convertedChars;
		plan.size.sourceTodos += c.sourceTodos;
		plan.size.convertedTodos += c.convertedTodos;
		if (c.message !== '') plan.mismatches.push({ id: m.id, where: m.group + ' / ' + m.title, message: c.message });
	}
}

/** 書いたファイルを読み直して、旧 HTML と比べる (183-A。--apply の後)。食い違いの一覧を返す */
export function verifyWritten(root: string, plan: MigratePlan, written: { id: string; rel: string }[]): { id: string; message: string }[] {
	const out: { id: string; message: string }[] = [];
	const byId = new Map(plan.move.map((m) => [m.id, m]));
	for (const w of written) {
		const m = byId.get(w.id);
		if (m === undefined) continue;
		const text = fs.readFileSync(path.join(root, ...w.rel.split('/')), 'utf8');
		const end = text.indexOf('\n---\n', 4);
		const md = end < 0 ? '' : text.slice(end + 5);
		const c = compareBody(m.bodyHtml, md);
		if (c.message !== '') out.push({ id: w.id, message: c.message });
	}
	return out;
}

/** --apply が書いたファイルの一覧 (--undo が読む)。先頭 _ で Git 管理外 */
export const WrittenListRel = 'notes/40_issues/_migrate-written.txt';

/** 書いたファイルを消す (--apply の自動の戻し ・ --undo)。消した数を返す。一覧に無いものは触らない */
export function removeWritten(root: string, rels: string[]): number {
	let n = 0;
	for (const rel of rels) {
		const full = path.join(root, ...rel.split('/'));
		if (!rel.startsWith(ItemsRel + '/') || !fs.existsSync(full)) continue;
		fs.rmSync(full);
		n++;
	}
	return n;
}

const LegacyFile = 'issues-legacy.html';
const OldFile = 'issues.html';
const ArchiveFile = 'issues-archive.html';
const FolderOfState: Record<string, Folder> = { 未: 'todo', 着手: 'doing', 済: 'done' };

/** 旧 HTML (移行前は issues.html、改名後は issues-legacy.html) と issues-archive.html を読み、移す計画を立てる。何も書かない */
export function planMigration(root: string): MigratePlan {
	const dir = path.join(root, 'notes', '40_issues');
	const legacyName = fs.existsSync(path.join(dir, LegacyFile)) ? LegacyFile : OldFile;
	const targets: { name: string; archive: boolean }[] = [];
	if (fs.existsSync(path.join(dir, legacyName))) targets.push({ name: legacyName, archive: false });
	if (fs.existsSync(path.join(dir, ArchiveFile))) targets.push({ name: ArchiveFile, archive: true });
	if (targets.length === 0) {
		throw new Failure('旧 HTML (notes/40_issues/issues.html か issues-legacy.html) が見つからない');
	}

	const existingIds = new Set(
		listIssues(root, ['todo', 'doing', 'done', 'archived'], null, () => { /* 警告は check の仕事 */ }).map((i) => i.id),
	);
	const plan: MigratePlan = {
		read: 0, sources: [], move: [], exists: [], unreadable: [], conflicts: [], mismatches: [],
		size: { sourceChars: 0, convertedChars: 0, sourceTodos: 0, convertedTodos: 0 },
	};
	const seenAcrossFiles = new Set<string>();
	for (const t of targets) {
		const text = fs.readFileSync(path.join(dir, t.name), 'utf8').replace(/^﻿/, '');
		const parsed = parseLegacyIssues(text);
		let count = 0;
		for (const issue of parsed.issues) {
			if (seenAcrossFiles.has(issue.id)) {
				plan.unreadable.push({ where: issue.id + ' ' + issue.group + ' / ' + issue.title, message: `番号が ${t.name} と、先に読んだ旧 HTML の両方にある (先に読んだ課題を残す)` });
				continue;
			}
			if (t.archive && issue.state !== '済') {
				plan.unreadable.push({ where: issue.id + ' ' + issue.group + ' / ' + issue.title, message: `保管の課題の状態が 済 でない (${issue.state})` });
				continue;
			}
			seenAcrossFiles.add(issue.id);
			count++;
			if (existingIds.has(issue.id)) { plan.exists.push(issue.id); continue; }
			plan.move.push({ ...issue, folder: t.archive ? 'archived' : FolderOfState[issue.state], source: t.name });
		}
		plan.read += count;
		plan.sources.push({ file: t.name, count });
		for (const p of parsed.problems) plan.unreadable.push({ where: p.where, message: p.message });
	}
	findConflicts(plan, new Map());
	findMismatches(plan);
	return plan;
}

const OpenTodo = /^\s*- \[(未|着手)\]/gm;

/**
 * 済 (done/ ・ archived/) に置くのに、未 ・ 着手のやることが残っている課題を conflicts に入れる (169-A)。
 * overrides (番号 → 未 ・ 着手 ・ 済) で利用者が決めたものは、その状態のフォルダへ移してから見る
 */
function findConflicts(plan: MigratePlan, overrides: Map<string, string>): void {
	const converter = new Converter();
	plan.conflicts = [];
	for (const m of plan.move) {
		const state = overrides.get(m.id);
		if (state === '未' || state === '着手') m.folder = FolderOfState[state];
		if (m.folder !== 'done' && m.folder !== 'archived') continue;
		const open = (bodyToMarkdown(m.bodyHtml, converter).match(OpenTodo) ?? []).length;
		if (open > 0) {
			plan.conflicts.push({ id: m.id, where: m.group + ' / ' + m.title, message: `旧 HTML では済なのに、未 ・ 着手のやることが ${open} 件残っている` });
		}
	}
}

/** --state-override (番号=状態 をカンマで区切る) を当てる。誤りは UsageError (終了コード 5) */
export function applyOverrides(plan: MigratePlan, spec: string): void {
	const overrides = new Map<string, string>();
	const ids = new Set(plan.move.map((m) => m.id));
	for (const part of spec.split(',').map((s) => s.trim()).filter((s) => s !== '')) {
		const m = /^(i\d{6}-[0-9a-zA-Z]{2})=(.+)$/.exec(part);
		if (m === null) throw new UsageError(`--state-override の形が違う: ${part} (例: i261101-02=着手)`);
		if (!(States as readonly string[]).includes(m[2])) throw new UsageError(`--state-override の状態が 未 ・ 着手 ・ 済 のどれでもない: ${part}`);
		if (!ids.has(m[1])) throw new UsageError(`--state-override の番号が、移す課題に無い: ${m[1]}`);
		overrides.set(m[1], m[2]);
	}
	findConflicts(plan, overrides);
}

// ---- 書き出す (--apply) ----

/** バッジ付きの列挙の目印。Markdown に変換したあとで - [状態] に戻す (165-A) */
const TodoMark = 'ZZISSUETODO';

/** 旧 HTML の本文を Markdown にする。バッジ付きの列挙だけを - [状態] 文 の行にする (165-A) */
export function bodyToMarkdown(bodyHtml: string, converter: Converter): string {
	// やることのバッジも、字か class で状態を決める (181-A)。li の属性 (class="done" 等) があってもよい
	const marked = bodyHtml.replace(
		/<li\b[^>]*>\s*<span\b([^>]*class="badge[^"]*"[^>]*)>([\s\S]*?)<\/span>\s*/g,
		(all, attrs: string, inner: string) => {
			const state = stateOfBadge(attrs, inner);
			if (state === '') return all;
			return `<li>${TodoMark}${({ 未: 'A', 着手: 'B', 済: 'C' } as Record<string, string>)[state]}${TodoMark} `;
		},
	);
	const md = converter.convertFragment(marked).replace(/\r\n?/g, '\n').trim();
	const back: Record<string, string> = { A: '未', B: '着手', C: '済' };
	// 行頭の字下げと、callout (引用) の > を残して戻す
	return md.replace(new RegExp(`^((?:\\s*>)*\\s*)[-*] ${TodoMark}([ABC])${TodoMark}\\s*`, 'gm'), (_m, indent: string, s: string) => `${indent}- [${back[s]}] `);
}

/** 番号 (i + yymmdd-nn) の日付を yyyy-mm-dd にする */
function createdOf(id: string): string {
	return `20${id.slice(1, 3)}-${id.slice(3, 5)}-${id.slice(5, 7)}`;
}

export type ApplyResult = { written: { id: string; rel: string }[] };

/** 計画のとおりに items/ へ書く。すでにある番号は計画の時点で外してある (166-A)。旧 HTML には触らない */
export function applyMigration(root: string, plan: MigratePlan): ApplyResult {
	const converter = new Converter();
	// 先に全部の中身を作り、名前を決めてから書く (途中で例外が出ても、半端に書かない)
	const files = plan.move.map((m) => {
		const slug = slugFromTitle(m.title) || 'issue';
		const rel = `${ItemsRel}/${m.folder}/${m.id}-${slug}.md`;
		const lines = ['schema: 1', `id: ${m.id}`, `title: ${m.title}`, `group: ${m.group}`, `created: ${createdOf(m.id)}`];
		// 置き場が notes/40_issues/ から items/<状態>/ へ 2 段深くなるので、本文の相対リンクを直す
		const body = bodyToMarkdown(rebaseLinks(m.bodyHtml, '../../'), converter);
		return { id: m.id, rel, text: '---\n' + lines.join('\n') + '\n---\n' + (body === '' ? '\n' : '\n' + body + '\n') };
	});
	for (const f of files) {
		if (fs.existsSync(path.join(root, ...f.rel.split('/')))) throw new Failure(`${f.rel} が既にある (書かない)`);
	}
	const written: { id: string; rel: string }[] = [];
	for (const f of files) {
		const full = path.join(root, ...f.rel.split('/'));
		fs.mkdirSync(path.dirname(full), { recursive: true });
		fs.writeFileSync(full, f.text, { flag: 'wx' });
		written.push({ id: f.id, rel: f.rel });
	}
	return { written };
}
