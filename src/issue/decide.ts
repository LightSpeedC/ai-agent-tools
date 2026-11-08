/*
	issue decide: 決定の記録 (new ・ list ・ show)。計画は p261108-01、仕様は notes/50_spec/課題ファイルの形と検査.html。

	決定は notes/40_issues/decisions/<親の番号>-d<連番>-<件名>.md に、1 件 1 ファイルで置く。
	状態のフォルダは持たない (覆すときは、新しい決定を立てて replaces で指す)。
	ここの関数は、何かを表示せず、結果を返すか、UsageError ・ Failure を投げる。
*/
import fs from 'node:fs';
import path from 'node:path';
import {
	DecisionIdPattern, DecisionNamePattern, DecisionRefPattern, DecisionsRel, LegacyIdPattern, OptionLine, ParentPattern, SlugMax, SlugPattern, listMdNames,
} from './check.ts';
import { splitIssue } from './meta.ts';
import { Failure, UsageError, acquire, compareId, lockBaseOf, release, singleLine, slugFromTitle, todayJst } from './ops.ts';

/** 案の字。--option を書いた順に振る */
const Letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

function decisionsDirOf(root: string): string {
	return path.join(root, ...DecisionsRel.split('/'));
}

/** カンマ区切りの値を確かめて、「, 」でつなぎ直す */
function listValue(value: string | undefined, name: string, pattern: RegExp): string | undefined {
	if (value === undefined) return undefined;
	const items = value.split(',').map((s) => s.trim());
	if (items.some((s) => !pattern.test(s))) throw new UsageError(`${name} の形が違う: ${value}`);
	return items.join(', ');
}

/** その親の決定の連番の最大。無ければ 0 */
function maxNumber(root: string, parent: string): number {
	let max = 0;
	for (const name of listMdNames(decisionsDirOf(root))) {
		const m = DecisionNamePattern.exec(name);
		if (m === null) continue;
		const id = DecisionIdPattern.exec(m[1]);
		if (id !== null && id[1] === parent) max = Math.max(max, Number(id[2]));
	}
	return max;
}

function hasFileWithId(root: string, id: string): boolean {
	return listMdNames(decisionsDirOf(root)).some((n) => n.startsWith(id + '-'));
}

export type DecideOptions = {
	parent: string;
	title: string;
	options: string[];
	chosen: string;
	slug?: string;
	refs?: string;
	replaces?: string;
	legacy?: string;
	body?: string;
	/** 決めた日 (yyyy-mm-dd)。省けば JST の今日。過去の決定の移行 (p261108-03) が、資料の作成日を渡す */
	decided?: string;
};

/** decisions/ に決定を作る。何かを作る前に、引数をすべて確かめる */
export function newDecision(root: string, o: DecideOptions): { id: string; rel: string } {
	if (!ParentPattern.test(o.parent)) throw new UsageError(`--parent の形が違う: ${o.parent} (課題 ・ 計画 ・ 調査の番号。例: i261103-01 ・ p261108-01)`);
	const title = singleLine(o.title, '--title');
	if (o.options.length === 0) throw new UsageError('--option (案) が 1 つも無い');
	if (o.options.length > Letters.length) throw new UsageError(`--option が ${Letters.length} を超えている`);
	const options = o.options.map((text) => singleLine(text, '--option'));
	if (!/^[A-Z]$/.test(o.chosen) || Letters.indexOf(o.chosen) >= options.length) {
		throw new UsageError(`--chosen は、案の字 (${Letters.slice(0, options.length).split('').join(' ・ ')}) のどれか: ${o.chosen}`);
	}
	const refs = listValue(o.refs, '--refs', DecisionRefPattern);
	const replaces = listValue(o.replaces, '--replaces', DecisionRefPattern);
	const legacy = listValue(o.legacy, '--legacy', LegacyIdPattern);
	const slug = o.slug !== undefined ? o.slug : slugFromTitle(title);
	if (slug === '') throw new UsageError('題から件名を作れない。--slug で指定する');
	if (!SlugPattern.test(slug)) throw new UsageError(`--slug に使えない文字がある: ${slug} (英数字 ・ - ・ _ ・ . ・ 日本語だけ。空白は不可)`);
	if ([...slug].length > SlugMax) throw new UsageError(`--slug が ${SlugMax} 文字を超えている: ${slug}`);

	if (o.decided !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(o.decided)) throw new UsageError(`決めた日の形が違う: ${o.decided}`);
	const today = o.decided ?? todayJst();
	const dir = decisionsDirOf(root);
	const lockBase = lockBaseOf(root);
	fs.mkdirSync(lockBase, { recursive: true });

	// 同時に足されても重ならないよう、課題と同じ予約 (_lock/<id>/) を取る
	for (let n = maxNumber(root, o.parent) + 1, tries = 0; tries < 1000; n++, tries++) {
		const id = `${o.parent}-d${n}`;
		if (hasFileWithId(root, id)) continue;
		const lock = path.join(lockBase, id);
		if (!acquire(lock)) continue;
		try {
			if (hasFileWithId(root, id)) continue;
			const lines = ['schema: 1', `id: ${id}`, `title: ${title}`, `parent: ${o.parent}`, `decided: ${today}`, `chosen: ${o.chosen}`];
			if (refs !== undefined) lines.push(`refs: ${refs}`);
			if (replaces !== undefined) lines.push(`replaces: ${replaces}`);
			if (legacy !== undefined) lines.push(`legacy_ids: ${legacy}`);
			let body = '\n## 案\n\n' + options.map((text, i) => `- ${Letters[i]}: ${text}`).join('\n') + '\n';
			if (o.body !== undefined) body += '\n' + o.body.replace(/\r\n?/g, '\n').replace(/\n+$/, '') + '\n';
			const name = `${id}-${slug}.md`;
			fs.mkdirSync(dir, { recursive: true });
			fs.writeFileSync(path.join(dir, name), '---\n' + lines.join('\n') + '\n---\n' + body, { flag: 'wx' });
			return { id, rel: `${DecisionsRel}/${name}` };
		} finally {
			release(lock);
		}
	}
	throw new Failure(`${o.parent} の決定の番号を取れなかった`);
}

