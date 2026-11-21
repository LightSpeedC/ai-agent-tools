/*
	issue stats: 日別の集計 (立てた ・ 着手にした ・ 済にした ・ 残り)。課題 i261120-01 の決定 283-A。
	状態の履歴は持たない。課題ファイルの created ・ started ・ done の日付だけから数える。
	残りは、その日の終わりに「立てた日 <= その日 かつ (done が無い か done の日付 > その日)」の数。
	済から戻した課題は、今の状態 (done が消えている) で数える近似になる。
	done の無い済 (移行 commit の課題等) は、残りに数えない (決定 286-A。283-A を置き換える)。済にした日が分からないため、
	それより前の日の残りは、実際より少なめに出る。件数は undatedDone。
*/
import { Failure, UsageError, loadAll, todayJst } from './ops.ts';
import { isRealDateTime, splitIssue } from './meta.ts';

export type StatsDay = { date: string; created: number; started: number; done: number; remaining: number };
export type StatsResult = {
	since: string;
	until: string;
	days: StatsDay[];
	/** 済 (done/ ・ archived/) なのに done が無い課題の数。残りに数えない (済にした日が分からないため。その前の日の残りは少なめになる) */
	undatedDone: number;
};

/** yyyy-mm-dd として実在する日付か */
export function isRealDay(text: string): boolean {
	const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
	if (m === null) return false;
	const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
	return d.getUTCFullYear() === Number(m[1]) && d.getUTCMonth() === Number(m[2]) - 1 && d.getUTCDate() === Number(m[3]);
}

function addDay(day: string, n: number): string {
	const d = new Date(day + 'T00:00:00Z');
	d.setUTCDate(d.getUTCDate() + n);
	return d.toISOString().slice(0, 10);
}

/** undated: 済 (done/ ・ archived/) なのに done が無い (済にした日が分からない。残りに数えない。決定 286-A) */
type Row = { created: string | null; started: string | null; done: string | null; undated: boolean };

/** since ・ until は yyyy-mm-dd。null なら、既定 (いちばん古い日付 ・ 今日) */
export function computeStats(root: string, since: string | null, until: string | null): StatsResult {
	const { members, unreadable } = loadAll(root, ['todo', 'doing', 'done', 'archived']);
	if (unreadable.length > 0) throw new Failure(`メタ情報を読めない課題があり、集計できない: ${unreadable.join(' ・ ')} (issue check で確かめる)`);
	const rows: Row[] = [];
	let undatedDone = 0;
	for (const m of members) {
		const parts = splitIssue(m.text);
		const get = (k: string): string | undefined => parts.broken ? undefined : parts.parsed.pairs.find((p) => p.key === k)?.value;
		const created = get('created');
		const started = get('started');
		const done = get('done');
		// 済ではない課題 (todo/ ・ doing/) に残った done は、無いものとして数える (済から戻した課題を、済に数えない。check が警告する)
		const isDone = m.folder === 'done' || m.folder === 'archived';
		const row: Row = {
			created: created !== undefined && isRealDay(created) ? created : null,
			started: started !== undefined && isRealDateTime(started) ? started.slice(0, 10) : null,
			done: isDone && done !== undefined && isRealDateTime(done) ? done.slice(0, 10) : null,
			undated: false,
		};
		if (isDone && row.done === null) { row.undated = true; undatedDone++; }
		rows.push(row);
	}
	const end = until ?? todayJst();
	let begin = since;
	if (begin === null) {
		const all = rows.flatMap((r) => [r.created, r.started, r.done]).filter((d): d is string => d !== null);
		begin = all.length === 0 ? end : all.reduce((a, b) => (a < b ? a : b));
		if (begin > end) begin = end;
	}
	if (begin > end) throw new UsageError(`--since (${begin}) が --until (${end}) より後`);
	const days: StatsDay[] = [];
	for (let day = begin; day <= end; day = addDay(day, 1)) {
		let created = 0;
		let started = 0;
		let done = 0;
		let remaining = 0;
		for (const r of rows) {
			if (r.created === day) created++;
			if (r.started === day) started++;
			if (r.done === day) done++;
			if (r.undated) continue;
			if (r.created !== null && r.created <= day && (r.done === null || r.done > day)) remaining++;
		}
		days.push({ date: day, created, started, done, remaining });
	}
	return { since: begin, until: end, days, undatedDone };
}
