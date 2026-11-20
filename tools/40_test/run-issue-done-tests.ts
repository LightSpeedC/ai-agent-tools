/*
	issue (課題管理ツール) の「済にした日 (done) ・ 着手にした日 (started)」のテスト (課題 i261120-01。決定 278-A 〜 285-A)。
	set の書き込み ・ set --done / --started ・ check ・ archive --done-before ・ stats ・ backfill-done。
	期待値は、課題と決定から先に手で書いた (実装の出力から作っていない)。
	本物のプロジェクトには触らない。tmp/ の下に、ケースごとの小さなプロジェクトを作る。
	時刻は環境変数 ISSUE_TEST_NOW (yyyy-mm-dd hh:mm、JST) で固定する。
*/
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..', '..');
const work = path.join(root, 'tmp', 'issue-done-tests');
const main = path.join(root, 'src', 'issue', 'main.ts');

let pass = 0;
let fail = 0;
function check(name: string, ok: boolean, detail: string = ''): void {
	if (ok) { pass++; console.log('  ✅ [OK] ' + name); }
	else { fail++; console.log('  ❌ [NG] ' + name + (detail ? '  ' + detail : '')); }
}

const Items = 'notes/40_issues/items/';
const Todo = Items + 'todo/';
const Doing = Items + 'doing/';
const Done = Items + 'done/';
const Archived = Items + 'archived/';
const A = 'i261103-01-a.md';
const Now1 = '2026-11-20 10:30';
const Now2 = '2026-11-21 08:05';

const KeyOrder = ['schema', 'id', 'title', 'group', 'created', 'started', 'done', 'from', 'confirmed', 'refs', 'version', 'released', 'kind', 'note'];
function issueText(over: Record<string, string | null> = {}, body: string = '\n本文\n'): string {
	const all: Record<string, string | null> = { schema: '1', id: 'i261103-01', title: '題', group: 'html2md', created: '2026-11-03', ...over };
	const keys = [...KeyOrder.filter((k) => k in all), ...Object.keys(all).filter((k) => !KeyOrder.includes(k))];
	return '---\n' + keys.filter((k) => all[k] !== null).map((k) => k + ': ' + all[k]).join('\n') + '\n---\n' + body;
}

function std(name: string, files: Record<string, string> = {}): string {
	const dir = path.join(work, name);
	fs.rmSync(dir, { recursive: true, force: true });
	fs.mkdirSync(dir, { recursive: true });
	const all = { [Items + 'project-uuid.txt']: `schema: 2\nproject_uuid: 7b0c4e1a9f3d4a62b8d51c2e6f90a3b7\nproject_id: ${name}\n`, ...files };
	for (const [rel, text] of Object.entries(all)) {
		const full = path.join(dir, rel);
		fs.mkdirSync(path.dirname(full), { recursive: true });
		fs.writeFileSync(full, text);
	}
	return dir;
}

type Result = { code: number; out: string; err: string };
function run(args: string[], dir: string, env: Record<string, string> = {}): Result {
	const r = spawnSync(process.execPath, [main, ...args, '--root', dir], { cwd: dir, env: { ...process.env, ISSUE_TEST_TODAY: '2026-11-20', ISSUE_TEST_NOW: Now1, ...env } as Record<string, string>, encoding: 'utf8', timeout: 60000 });
	return { code: r.status ?? -1, out: (r.stdout ?? '').trim(), err: (r.stderr ?? '').trim() };
}
const GitEnv = { GIT_AUTHOR_NAME: 'tester', GIT_AUTHOR_EMAIL: 'tester@example.com', GIT_COMMITTER_NAME: 'tester', GIT_COMMITTER_EMAIL: 'tester@example.com' };
function git(dir: string, args: string[], env: Record<string, string> = {}): string {
	const r = spawnSync('git', ['-c', 'core.quotepath=false', ...args], { cwd: dir, env: { ...process.env, ...GitEnv, ...env } as Record<string, string>, encoding: 'utf8', timeout: 60000 });
	return (r.stdout ?? '').trim();
}
function read(dir: string, rel: string): string {
	try { return fs.readFileSync(path.join(dir, rel), 'utf8'); } catch { return ''; }
}
function exists(dir: string, rel: string): boolean { return fs.existsSync(path.join(dir, rel)); }

