/*
	issue migrate の結果を、元の旧 HTML と機械で比べる (i261108-02 ・ 180)。
	元のプロジェクトには書かない。旧 HTML を tmp/compare-migration/<名前>/ へ写し、そこで
	migrate --apply と render (全件) を流して _issues.html を作り、元と課題ごとに比べる。

		node tools/50_run/compare-migration/compare.ts <プロジェクトのフォルダ> [...]

	比べるもの (課題ごと): 題 ・ 状態 ・ グループ ・ 本文の文字数 (タグを除き、空白を詰めたもの) ・ やることの数。
	ファイル全体: 課題の数 ・ 本文の文字数の合計。
	_issues.html は ai-agent-tools の旧 HTML と同じ作りなので、同じ parseLegacyIssues で課題に分ける。
*/
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { applyMigration, parseLegacyIssues, planMigration, tableTodosToList, type LegacyIssue } from '../../../src/issue/migrate.ts';
import { initProject } from '../../../src/issue/ops.ts';
import { renderHtml } from '../../../src/issue/render.ts';
import { getPlainText } from '../../../src/html2md/htmlutil.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '..', '..', '..');
const LegacyNames = ['issues-legacy.html', 'issues.html', 'issues-archive.html'];

/** 本文の文字数: タグを除き、空白をすべて除いた長さ (書き方の違いで空白が増減するため) */
function textLength(html: string): number {
	// _issues.html が課題ごとに足す p.meta (作成日とファイルへのリンク) は、元に無いので除く
	return getPlainText(html.replace(/<p\b[^>]*class="meta"[^>]*>[\s\S]*?<\/p>/g, '')).replace(/\s+/g, '').length;
}

/** やることの数: バッジ付きの li か li.todo (_issues.html は両方を持つので、li 1 つを 1 回だけ数える) */
function todoCount(html: string): number {
	let n = 0;
	// バッジは、字 (未 ・ 着手 ・ 済) か、状態を表す class (181-A。ai-chat-lite の ☑ は b-done) を持つもの
	const re = /<li\b([^>]*)>\s*(?:<span\b[^>]*class="badge([^"]*)"[^>]*>\s*([^<]*?)\s*<\/span>)?/g;
	let m: RegExpExecArray | null;
	while ((m = re.exec(html)) !== null) {
		const isTodoLi = /class="(?:[^"]*\s)?todo(?:\s[^"]*)?"/.test(m[1]);
		const badgeState = m[2] !== undefined && (/^(?:未|着手|済)$/.test(m[3]) || /\bb-(?:done|ok|wip|warn|doing|todo|none)\b/.test(m[2]));
		if (isTodoLi || badgeState) n++;
	}
	return n;
}

function read(file: string): string {
	return fs.readFileSync(file, 'utf8').replace(/^﻿/, '');
}

