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

/** isNew: それまでに無かった名前が、この commit で新しく現れた (移行の判定に数える) */
type Appeared = { commit: string; date: string; isNew: boolean };

/** commit の日時 (ISO 8601、時差つき) を JST の yyyy-mm-dd hh:mm にする */
export function jstOf(iso: string): string {
	return new Date(new Date(iso).getTime() + 9 * 3600 * 1000).toISOString().slice(0, 16).replace('T', ' ');
}

/**
 * 履歴から、課題の名前ごとに、済のフォルダ (done/ ・ archived/) に最後に入った commit を読む。
 * 済から未・着手へ戻し、また済にしたなら、入り直した commit。done/ → archived/ の移動は、入り直しに数えない。
 * 日時は author の日時 (committer の日時は、rebase ・ amend ・ cherry-pick で変わる)。
 * addedBy は、commit ごとの「それまでに無かった名前が、新しく済に入った件数」(移行の判定に使う)。
 * 名前の変更として検出されなかった移動 (中身が大きく変わった) も、前の commit に同じ名前があれば、新しいものに数えない
 */
function readHistory(root: string): { last: Map<string, Appeared>; addedBy: Map<string, number> } {
	const r = spawnSync('git', ['-c', 'core.quotepath=false', 'log', '--reverse', '-M', '--relative', '--name-status', '--format=%x01%H%x09%aI', '--', ItemsRel], {
		cwd: root, encoding: 'utf8', timeout: 120000, maxBuffer: 256 * 1024 * 1024,
	});
	if (r.status !== 0) throw new Failure(`git log に失敗した: ${(r.stderr ?? '').trim().split('\n')[0]} (git の管理下で流す)`);
	const last = new Map<string, Appeared>();
	const addedBy = new Map<string, number>();
	const seen = new Set<string>();
	const re = new RegExp(`^${ItemsRel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/(todo|doing|done|archived)/([^/]+\\.md)$`);
	const flush = (commit: string, date: string, lines: string[][]): void => {
		const deleted = new Set<string>();
		for (const cols of lines) {
			if (cols[0][0] !== 'D') continue;
			const m = re.exec(cols[1]);
			if (m !== null) deleted.add(m[2]);
		}
		for (const cols of lines) {
			const status = cols[0][0];
			if (status !== 'A' && status !== 'R' && status !== 'C') continue;
			const to = re.exec(cols[cols.length - 1]);
			if (to === null) continue;
			const name = to[2];
			const toDone = to[1] === 'done' || to[1] === 'archived';
			const from = status === 'R' ? re.exec(cols[1]) : null;
			const fromDone = from !== null && (from[1] === 'done' || from[1] === 'archived');
			if (toDone && !fromDone) {
				const isNew = status === 'A' && !seen.has(name) && !deleted.has(name);
				last.set(name, { commit, date, isNew });
				if (isNew) addedBy.set(commit, (addedBy.get(commit) ?? 0) + 1);
			}
		}
		for (const cols of lines) {
			const to = re.exec(cols[cols.length - 1]);
			if (to !== null && cols[0][0] !== 'D') seen.add(to[2]);
		}
	};
	let commit = '';
	let date = '';
	let lines: string[][] = [];
	for (const line of (r.stdout ?? '').split('\n')) {
		if (line.startsWith('\x01')) {
			if (commit !== '') flush(commit, date, lines);
			[commit, date] = line.slice(1).split('\t');
			lines = [];
			continue;
		}
		const cols = line.split('\t');
		if (cols.length >= 2) lines.push(cols);
	}
	if (commit !== '') flush(commit, date, lines);
	return { last, addedBy };
}

/** done の無い済の課題ごとに、書く値を決める。書かない課題は、理由つきで skipped に入れる */
export function planBackfill(root: string, skipCommits: string[]): BackfillPlan {
	const { members, unreadable } = loadAll(root, ['done', 'archived']);
	if (unreadable.length > 0) throw new Failure(`メタ情報を読めない課題がある: ${unreadable.join(' ・ ')} (issue check で確かめる)`);
	const { last, addedBy } = readHistory(root);
	const plan: BackfillItem[] = [];
	const skipped: BackfillSkip[] = [];
	for (const m of members) {
		const parts = splitIssue(m.text);
		if (!parts.broken && parts.parsed.pairs.some((p) => p.key === 'done')) continue;
		const at = last.get(m.name);
		if (at === undefined) { skipped.push({ id: m.id, reason: '履歴に無い (未追跡か、commit 前か、名前を変えた)' }); continue; }
		const bulk = at.isNew ? (addedBy.get(at.commit) ?? 0) : 0;
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
	// 戻せなかった課題は、メッセージに並べる (一部だけ done が残ったことを、知らせるため)
	const restore = (): string[] => {
		const failed: string[] = [];
		for (const [file, text] of originals) {
			try { writeText(path.join(root, ...file.split('/')), text); } catch { failed.push(file); }
		}
		return failed;
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
		const failed = restore();
		if (failed.length > 0) throw new Failure(`${(e as Error).message} / 元に戻せなかった課題 (done が残っている。issue set <id> --done "" で消す): ${failed.join(' ・ ')}`);
		throw e;
	}
}