// ---- set --state で started ・ done を書く (決定 278-A ・ 279-A ・ 282-A) ----

console.log('--- set --state で started ・ done を書く');
{
	const dir = std('set-flow', { [Todo + A]: issueText() });
	const r1 = run(['set', 'i261103-01', '--state', '着手'], dir);
	check('未 → 着手: started を JST の yyyy-mm-dd hh:mm で書く (created の後ろ)', r1.code === 0 && read(dir, Doing + A) === issueText({ started: Now1 }), r1.out + r1.err + '\n' + read(dir, Doing + A));
	const r2 = run(['set', 'i261103-01', '--state', '済'], dir, { ISSUE_TEST_NOW: Now2 });
	check('着手 → 済: done を書く。started は残る', r2.code === 0 && read(dir, Done + A) === issueText({ started: Now1, done: Now2 }), r2.out + r2.err + '\n' + read(dir, Done + A));
	const r3 = run(['set', 'i261103-01', '--state', '済'], dir, { ISSUE_TEST_NOW: '2026-11-25 09:00' });
	check('済 → 済: done を上書きしない (動かさない)', r3.code === 0 && read(dir, Done + A) === issueText({ started: Now1, done: Now2 }), r3.out + r3.err);
	const r4 = run(['set', 'i261103-01', '--state', '着手'], dir, { ISSUE_TEST_NOW: '2026-11-26 09:00' });
	check('済 → 着手: done を消す。started は最初の着手日のまま残る (上書きしない)', r4.code === 0 && read(dir, Doing + A) === issueText({ started: Now1 }), r4.out + r4.err + '\n' + read(dir, Doing + A));
	const r5 = run(['set', 'i261103-01', '--state', '未'], dir);
	check('着手 → 未: started を変えない', r5.code === 0 && read(dir, Todo + A) === issueText({ started: Now1 }), r5.out + r5.err);
	const r6 = run(['set', 'i261103-01', '--state', '済'], dir, { ISSUE_TEST_NOW: Now2 });
	check('未 → 済 (直接): done だけ書く。started は残る', r6.code === 0 && read(dir, Done + A) === issueText({ started: Now1, done: Now2 }), r6.out + r6.err);
	const r7 = run(['set', 'i261103-01', '--state', '未'], dir);
	check('済 → 未: done を消す。started は残る', r7.code === 0 && read(dir, Todo + A) === issueText({ started: Now1 }), r7.out + r7.err);
}
{
	const dir = std('set-direct', { [Todo + A]: issueText() });
	const r = run(['set', 'i261103-01', '--state', '済'], dir);
	check('started の無い課題を未 → 済: done だけ書き、started は作らない', r.code === 0 && read(dir, Done + A) === issueText({ done: Now1 }), r.out + r.err + '\n' + read(dir, Done + A));
}
{
	const dir = std('set-none', { [Doing + A]: issueText({ started: '2026-11-10 09:00' }) });
	const r = run(['set', 'i261103-01', '--state', '着手'], dir);
	check('すでに着手なら動かさず、started も変えない', r.code === 0 && read(dir, Doing + A) === issueText({ started: '2026-11-10 09:00' }), r.out + r.err);
}
{
	// 済にできない課題 (やることが残る) は、何も書かない
	const body = '\n本文\n\n## やること\n- [未] a\n';
	const dir = std('set-blocked', { [Doing + A]: issueText({}, body) });
	const r = run(['set', 'i261103-01', '--state', '済'], dir);
	check('やることが残って済にできなければ、終了コード 1 で、done を書かない', r.code === 1 && read(dir, Doing + A) === issueText({}, body) && !exists(dir, Done + A), r.out + r.err);
}
{
	// BOM のあるファイルは書き換えない。状態は動かし、警告を出す (今ある動き: 動かすだけの set を失敗させない)
	const dir = std('set-bom', { [Todo + A]: '﻿' + issueText() });
	const r = run(['set', 'i261103-01', '--state', '済'], dir);
	check('BOM のあるファイルは、状態を動かし、done は書かず、警告を出す', r.code === 0 && read(dir, Done + A) === '﻿' + issueText() && (r.err + r.out).includes('done'), r.out + r.err);
}
{
	// --state 済 と --done を一緒に: 指定した値が勝つ
	const dir = std('set-explicit', { [Todo + A]: issueText() });
	const r = run(['set', 'i261103-01', '--state', '済', '--done', '2026-11-18 17:45'], dir);
	check('--state 済 と --done を一緒に渡せば、--done の値が書かれる', r.code === 0 && read(dir, Done + A) === issueText({ done: '2026-11-18 17:45' }), r.out + r.err + '\n' + read(dir, Done + A));
}
{
	// git の管理下: 動かしたあとの状態 (rename は stage 済、done の書き込みは stage 前)
	const dir = std('set-git', { [Doing + A]: issueText({ started: '2026-11-10 09:00' }) });
	git(dir, ['init', '-q', '-b', 'develop']);
	git(dir, ['add', '-A']);
	git(dir, ['commit', '-q', '-m', 'init']);
	const r = run(['set', 'i261103-01', '--state', '済'], dir);
	const status = git(dir, ['status', '--porcelain']);
	check('git の管理下: rename は stage 済で、done の書き込みは stage 前 (RM)', r.code === 0 && /^RM .*doing\/i261103-01-a\.md -> .*done\/i261103-01-a\.md$/m.test(status), r.out + r.err + ' / ' + status);
}

