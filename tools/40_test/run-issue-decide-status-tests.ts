/*
	issue の決定の状態 (status) の試験 (249-A、計画 i261111-06)。

	- 決定は status を持てる: 決めた ・ 仮に決めた ・ 答え待ち。書いていなければ 決めた
	- check は status の値を検査し、キーの順は chosen の後
	- decide new --status で書ける。決めたなら書かない
	- decide set <id> --status <状態> [--chosen <字>] で、あとから変える
	- render は、決めた以外の決定に印を付ける

	期待値は、計画から先に手で書いた (実装の出力から作っていない)。
	本物のプロジェクトには触らない。tmp/ の下に、ケースごとの小さなプロジェクトを作る。
*/
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..', '..');
const work = path.join(root, 'tmp', 'issue-decide-status-tests');
const main = path.join(root, 'src', 'issue', 'main.ts');

let pass = 0;
let fail = 0;
function check(name: string, ok: boolean, detail: string = ''): void {
	if (ok) { pass++; console.log('  ✅ [OK] ' + name); }
	else { fail++; console.log('  ❌ [NG] ' + name + (detail ? '  ' + detail : '')); }
}

const Items = 'notes/40_issues/items/';
const Decisions = 'notes/40_issues/decisions/';
const uuidText = (name: string): string => `schema: 2\nproject_uuid: 7b0c4e1a9f3d4a62b8d51c2e6f90a3b8\nproject_id: ${name}\n`;
const issueText = (id: string): string => `---\nschema: 1\nid: ${id}\ntitle: 題\ngroup: g\ncreated: 2026-11-03\n---\n\n本文\n`;
function decisionText(over: Record<string, string | null> = {}): string {
	const base: Record<string, string | null> = { schema: '1', id: 'i261103-01-d1', title: '問い', parent: 'i261103-01', decided: '2026-11-08', chosen: 'A' };
	const all = { ...base, ...over };
	return '---\n' + Object.keys(all).filter((k) => all[k] !== null).map((k) => k + ': ' + all[k]).join('\n') + '\n---\n\n## 案\n\n- A: 一つ目\n- B: 二つ目\n';
}
function mkProject(name: string, files: Record<string, string> = {}): string {
	const dir = path.join(work, name);
	fs.rmSync(dir, { recursive: true, force: true });
	const all: Record<string, string> = { [Items + 'project-uuid.txt']: uuidText(name), [Items + 'todo/i261103-01-題.md']: issueText('i261103-01'), ...files };
	for (const [rel, text] of Object.entries(all)) {
		const full = path.join(dir, rel);
		fs.mkdirSync(path.dirname(full), { recursive: true });
		fs.writeFileSync(full, text);
	}
	return dir;
}
type Result = { code: number; out: string; err: string };
function run(args: string[], cwd: string): Result {
	const env = { ...process.env, ISSUE_TEST_TODAY: '2026-11-11' } as Record<string, string>;
	const r = spawnSync(process.execPath, [main, ...args], { cwd, env, encoding: 'utf8', timeout: 60000 });
	return { code: r.status ?? -1, out: (r.stdout ?? '').trim(), err: (r.stderr ?? '').trim() };
}
const decisionFiles = (dir: string): string[] => fs.readdirSync(path.join(dir, Decisions)).filter((n) => n.endsWith('.md'));
const readDecision = (dir: string): string => fs.readFileSync(path.join(dir, Decisions, decisionFiles(dir)[0]), 'utf8');

fs.rmSync(work, { recursive: true, force: true });

console.log('\n[check: status の値と順]');
for (const s of ['決めた', '仮に決めた', '答え待ち']) {
	const dir = mkProject('ok-' + s, { [Decisions + 'i261103-01-d1-x.md']: decisionText({ status: s }) });
	const r = run(['check', '--root', dir], dir);
	check(`status: ${s} は問題なし`, r.code === 0 && !(r.out + r.err).includes('status') && !(r.out + r.err).includes('知らないキー'), r.out + r.err);
}
{
	const dir = mkProject('ng-value', { [Decisions + 'i261103-01-d1-x.md']: decisionText({ status: '保留' }) });
	const r = run(['check', '--root', dir], dir);
	check('status の値が 3 つのどれでもなければ、誤り (終了コード 1)', r.code === 1 && (r.out + r.err).includes('status'), r.out + r.err);
}
{
	const text = decisionText({ chosen: null, status: '答え待ち' }).replace('status: 答え待ち', 'status: 答え待ち\nchosen: A');
	const dir = mkProject('order', { [Decisions + 'i261103-01-d1-x.md']: text });
	const r = run(['check', '--root', dir], dir);
	check('status は chosen の後に置く (前ならキーの順の警告)', (r.out + r.err).includes('キーの順'), r.out + r.err);
}