function compareProject(src: string): void {
	const name = path.basename(src);
	const srcIssues = path.join(src, 'notes', '40_issues');
	const work = path.join(repo, 'tmp', 'compare-migration', name);
	fs.rmSync(work, { recursive: true, force: true });
	const workIssues = path.join(work, 'notes', '40_issues');
	fs.mkdirSync(workIssues, { recursive: true });
	const copied: string[] = [];
	for (const n of LegacyNames) {
		if (n === 'issues.html' && copied.includes('issues-legacy.html')) continue;
		const f = path.join(srcIssues, n);
		if (fs.existsSync(f)) { fs.copyFileSync(f, path.join(workIssues, n)); copied.push(n); }
	}
	if (copied.length === 0) { console.log(`⬜ ${name}: 旧 HTML が無い`); return; }
	initProject(work, false);

	// 元の課題 (旧 HTML を、そのまま読んだもの)
	const original = new Map<string, LegacyIssue>();
	for (const n of copied) for (const i of parseLegacyIssues(read(path.join(workIssues, n))).issues) if (!original.has(i.id)) original.set(i.id, i);

	const plan = planMigration(work);
	applyMigration(work, plan);
	const out = path.join(workIssues, '_issues.html');
	const r = renderHtml({ root: work, outFile: out, standalone: false, folders: ['todo', 'doing', 'done', 'archived'], group: null, ids: [], warn: () => {} });
	fs.writeFileSync(out, r.html);
	const rendered = new Map<string, LegacyIssue>();
	// 保管の課題のバッジは「済 ・ archived」。元の状態 (済) と比べるため、済 に戻してから読む
	const renderedParsed = parseLegacyIssues(r.html.replace(/>済 ・ archived</g, '>済<'));
	for (const i of renderedParsed.issues) rendered.set(i.id, i);
	for (const p of renderedParsed.problems) console.log(`    _issues.html を読めない: ${p.where}: ${p.message}`);

	const diffs: string[] = [];
	let srcChars = 0;
	let outChars = 0;
	let srcTodos = 0;
	let outTodos = 0;
	for (const [id, o] of original) {
		const m = rendered.get(id);
		const oc = textLength(o.bodyHtml);
		// 表のやること (184-A) は、移すと列挙になる。元の側も、列挙にしてから数える
		const ot = todoCount(tableTodosToList(o.bodyHtml));
		srcChars += oc;
		srcTodos += ot;
		if (m === undefined) { diffs.push(`${id}: 移した結果に無い`); continue; }
		const mc = textLength(m.bodyHtml);
		const mt = todoCount(m.bodyHtml);
		outChars += mc;
		outTodos += mt;
		const group = m.group.replace(/\s*\(\d+ 件\)$/, '');
		const why: string[] = [];
		if (o.title !== m.title) why.push(`題 「${o.title}」→「${m.title}」`);
		if (o.state !== m.state) why.push(`状態 ${o.state}→${m.state}`);
		if (o.group !== group) why.push(`グループ 「${o.group}」→「${group}」`);
		if (ot !== mt) why.push(`やること ${ot}→${mt}`);
		// 文字数は、バッジの字 (未 ・ 着手 ・ 済) が - [状態] に変わる分だけずれうる。1 割を超えたら出す
		if (Math.abs(oc - mc) > Math.max(10, oc * 0.1)) why.push(`本文の文字数 ${oc}→${mc}`);
		if (why.length > 0) diffs.push(`${id}: ${why.join(' ・ ')}`);
	}
	for (const id of rendered.keys()) if (!original.has(id)) diffs.push(`${id}: 元に無い課題が移した結果にある`);

	const mark = diffs.length === 0 && plan.unreadable.length === 0 ? '✅' : '❌';
	console.log(`${mark} ${name}: 課題 元 ${original.size} → 移した ${rendered.size} ・ 読めない ${plan.unreadable.length} ・ 食い違い ${diffs.length} 件 ・ 本文の文字数 ${srcChars}→${outChars} ・ やること ${srcTodos}→${outTodos}`);
	console.log(`    migrate --dry-run の中身の比較: 食い違い ${plan.mismatches.length} 件 ・ 本文の文字数 ${plan.size.sourceChars}→${plan.size.convertedChars} ・ やること ${plan.size.sourceTodos}→${plan.size.convertedTodos}`);
	for (const x of plan.mismatches.slice(0, 5)) console.log(`      ${x.id}: ${x.message}`);
	for (const u of plan.unreadable.slice(0, 5)) console.log(`    読めない: ${u.where}: ${u.message}`);
	if (plan.unreadable.length > 5) console.log(`    (読めない 残り ${plan.unreadable.length - 5} 件)`);
	for (const d of diffs.slice(0, 8)) console.log(`    ${d}`);
	if (diffs.length > 8) console.log(`    (食い違い 残り ${diffs.length - 8} 件)`);
}

for (const p of process.argv.slice(2)) {
	try {
		compareProject(path.resolve(p));
	} catch (e) {
		console.log(`❌ ${path.basename(p)}: 失敗: ${e instanceof Error ? e.message : String(e)}`);
	}
}