// ---- set --done / --started (決定 285-A) ----

console.log('--- set --done / --started');
{
	const dir = std('fields', { [Done + A]: issueText({ done: Now1 }) });
	const r1 = run(['set', 'i261103-01', '--done', '2026-11-18 17:45', '--started', '2026-11-17 09:00'], dir);
	check('--done と --started を書ける (鍵の順: created → started → done)', r1.code === 0 && read(dir, Done + A) === issueText({ started: '2026-11-17 09:00', done: '2026-11-18 17:45' }), r1.out + r1.err + '\n' + read(dir, Done + A));
	const r2 = run(['set', 'i261103-01', '--done', '', '--started', ''], dir);
	check('値が空なら鍵を消す', r2.code === 0 && read(dir, Done + A) === issueText(), r2.out + r2.err + '\n' + read(dir, Done + A));
	const before = read(dir, Done + A);
	check('done が yyyy-mm-dd だけなら終了コード 5 (書かない)', run(['set', 'i261103-01', '--done', '2026-11-18'], dir).code === 5 && read(dir, Done + A) === before);
	check('started が実在しない日時なら終了コード 5', run(['set', 'i261103-01', '--started', '2026-02-30 10:00'], dir).code === 5);
	check('done に改行を含めれば終了コード 5', run(['set', 'i261103-01', '--done', '2026-11-18 10:00\n2'], dir).code === 5);
}
{
	// archived/ の課題にも書ける (移行で埋められなかった分を手で直す)
	const dir = std('fields-archived', { [Archived + A]: issueText() });
	const r = run(['set', 'i261103-01', '--done', '2026-11-08 12:00'], dir);
	check('archived/ の課題にも --done を書ける', r.code === 0 && read(dir, Archived + A) === issueText({ done: '2026-11-08 12:00' }), r.out + r.err);
}

// ---- archive ・ unarchive は done を書かず変えない (今ある動き) ----