console.log('\n[decide new --status]');
{
	const dir = mkProject('new-pending');
	const r = run(['decide', 'new', '--root', dir, '--parent', 'i261103-01', '--title', '250: 問い', '--option', 'a', '--option', 'b', '--chosen', 'A', '--status', '答え待ち'], dir);
	check('--status 答え待ち で書ける', r.code === 0 && /\nchosen: A\nstatus: 答え待ち\n/.test(readDecision(dir)), r.out + r.err + readDecision(dir));
	const dir2 = mkProject('new-decided');
	run(['decide', 'new', '--root', dir2, '--parent', 'i261103-01', '--title', '問い', '--option', 'a', '--chosen', 'A', '--status', '決めた'], dir2);
	check('--status 決めた なら status を書かない (既定と同じ)', !readDecision(dir2).includes('status:'), readDecision(dir2));
	const dir3 = mkProject('new-bad');
	const bad = run(['decide', 'new', '--root', dir3, '--parent', 'i261103-01', '--title', '問い', '--option', 'a', '--chosen', 'A', '--status', '保留'], dir3);
	check('知らない --status は終了コード 5 (issue の引数の誤り)', bad.code === 5, bad.out + bad.err);
}

console.log('\n[decide set]');
{
	const dir = mkProject('set', { [Decisions + 'i261103-01-d1-x.md']: decisionText({ status: '答え待ち' }) });
	const r = run(['decide', 'set', 'i261103-01-d1', '--root', dir, '--status', '決めた', '--chosen', 'B'], dir);
	const t = readDecision(dir);
	check('decide set で 決めた にすると、status の行を消す', r.code === 0 && !t.includes('status:'), r.out + r.err + t);
	check('decide set --chosen で選んだ字を変える', /\nchosen: B\n/.test(t), t);
	check('decide set で決めた日を今日にする', /\ndecided: 2026-11-11\n/.test(t), t);
	const r2 = run(['decide', 'set', 'i261103-01-d1', '--root', dir, '--status', '仮に決めた'], dir);
	check('decide set で 仮に決めた にすると、chosen の後に status を書く', r2.code === 0 && /\nchosen: B\nstatus: 仮に決めた\n/.test(readDecision(dir)), r2.out + r2.err + readDecision(dir));
	const ng = run(['decide', 'set', 'i261103-01-d1', '--root', dir, '--chosen', 'Z'], dir);
	check('案に無い字は終了コード 5 で、書き換えない', ng.code === 5 && /\nchosen: B\n/.test(readDecision(dir)), ng.out + ng.err);
	const none = run(['decide', 'set', 'i261103-01-d9', '--root', dir, '--status', '決めた'], dir);
	check('無い決定は終了コード 1', none.code === 1, none.out + none.err);
	const chk = run(['check', '--root', dir], dir);
	check('書き換えた後も check は問題なし', chk.code === 0, chk.out + chk.err);
}

console.log('\n[render の印]');
{
	const dir = mkProject('render', {
		[Decisions + 'i261103-01-d1-x.md']: decisionText({ status: '答え待ち' }),
		[Decisions + 'i261103-01-d2-y.md']: decisionText({ id: 'i261103-01-d2', title: '問い2' }),
	});
	run(['render', '--root', dir], dir);
	const html = fs.readFileSync(path.join(dir, 'notes/40_issues/_issues.html'), 'utf8');
	check('render は 答え待ち の決定に印を付ける', html.includes('答え待ち'), '');
	const d2 = html.slice(html.indexOf('問い2'), html.indexOf('問い2') + 400);
	check('決めた の決定には印を付けない', !d2.includes('答え待ち') && !d2.includes('仮に決めた'), d2);
}

fs.rmSync(work, { recursive: true, force: true });
console.log(`\n=== 決定の状態: ${pass} 件成功 ・ ${fail} 件失敗 ===`);
process.exit(fail === 0 ? 0 : 1);