export type DecisionView = {
	id: string;
	file: string;
	meta: Record<string, string>;
	options: { key: string; text: string }[];
	body: string;
	text: string;
};

function readDecision(root: string, name: string): DecisionView | null {
	const m = DecisionNamePattern.exec(name);
	if (m === null) return null;
	const raw = fs.readFileSync(path.join(decisionsDirOf(root), name), 'utf8');
	const text = raw.replace(/^﻿/, '').replace(/\r\n?/g, '\n');
	const parts = splitIssue(text);
	if (parts.broken) return null;
	const meta: Record<string, string> = {};
	for (const p of parts.parsed.pairs) meta[p.key] = p.value;
	const options: { key: string; text: string }[] = [];
	for (const line of parts.body.split('\n')) {
		const o = OptionLine.exec(line);
		if (o !== null) options.push({ key: o[1], text: o[2] });
	}
	return { id: m[1], file: `${DecisionsRel}/${name}`, meta, options, body: parts.body, text };
}

/** 決定の id の並べ方: 親の番号 (課題と同じ順) → 連番の数 */
function compareDecision(a: string, b: string): number {
	const ma = DecisionIdPattern.exec(a);
	const mb = DecisionIdPattern.exec(b);
	if (ma === null || mb === null) return a < b ? -1 : a > b ? 1 : 0;
	if (ma[1] !== mb[1]) {
		if (ma[1][0] !== mb[1][0]) return ma[1][0] < mb[1][0] ? -1 : 1;
		return compareId(ma[1], mb[1]);
	}
	return Number(ma[2]) - Number(mb[2]);
}

export type DecisionItem = { id: string; parent: string; title: string; chosen: string; decided: string; file: string };

/** 決定の一覧。読めないものは飛ばし、warn で知らせる */
export function listDecisions(root: string, parent: string | null, warn: (message: string) => void): DecisionItem[] {
	const items: DecisionItem[] = [];
	for (const name of listMdNames(decisionsDirOf(root))) {
		const v = readDecision(root, name);
		if (v === null) {
			warn(`[警告] ${DecisionsRel}/${name} を読めない (issue check で確かめる)`);
			continue;
		}
		const p = DecisionIdPattern.exec(v.id)?.[1] ?? '';
		if (parent !== null && p !== parent) continue;
		items.push({ id: v.id, parent: p, title: v.meta.title ?? '', chosen: v.meta.chosen ?? '', decided: v.meta.decided ?? '', file: v.file });
	}
	return items.sort((a, b) => compareDecision(a.id, b.id));
}

/** 決定を全部読む (id の順)。読めないものは飛ばし、warn で知らせる。render が使う */
export function loadDecisions(root: string, warn: (message: string) => void): DecisionView[] {
	const views: DecisionView[] = [];
	for (const name of listMdNames(decisionsDirOf(root))) {
		const v = readDecision(root, name);
		if (v === null) {
			warn(`[警告] ${DecisionsRel}/${name} を読めない (issue check で確かめる)`);
			continue;
		}
		views.push(v);
	}
	return views.sort((a, b) => compareDecision(a.id, b.id));
}

/** 決定の本文から語を探す (196-A)。大小を区別しない。親の課題の状態によらず全部を探す */
export function searchDecisions(root: string, term: string): { kind: 'decision'; id: string; parent: string; title: string; file: string; matches: { line: number; text: string }[] }[] {
	const needle = term.toLowerCase();
	const hits: { kind: 'decision'; id: string; parent: string; title: string; file: string; matches: { line: number; text: string }[] }[] = [];
	for (const d of loadDecisions(root, () => {})) {
		const matches: { line: number; text: string }[] = [];
		d.text.split('\n').forEach((line, index) => {
			if (line.toLowerCase().includes(needle)) matches.push({ line: index + 1, text: [...line.trim()].slice(0, 120).join('') });
		});
		if (matches.length > 0) hits.push({ kind: 'decision', id: d.id, parent: DecisionIdPattern.exec(d.id)?.[1] ?? '', title: d.meta.title ?? '', file: d.file, matches });
	}
	return hits;
}

/** 決定を 1 件読む */
export function showDecision(root: string, id: string): DecisionView {
	const found = listMdNames(decisionsDirOf(root)).filter((n) => n.startsWith(id + '-') && DecisionNamePattern.exec(n)?.[1] === id);
	if (found.length === 0) throw new Failure(`${id} の決定が見つからない`);
	if (found.length > 1) throw new Failure(`${id} のファイルが複数ある: ${found.join(' ・ ')} (issue check で確かめる)`);
	const v = readDecision(root, found[0]);
	if (v === null) throw new Failure(`${id} の決定を読めない (issue check で確かめる)`);
	return v;
}