console.log('--- archive ・ unarchive');
{
	const dir = std('archive-keep', { [Done + A]: issueText({ done: Now1 }), [Done + 'i261103-02-b.md']: issueText({ id: 'i261103-02' }) });
	const r1 = run(['archive', 'html2md'], dir);
	check('archive は、done を変えず、無い課題にも書かない', r1.code === 0 && read(dir, Archived + A) === issueText({ done: Now1 }) && read(dir, Archived + 'i261103-02-b.md') === issueText({ id: 'i261103-02' }), r1.out + r1.err);
	const r2 = run(['unarchive', 'html2md'], dir, { ISSUE_TEST_NOW: Now2 });
	check('unarchive は、done を変えず、無い課題にも書かない', r2.code === 0 && read(dir, Done + A) === issueText({ done: Now1 }) && read(dir, Done + 'i261103-02-b.md') === issueText({ id: 'i261103-02' }), r2.out + r2.err);
}

// ---- check (決定 284-A) ----

console.log('--- check');
{
	const dir = std('check-ok', { [Done + A]: issueText({ started: '2026-11-04 09:00', done: '2026-11-05 10:00' }) });
	const r = run(['check'], dir);
	check('正しい started ・ done は、エラーも警告も出ない', r.code === 0 && !r.out.includes('[警告]') && !r.out.includes('[meta]'), r.out + r.err);
}
{
	const dir = std('check-bad-form', { [Done + A]: issueText({ done: '2026-11-05' }), [Done + 'i261103-02-b.md']: issueText({ id: 'i261103-02', started: '2026-02-30 10:00' }) });
	const r = run(['check'], dir);
	check('done が yyyy-mm-dd だけ ・ started が実在しない日時は、エラー (終了コード 1)', r.code === 1 && r.out.includes('done') && r.out.includes('started'), r.out + r.err);
}
{
	const dir = std('check-folder', { [Todo + A]: issueText({ done: '2026-11-05 10:00' }) });
	const r = run(['check'], dir);
	check('done/ ・ archived/ 以外にある課題が done を持てば、警告 (終了コード 0)', r.code === 0 && r.out.includes('done') && r.out.includes('[警告]'), r.out + r.err);
}
{
	const dir = std('check-before-created', { [Done + A]: issueText({ started: '2026-11-02 09:00', done: '2026-11-01 10:00' }) });
	const r = run(['check'], dir);
	check('done や started が created より前なら、警告 (終了コード 0)', r.code === 0 && r.out.includes('created') && (r.out.match(/\[警告\]/g) ?? []).length >= 2, r.out + r.err);
}
{
	const dir = std('check-same-day', { [Done + A]: issueText({ started: '2026-11-03 00:00', done: '2026-11-03 00:01' }) });
	const r = run(['check'], dir);
	check('created と同じ日なら警告を出さない', r.code === 0 && !r.out.includes('[警告]'), r.out + r.err);
}

// ---- archive --done-before (決定 280-B) ----

console.log('--- archive --done-before');
{
	const dir = std('before', {
		// done があれば done で選ぶ: 立てたのは前でも、済にしたのが 11-10 なら、11-05 より前ではない
		[Done + 'i261001-01-old-created.md']: issueText({ id: 'i261001-01', created: '2026-10-01', done: '2026-11-10 09:00' }),
		// 立てたのは後でも、済にしたのが 11-01 なら動かす
		[Done + 'i261110-01-new-created.md']: issueText({ id: 'i261110-01', created: '2026-11-10', done: '2026-11-11 09:00' }).replace('2026-11-11 09:00', '2026-11-10 09:00'),
		// done が無ければ created で選ぶ (今までと同じ)
		[Done + 'i261101-01-no-done-old.md']: issueText({ id: 'i261101-01', created: '2026-11-01' }),
		[Done + 'i261108-01-no-done-new.md']: issueText({ id: 'i261108-01', created: '2026-11-08' }),
		// 立てた日と済にした日が逆 (check は警告) でも、done で選ぶ
		[Done + 'i261120-01-reversed.md']: issueText({ id: 'i261120-01', created: '2026-11-20', done: '2026-11-01 09:00' }),
	});
	const r = run(['archive', '--done-before', '2026-11-05', '--json'], dir);
	let p: { moved?: string[] } = {};
	try { p = JSON.parse(r.out); } catch { /* 下で失敗にする */ }
	check('done があれば done で、無ければ created で選ぶ', JSON.stringify(p.moved) === JSON.stringify(['i261101-01', 'i261120-01']), r.out + r.err);
	const edge = run(['archive', '--done-before', '2026-11-10', '--dry-run', '--json'], dir);
	check('境界: done の日が before と同じ日なら動かさない (before より前だけ)', !edge.out.includes('i261110-01') && !edge.out.includes('i261001-01'), edge.out);
}

