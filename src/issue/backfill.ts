/*
	issue backfill-done: 既にある済の課題 (done/ ・ archived/) の done を、git の履歴から埋める。
	課題 i261120-01 の決定 281-A。
	- 済になった日時は、課題のファイルが done/ ・ archived/ に最初に現れた commit の日時 (JST)。set --state 済 を流した時刻の近似
	- 一度に BulkMin 件以上が、無かったところから done/ ・ archived/ に現れた commit は、移行 (issues.html からの migrate 等) とみなして飛ばす。
	  移した日は、済にした日ではないため。--skip-commit で commit を名指しでも飛ばせる
	- 履歴に無い課題 (未追跡 ・ 名前を変えた) は飛ばす。started は埋めない
	- 書いたあとに読み戻して確かめ、だめなら書いた分をすべて元に戻す
*/
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { ItemsRel } from './check.ts';
import { splitIssue } from './meta.ts';
import { Failure, loadAll, setFields, writeText } from './ops.ts';

/** 一度にこの件数以上が、無かったところから済のフォルダに現れた commit は、移行とみなす */
export const BulkMin = 10;

export type BackfillItem = { id: string; done: string; commit: string; file: string };
export type BackfillSkip = { id: string; reason: string };
export type BackfillPlan = { plan: BackfillItem[]; skipped: BackfillSkip[] };

type Appeared = { commit: string; date: string; added: boolean };

/** commit の日時 (ISO 8601、時差つき) を JST の yyyy-mm-dd hh:mm にする */
export function jstOf(iso: string): string {
	return new Date(new Date(iso).getTime() + 9 * 3600 * 1000).toISOString().slice(0, 16).replace('T', ' ');
}

/** 履歴から、課題の名前ごとに、done/ ・ archived/ に最初に現れた commit と、commit ごとの「無かったところから現れた件数」を読む */
function readHistory(root: string): { first: Map<string, Appeared>; addedBy: Map<string, number> } {
	const r = spawnSync('git', ['-c', 'core.quotepath=false', 'log', '--reverse', '-M', '--relative', '--name-status', '--format=%x01%H%x09%cI', '--', ItemsRel], {
		cwd: root, encoding: 'utf8', timeout: 120000, maxBuffer: 256 * 1024 * 1024,
	});
	if (r.status !== 0) throw new Failure(`git log に失敗した: ${(r.stderr ?? '').trim().split('\n')[0]} (git の管理下で流す)`);
	const first = new Map<string, Appeared>();
	const addedBy = new Map<string, number>();
	const re = new RegExp(`^${ItemsRel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/(done|archived)/([^/]+\\.md)$`);
	let commit = '';
	let date = '';
	for (const line of (r.stdout ?? '').split('\n')) {
		if (line.startsWith('\x01')) {
			[commit, date] = line.slice(1).split('\t');
			continue;
		}
		const cols = line.split('\t');
		if (cols.length < 2) continue;
		const status = cols[0][0];
		if (status !== 'A' && status !== 'R' && status !== 'C') continue;
		const to = cols[cols.length - 1];
		const m = re.exec(to);
		if (m === null) continue;
		const added = status === 'A';
		if (added) addedBy.set(commit, (addedBy.get(commit) ?? 0) + 1);
		if (!first.has(m[2])) first.set(m[2], { commit, date, added });
	}
	return { first, addedBy };
}

/** done の無い済の課題ごとに、書く値を決める。書かない課題は、理由つきで skipped に入れる */
export function planBackfill(root: string, skipCommits: string[]): BackfillPlan {
	const { members, unreadable } = loadAll(root, ['done', 'archived']);
	if (unreadable.length > 0) throw new Failure(`メタ情報を読めない課題がある: ${unreadable.join(' ・ ')} (issue check で確かめる)`);
	const { first, addedBy } = readHistory(root);
	const plan: BackfillItem[] = [];
	const skipped: BackfillSkip[] = [];
	for (const m of members) {
		const parts = splitIssue(m.text);
		if (!parts.broken && parts.parsed.pairs.some((p) => p.key === 'done')) continue;
		const at = first.get(m.name);
		if (at === undefined) { skipped.push({ id: m.id, reason: '履歴に無い (未追跡か、commit 前か、名前を変えた)' }); continue; }
		const bulk = at.added ? (addedBy.get(at.commit) ?? 0) : 0;
		if (bulk >= BulkMin) { skipped.push({ id: m.id, reason: `一度に ${bulk} 件が現れた commit ${at.commit.slice(0, 7)} (移行とみなす。済にした日ではない)` }); continue; }
		if (skipCommits.some((s) => s !== '' && at.commit.startsWith(s))) { skipped.push({ id: m.id, reason: `--skip-commit で指定された commit ${at.commit.slice(0, 7)}` }); continue; }
		const done = jstOf(at.date);
		try {
			setFields(root, m.id, { done }, true);
		} catch (e) {
			if (!(e instanceof Failure)) throw e;
			skipped.push({ id: m.id, reason: `書き換えられない: ${e.message}` });
			continue;
		}
		plan.push({ id: m.id, done, commit: at.commit.slice(0, 7), file: `${ItemsRel}/${m.folder}/${m.name}` });
	}
	plan.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
	return { plan, skipped };
}

/** plan を書く。書いたあとに読み戻して確かめ、だめなら書いた分をすべて元に戻して Failure */
export function applyBackfill(root: string, plan: BackfillItem[]): void {
	const originals = new Map<string, string>();
	const restore = (): void => {
		for (const [file, text] of originals) writeText(path.join(root, ...file.split('/')), text);
	};
	try {
		for (const item of plan) {
			const abs = path.join(root, ...item.file.split('/'));
			originals.set(item.file, fs.readFileSync(abs, 'utf8'));
			setFields(root, item.id, { done: item.done });
		}
		for (const item of plan) {
			const parts = splitIssue(fs.readFileSync(path.join(root, ...item.file.split('/')), 'utf8'));
			const before = splitIssue(originals.get(item.file) ?? '');
			const ok = !parts.broken && parts.parsed.pairs.find((p) => p.key === 'done')?.value === item.done && parts.parsed.problems.length <= before.parsed.problems.length;
			if (!ok) throw new Failure(`${item.id} の done を読み戻せない (書いた分を元に戻した)`);
		}
	} catch (e) {
		restore();
		throw e;
	}
}
