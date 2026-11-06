/*
	旧 issues.html (1 ファイルに全件) の課題を読み、新しい形 (1 件 1 ファイル) へ移す計画を立てる。
	計画は p261105-01 (各プロジェクトの課題の移行) と p261106-01 (143-A: 済みも移す)。

	既定は読み取りだけ (--dry-run)。--apply で items/ へ書く (165-A ・ 166-A)。
	読めない形は、推測で補わず「読めなかった」に出す。

	旧 HTML の形:
		section > h1 (グループ)
		  details > summary (状態のバッジ ・ span.no の番号 ・ 件名) + div.issue-body (本文)
	本文の中に details (入れ子) があってもよい。課題として数えるのは、章の直下の details だけ。
*/
import fs from 'node:fs';
import path from 'node:path';
import { getBlock, getPlainText } from '../html2md/htmlutil.ts';
import { Failure, UsageError, listIssues, slugFromTitle } from './ops.ts';
import { Converter } from '../html2md/converter.ts';
import { ItemsRel } from './check.ts';
import { States } from './meta.ts';
import type { Folder } from './check.ts';

export type LegacyIssue = { id: string; state: string; title: string; group: string; bodyHtml: string };
export type LegacyProblem = { where: string; message: string };

const IdPattern = /^i\d{6}-[0-9a-zA-Z]{2}$/;
const BadgePattern = /<span\b[^>]*class="badge[^"]*"[^>]*>([\s\S]*?)<\/span>/;
const NoPattern = /<span\b[^>]*class="no"[^>]*>([\s\S]*?)<\/span>/;

/** 旧 HTML 全体から、課題を読む。読めなかったものは problems に出す */
export function parseLegacyIssues(html: string): { issues: LegacyIssue[]; problems: LegacyProblem[] } {
	const issues: LegacyIssue[] = [];
	const problems: LegacyProblem[] = [];
	const seen = new Set<string>();
	const sectionOpen = /<section\b[^>]*>/g;
	let m: RegExpExecArray | null;
	while ((m = sectionOpen.exec(html)) !== null) {
		const section = getBlock(html, m.index, 'section');
		sectionOpen.lastIndex = m.index + section.outer.length;
		const h1 = /<h1\b[^>]*>([\s\S]*?)<\/h1>/.exec(section.inner);
		const group = h1 === null ? '' : getPlainText(h1[1]).trim();
		let at = 0;
		for (;;) {
			const start = section.inner.indexOf('<details', at);
			if (start < 0) break;
			const details = getBlock(section.inner, start, 'details');
			at = start + details.outer.length;
			readDetails(details.inner, group, issues, problems, seen);
		}
	}
	return { issues, problems };
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

	const id = no === null ? '' : getPlainText(no[1]).trim();
	if (!IdPattern.test(id)) {
		problems.push({ where, message: '番号 (span.no) が無い、または i + yymmdd-nn の形でない' });
		return;
	}
	const state = badge === null ? '' : getPlainText(badge[1]).trim();
	if (!(States as readonly string[]).includes(state)) {
		problems.push({ where: id + ' ' + where, message: `状態のバッジが 未 ・ 着手 ・ 済 のどれでもない (${JSON.stringify(state)})` });
		return;
	}
	if (seen.has(id)) {
		problems.push({ where: id + ' ' + where, message: '番号が重複している (先に読んだ課題を残し、これは読まない)' });
		return;
	}
	seen.add(id);

	const bodyStart = findIssueBody(inner, summaryStart + summary.outer.length);
	const bodyHtml = bodyStart < 0 ? '' : getBlock(inner, bodyStart, 'div').inner;
	issues.push({ id, state, title, group, bodyHtml });
}

function findIssueBody(inner: string, from: number): number {
	const re = /<div\b[^>]*class="[^"]*\bissue-body\b[^"]*"[^>]*>/g;
	re.lastIndex = from;
	const m = re.exec(inner);
	return m === null ? -1 : m.index;
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
};

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
	const plan: MigratePlan = { read: 0, sources: [], move: [], exists: [], unreadable: [], conflicts: [] };
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
	const marked = bodyHtml.replace(
		/<li>\s*<span\b[^>]*class="badge[^"]*"[^>]*>\s*(未|着手|済)\s*<\/span>\s*/g,
		(_m, state: string) => `<li>${TodoMark}${({ 未: 'A', 着手: 'B', 済: 'C' } as Record<string, string>)[state]}${TodoMark} `,
	);
	const md = converter.convertFragment(marked).replace(/\r\n?/g, '\n').trim();
	const back: Record<string, string> = { A: '未', B: '着手', C: '済' };
	return md.replace(new RegExp(`^(\\s*)[-*] ${TodoMark}([ABC])${TodoMark}\\s*`, 'gm'), (_m, indent: string, s: string) => `${indent}- [${back[s]}] `);
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
		const body = bodyToMarkdown(m.bodyHtml, converter);
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