// ---- stats (決定 283-A) ----

console.log('--- stats');
{
	const dir = std('stats', {
		[Done + 'i261101-01-a.md']: issueText({ id: 'i261101-01', created: '2026-11-01', started: '2026-11-02 09:00', done: '2026-11-04 18:00' }),
		[Todo + 'i261101-02-b.md']: issueText({ id: 'i261101-02', created: '2026-11-01' }),
		[Done + 'i261103-01-c.md']: issueText({ id: 'i261103-01', created: '2026-11-03', done: '2026-11-03 12:00' }),
		[Archived + 'i261102-01-d.md']: issueText({ id: 'i261102-01', created: '2026-11-02' }),
	});
	const r = run(['stats', '--since', '2026-11-01', '--until', '2026-11-05', '--json'], dir);
	let p: { since?: string; until?: string; days?: { date: string; created: number; started: number; done: number; remaining: number }[]; undatedDone?: number } = {};
	try { p = JSON.parse(r.out); } catch { /* 下で失敗にする */ }
	const row = (d: string): string => { const x = p.days?.find((v) => v.date === d); return x === undefined ? 'なし' : `${x.created},${x.started},${x.done},${x.remaining}`; };
	check('範囲は since から until まで、1 日 1 行 (5 行)', p.since === '2026-11-01' && p.until === '2026-11-05' && p.days?.length === 5, r.out + r.err);
	check('11-01: 立てた 2 ・ 着手 0 ・ 済 0 ・ 残り 2', row('2026-11-01') === '2,0,0,2', row('2026-11-01'));
	check('11-02: 立てた 1 ・ 着手 1 ・ 済 0 ・ 残り 3 (done の無い済は残りに数える)', row('2026-11-02') === '1,1,0,3', row('2026-11-02'));
	check('11-03: 立てた 1 ・ 済 1 ・ 残り 3 (同じ日に立てて済にした課題は、その日の終わりには残らない)', row('2026-11-03') === '1,0,1,3', row('2026-11-03'));
	check('11-04: 済 1 ・ 残り 2', row('2026-11-04') === '0,0,1,2', row('2026-11-04'));
	check('11-05: 残り 2', row('2026-11-05') === '0,0,0,2', row('2026-11-05'));
	check('done が無いのに済 (done/ ・ archived/) の課題の数を undatedDone に出す (1 件: i261102-01)', p.undatedDone === 1, r.out);
	const t = run(['stats', '--since', '2026-11-02', '--until', '2026-11-03'], dir);
	check('テキストは、日付 ・ 立てた ・ 着手 ・ 済 ・ 残りの表', t.code === 0 && /2026-11-02\s+1\s+1\s+0\s+3/.test(t.out) && /2026-11-03\s+1\s+0\s+1\s+3/.test(t.out) && !t.out.includes('2026-11-01'), t.out + t.err);
	check('since が until より後なら終了コード 5', run(['stats', '--since', '2026-11-05', '--until', '2026-11-01'], dir).code === 5);
	check('日付の形が違えば終了コード 5', run(['stats', '--since', '11/01'], dir).code === 5);
	const all = run(['stats', '--json'], dir);
	let q: { since?: string; until?: string } = {};
	try { q = JSON.parse(all.out); } catch { /* 下で失敗にする */ }
	check('since の既定は、いちばん古い日付 (created ・ started ・ done の最小)、until の既定は今日 (JST)', q.since === '2026-11-01' && q.until === '2026-11-20', all.out + all.err);
}

// ---- backfill-done (決定 281-A) ----

console.log('--- backfill-done');
{
	const dir = std('backfill');
	const commit = (msg: string, when: string): void => {
		git(dir, ['add', '-A']);
		git(dir, ['commit', '-q', '-m', msg], { GIT_AUTHOR_DATE: when, GIT_COMMITTER_DATE: when });
	};
	git(dir, ['init', '-q', '-b', 'develop']);
	const put = (rel: string, text: string): void => { fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true }); fs.writeFileSync(path.join(dir, rel), text); };
	// commit 1 (11-07): 10 件が一度に done/ に現れる (移行 commit。済にした日ではない)。ほかに、これから済にする 3 件
	for (let i = 1; i <= 10; i++) {
		const n = String(i).padStart(2, '0');
		put(Done + `i261101-${n}-bulk.md`, issueText({ id: `i261101-${n}`, created: '2026-11-01' }));
	}
	put(Doing + 'i261105-01-x.md', issueText({ id: 'i261105-01', created: '2026-11-05' }));
	put(Doing + 'i261105-02-y.md', issueText({ id: 'i261105-02', created: '2026-11-05' }));
	put(Todo + 'i261105-03-w.md', issueText({ id: 'i261105-03', created: '2026-11-05' }));
	commit('migrate', '2026-11-07T09:00:00+09:00');
	// commit 2 (11-10 23:30 JST): x が済へ
	git(dir, ['mv', Doing + 'i261105-01-x.md', Done + 'i261105-01-x.md']);
	commit('x done', '2026-11-10T23:30:00+09:00');
	// commit 3 (UTC の 11-12 20:00 = JST の 11-13 05:00): y が済へ
	git(dir, ['mv', Doing + 'i261105-02-y.md', Done + 'i261105-02-y.md']);
	commit('y done', '2026-11-12T20:00:00+00:00');
	// commit 4 (11-14 10:00 JST): 済のまま新しく入る 1 件 (一括ではない)
	put(Done + 'i261114-01-z.md', issueText({ id: 'i261114-01', created: '2026-11-14' }));
	commit('z', '2026-11-14T10:00:00+09:00');
	// commit 5 (11-15 12:00 JST): w は archived/ へ直接 (todo → archived。済として現れた日)
	git(dir, ['mv', Todo + 'i261105-03-w.md', Archived + 'i261105-03-w.md']);
	commit('w archived', '2026-11-15T12:00:00+09:00');
	// すでに done がある済は、上書きしない
	put(Done + 'i261117-01-has.md', issueText({ id: 'i261117-01', created: '2026-11-17', done: '2026-11-17 09:00' }));
	commit('has', '2026-11-17T09:00:00+09:00');
	// 追跡されていない済 (履歴に無い)
	put(Done + 'i261116-01-untracked.md', issueText({ id: 'i261116-01', created: '2026-11-16' }));

	const before = git(dir, ['status', '--porcelain']);
	const dry = run(['backfill-done', '--dry-run', '--json'], dir);
	let p: { mode?: string; plan?: { id: string; done: string }[]; skipped?: { id: string; reason: string }[] } = {};
	try { p = JSON.parse(dry.out); } catch { /* 下で失敗にする */ }
	const plan = (p.plan ?? []).map((x) => `${x.id}=${x.done}`).sort().join(',');
	check('--dry-run: 一括 (10 件) の commit の分は入らず、済になった commit の日時 (JST) が並ぶ',
		dry.code === 0 && plan === 'i261105-01=2026-11-10 23:30,i261105-02=2026-11-13 05:00,i261105-03=2026-11-15 12:00,i261114-01=2026-11-14 10:00', dry.out + dry.err);
	check('--dry-run: 一括の 10 件と、履歴に無い 1 件は、飛ばした理由つきで出る', (p.skipped ?? []).filter((s) => s.id.startsWith('i261101-')).length === 10 && (p.skipped ?? []).some((s) => s.id === 'i261116-01'), dry.out);
	check('--dry-run は、何も書かない (git status が変わらない)', git(dir, ['status', '--porcelain']) === before);
	check('既定 (--dry-run も --apply も無い) は --dry-run と同じで、書かない', run(['backfill-done'], dir).code === 0 && git(dir, ['status', '--porcelain']) === before);

	const ap = run(['backfill-done', '--apply'], dir);
	check('--apply は、終了コード 0', ap.code === 0, ap.out + ap.err);
	check('--apply: 済になった commit の日時を done に書く (x)', read(dir, Done + 'i261105-01-x.md') === issueText({ id: 'i261105-01', created: '2026-11-05', done: '2026-11-10 23:30' }), read(dir, Done + 'i261105-01-x.md'));
	check('--apply: UTC の commit は JST に直して書く (y)', read(dir, Done + 'i261105-02-y.md').includes('done: 2026-11-13 05:00\n'));
	check('--apply: archived/ にも書く (w)', read(dir, Archived + 'i261105-03-w.md').includes('done: 2026-11-15 12:00\n'));
	check('--apply: 一括の分には書かない', !read(dir, Done + 'i261101-01-bulk.md').includes('done:'));
	check('--apply: すでにある done は変えない', read(dir, Done + 'i261117-01-has.md') === issueText({ id: 'i261117-01', created: '2026-11-17', done: '2026-11-17 09:00' }));
	check('--apply: started は書かない', !read(dir, Done + 'i261105-01-x.md').includes('started:'));
	check('--apply のあとの issue check は、エラーを出さない', run(['check'], dir).code === 0, run(['check'], dir).out);
	const again = run(['backfill-done', '--apply', '--json'], dir);
	let q: { plan?: unknown[] } = {};
	try { q = JSON.parse(again.out); } catch { /* 下で失敗にする */ }
	check('--apply をもう一度流しても、書くものが無い (冪等)', again.code === 0 && q.plan?.length === 0, again.out + again.err);
	check('--dry-run と --apply を一緒に渡せば終了コード 5', run(['backfill-done', '--dry-run', '--apply'], dir).code === 5);
}
{
	// --skip-commit: 指定した commit で済になった分は、書かない
	const dir = std('backfill-skip');
	git(dir, ['init', '-q', '-b', 'develop']);
	fs.mkdirSync(path.join(dir, Done), { recursive: true });
	fs.writeFileSync(path.join(dir, Done + 'i261105-01-x.md'), issueText({ id: 'i261105-01', created: '2026-11-05' }));
	git(dir, ['add', '-A']);
	git(dir, ['commit', '-q', '-m', 'x'], { GIT_AUTHOR_DATE: '2026-11-10T10:00:00+09:00', GIT_COMMITTER_DATE: '2026-11-10T10:00:00+09:00' });
	const hash = git(dir, ['rev-parse', 'HEAD']);
	const r = run(['backfill-done', '--apply', '--skip-commit', hash.slice(0, 7)], dir);
	check('--skip-commit に渡した commit の分は書かない', r.code === 0 && !read(dir, Done + 'i261105-01-x.md').includes('done:'), r.out + r.err);
	const r2 = run(['backfill-done', '--apply'], dir);
	check('--skip-commit が無ければ、その commit の日時を書く', r2.code === 0 && read(dir, Done + 'i261105-01-x.md').includes('done: 2026-11-10 10:00\n'), r2.out + r2.err);
}

console.log('');
console.log(`=== issue (done ・ started): ${pass} 件成功 ・ ${fail} 件失敗 ===`);
fs.rmSync(work, { recursive: true, force: true });
process.exit(fail === 0 ? 0 : 1);
