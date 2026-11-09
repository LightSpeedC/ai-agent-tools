/*
	issue（課題管理ツール）の番号の予約の共有のテスト (計画 p261109-01)。
	- project-uuid.txt (schema 2) と、古い project-id.txt からの移し替え (207-A ・ 208-A)
	- 予約の場所 ~/.ai-agent-tools/numbers/<キー>/ (202-A)。キーは GitHub の 所有者/名前 か project_uuid (203-A ・ 207-A)
	- worktree の間でも、課題 ・ 決定 ・ 選択肢の番号が重ならない (201-A)
	- 3 日より前の予約を消し、系列ごとの最大の 1 つは残す (205-A)

	期待値は、計画から先に手で書いた（実装の出力から作っていない）。
	本物のホームには触らない。予約の置き場は、環境変数 AI_AGENT_TOOLS_NUMBERS_DIR で tmp/ の下に向ける。
*/
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..', '..');
const work = path.join(root, 'tmp', 'issue-numbers-tests');
const main = path.join(root, 'src', 'issue', 'main.ts');

let pass = 0;
let fail = 0;
function check(name: string, ok: boolean, detail: string = ''): void {
	if (ok) { pass++; console.log('  ✅ [OK] ' + name); }
	else { fail++; console.log('  ❌ [NG] ' + name + (detail ? '  ' + detail : '')); }
}

const Items = 'notes/40_issues/items/';
const Uuid = '7b0c4e1a9f3d4a62b8d51c2e6f90a3b7';
const OldText = `schema: 1\nproject_id: ${Uuid}\n`;
const Today = '2026-11-05';

type Result = { code: number; out: string; err: string };

function run(args: string[], cwd: string, numbers: string, today: string = Today): Result {
	const env = { ...process.env, ISSUE_TEST_TODAY: today, AI_AGENT_TOOLS_NUMBERS_DIR: numbers } as Record<string, string>;
	const r = spawnSync(process.execPath, [main, ...args], { cwd, env, encoding: 'utf8', timeout: 60000 });
	return { code: r.status ?? -1, out: (r.stdout ?? '').trim(), err: (r.stderr ?? '').trim() };
}

function git(args: string[], cwd: string): Result {
	const r = spawnSync('git', args, { cwd, encoding: 'utf8', timeout: 60000 });
	return { code: r.status ?? -1, out: (r.stdout ?? '').trim(), err: (r.stderr ?? '').trim() };
}

function mkProject(dir: string, files: Record<string, string>): string {
	fs.rmSync(dir, { recursive: true, force: true });
	fs.mkdirSync(dir, { recursive: true });
	for (const [rel, text] of Object.entries(files)) {
		const full = path.join(dir, rel);
		fs.mkdirSync(path.dirname(full), { recursive: true });
		fs.writeFileSync(full, text);
	}
	return dir;
}

function read(file: string): string {
	try { return fs.readFileSync(file, 'utf8'); } catch { return ''; }
}

function list(dir: string): string[] {
	try { return fs.readdirSync(dir).sort(); } catch { return []; }
}

function idOf(out: string, pattern: RegExp): string {
	return pattern.exec(out)?.[0] ?? '';
}

const IssueId = /i\d{6}-[0-9a-z]{2}/i;
const DecisionId = /p261105-01-d\d+/;

fs.rmSync(work, { recursive: true, force: true });
fs.mkdirSync(work, { recursive: true });

// ---- project-uuid.txt ----

console.log('\n[project-uuid.txt]');
{
	const numbers = path.join(work, 'n-init');
	const dir = mkProject(path.join(work, 'proj-init'), {});
	const r = run(['init', '--root', dir], dir, numbers);
	const text = read(path.join(dir, Items, 'project-uuid.txt'));
	check('init は project-uuid.txt を作る (schema 2 ・ 乱数の project_uuid ・ フォルダ名の project_id)',
		r.code === 0 && /^schema: 2\nproject_uuid: [0-9a-f]{32}\nproject_id: proj-init\n$/.test(text), r.out + r.err + ' / ' + text);
	check('init は project-id.txt を作らない', !fs.existsSync(path.join(dir, Items, 'project-id.txt')));
}
{
	const numbers = path.join(work, 'n-move');
	const dir = mkProject(path.join(work, 'proj-move'), { [Items + 'project-id.txt']: OldText });
	const r = run(['init', '--root', dir], dir, numbers);
	const text = read(path.join(dir, Items, 'project-uuid.txt'));
	check('init は古い project-id.txt を project-uuid.txt に移し、乱数を変えない',
		r.code === 0 && text === `schema: 2\nproject_uuid: ${Uuid}\nproject_id: proj-move\n`, r.out + r.err + ' / ' + text);
	check('移したあと、古い project-id.txt は残らない', !fs.existsSync(path.join(dir, Items, 'project-id.txt')));
	check('移したことを出す', r.out.includes('移した'), r.out);
	const c = run(['check', '--root', dir], dir, numbers);
	check('移したあとの check は project-uuid.txt を通す', c.code === 0 && !c.out.includes('project-uuid'), c.out);
}
{
	const numbers = path.join(work, 'n-old');
	const dir = mkProject(path.join(work, 'proj-old'), { [Items + 'project-id.txt']: OldText });
	const c = run(['check', '--root', dir], dir, numbers);
	check('古い project-id.txt だけなら、check は警告で移すよう促す (エラーにしない)', c.code === 0 && c.out.includes('issue init'), c.out);
	const r = run(['new', '--root', dir, '--title', '古いまま', '--group', 'g'], dir, numbers);
	check('古い project-id.txt のままでも new は番号を取れる', r.code === 0 && r.out.includes('i261105-01'), r.out + r.err);
	check('古い project-id.txt のときの予約のキーは uuid', fs.existsSync(path.join(numbers, 'uuid_' + Uuid, 'ids', 'i261105-01')), list(numbers).join(','));
}
{
	const numbers = path.join(work, 'n-name');
	const dir = mkProject(path.join(work, 'proj-name'), { [Items + 'project-uuid.txt']: `schema: 2\nproject_uuid: ${Uuid}\nproject_id: other-name\n` });
	const c = run(['check', '--root', dir], dir, numbers);
	check('記録した project_id がフォルダ名と違えば、check が知らせる', c.out.includes('other-name') && c.out.includes('proj-name'), c.out);
}

// ---- 予約の場所とキー (リモートが無い) ----

console.log('\n[予約の場所 (リモートが無い)]');
{
	const numbers = path.join(work, 'n-uuid');
	const dir = mkProject(path.join(work, 'proj-uuid'), { [Items + 'project-uuid.txt']: `schema: 2\nproject_uuid: ${Uuid}\nproject_id: proj-uuid\n` });
	const r = run(['new', '--root', dir, '--title', '一つめ', '--group', 'g'], dir, numbers);
	const base = path.join(numbers, 'uuid_' + Uuid);
	check('リモートが無ければ、キーは uuid_<project_uuid>', r.code === 0 && fs.existsSync(path.join(base, 'ids', 'i261105-01')), r.out + r.err + ' / ' + list(numbers).join(','));
	const info = read(path.join(base, 'ids', 'i261105-01', 'info.json'));
	check('予約には info.json (いつ ・ 何を) を置く', info.includes('"id"') && info.includes('i261105-01'), info);
	check('key.json にキーの元 (project_uuid ・ project_id) を書く', read(path.join(base, 'key.json')).includes(Uuid) && read(path.join(base, 'key.json')).includes('proj-uuid'), read(path.join(base, 'key.json')));
	check('書き終えても予約を残す', fs.existsSync(path.join(base, 'ids', 'i261105-01')));
	check('_lock/ は作らない', !fs.existsSync(path.join(dir, 'notes', '40_issues', '_lock')));

	// 手元のファイルを消しても、予約が残っていれば同じ番号を取らない
	fs.rmSync(path.join(dir, Items, 'todo'), { recursive: true, force: true });
	const r2 = run(['new', '--root', dir, '--title', '二つめ', '--group', 'g'], dir, numbers);
	check('手元にファイルが無くても、予約にある番号は取らない (02 になる)', r2.code === 0 && r2.out.includes('i261105-02'), r2.out + r2.err);
}

// ---- worktree の間で重ならない ----

console.log('\n[worktree]');
{
	const numbers = path.join(work, 'n-wt');
	const mainDir = path.join(work, 'repo-main');
	const wtDir = path.join(work, 'repo-wt');
	mkProject(mainDir, { [Items + 'project-uuid.txt']: `schema: 2\nproject_uuid: ${Uuid}\nproject_id: repo-main\n`, 'README.md': 'x\n' });
	fs.rmSync(wtDir, { recursive: true, force: true });
	const steps = [
		git(['init', '-q', '-b', 'develop'], mainDir),
		git(['remote', 'add', 'origin', 'https://github.com/test-owner/test-repo.git'], mainDir),
		git(['add', '--', 'README.md', Items + 'project-uuid.txt'], mainDir),
		git(['-c', 'user.name=t', '-c', 'user.email=t@example.com', 'commit', '-q', '-m', 'x'], mainDir),
		git(['worktree', 'add', '-q', '-b', 'wt', wtDir], mainDir),
	];
	const ready = steps.every((s) => s.code === 0);
	check('材料: git の worktree を作れた', ready, steps.map((s) => s.code + s.err).join(' / '));

	const a = run(['new', '--root', mainDir, '--title', '元', '--group', 'g'], mainDir, numbers);
	const b = run(['new', '--root', wtDir, '--title', 'worktree', '--group', 'g'], wtDir, numbers);
	const ia = idOf(a.out, IssueId);
	const ib = idOf(b.out, IssueId);
	check('元と worktree で課題の番号が重ならない (01 と 02)', ia === 'i261105-01' && ib === 'i261105-02', a.out + a.err + ' / ' + b.out + b.err);
	check('GitHub のリモートがあれば、キーは github_<所有者>_<名前>', fs.existsSync(path.join(numbers, 'github_test-owner_test-repo', 'ids', 'i261105-01')), list(numbers).join(','));

	const dArgs = ['decide', 'new', '--parent', 'p261105-01', '--title', '問い', '--option', 'あ', '--chosen', 'A'];
	const da = run([...dArgs, '--root', mainDir], mainDir, numbers);
	const db = run([...dArgs, '--root', wtDir], wtDir, numbers);
	check('元と worktree で決定の番号が重ならない (d1 と d2)', idOf(da.out, DecisionId) === 'p261105-01-d1' && idOf(db.out, DecisionId) === 'p261105-01-d2', da.out + da.err + ' / ' + db.out + db.err);

	const ca = run(['choice', 'next', '--root', mainDir], mainDir, numbers);
	const cb = run(['choice', 'next', '--root', wtDir], wtDir, numbers);
	check('元と worktree で選択肢の番号が重ならない (1 と 2)', ca.code === 0 && cb.code === 0 && ca.out === '1' && cb.out === '2', ca.out + ca.err + ' / ' + cb.out + cb.err);
	const cj = run(['choice', 'next', '--root', mainDir, '--json'], mainDir, numbers);
	check('choice next --json は {"number": 3} を返す', cj.code === 0 && JSON.parse(cj.out || '{}').number === 3, cj.out + cj.err);

	git(['worktree', 'remove', '--force', wtDir], mainDir);
}

// ---- 選択肢の番号の始まり ----

console.log('\n[選択肢の番号の始まり]');
{
	const numbers = path.join(work, 'n-choice');
	const dir = mkProject(path.join(work, 'proj-choice'), {
		[Items + 'project-uuid.txt']: `schema: 2\nproject_uuid: ${Uuid}\nproject_id: proj-choice\n`,
		'notes/40_issues/decisions/p261101-01-d1-x.md': '---\nschema: 1\nid: p261101-01-d1\ntitle: t\nparent: p261101-01\ndecided: 2026-11-01\nchosen: A\nlegacy_ids: :proj-choice:150-A, :proj-choice:p261001-01/7-B\n---\n\n## 案\n\n- A: a\n',
		'notes/40_issues/decisions/p261101-01-d2-y.md': '---\nschema: 1\nid: p261101-01-d2\ntitle: t\nparent: p261101-01\ndecided: 2026-11-01\nchosen: A\nlegacy_ids: :other-project:900-A\n---\n\n## 案\n\n- A: a\n',
	});
	const r = run(['choice', 'next', '--root', dir], dir, numbers);
	check('最初の番号は、自分のプロジェクトの legacy_ids の最大に 1 を足す (151。ほかのプロジェクトの 900 は数えない)', r.code === 0 && r.out === '151', r.out + r.err);
}

// ---- 3 日より前の予約を消す ----

console.log('\n[古い予約の削除]');
{
	const numbers = path.join(work, 'n-prune');
	const dir = mkProject(path.join(work, 'proj-prune'), { [Items + 'project-uuid.txt']: `schema: 2\nproject_uuid: ${Uuid}\nproject_id: proj-prune\n` });
	const base = path.join(numbers, 'uuid_' + Uuid);
	const old = new Date(Date.now() - 4 * 24 * 3600 * 1000);
	const recent = new Date(Date.now() - 1 * 24 * 3600 * 1000);
	const mk = (rel: string, when: Date): void => {
		const p = path.join(base, rel);
		fs.mkdirSync(p, { recursive: true });
		fs.utimesSync(p, when, when);
	};
	mk('ids/i261101-01', old);
	mk('ids/i261101-02', old);
	mk('ids/i261104-01', recent);
	mk('ids/p261020-01-d1', old);
	mk('ids/p261020-01-d2', old);
	mk('choices/5', old);
	mk('choices/6', old);
	const r = run(['new', '--root', dir, '--title', '消す', '--group', 'g'], dir, numbers);
	const ids = list(path.join(base, 'ids'));
	check('材料: new が通る', r.code === 0, r.out + r.err);
	check('過ぎた日の古い予約は、最大のものも消す (i261101-01 ・ 02)', !ids.includes('i261101-01') && !ids.includes('i261101-02'), ids.join(','));
	check('3 日より新しい予約は残す (i261104-01)', ids.includes('i261104-01'), ids.join(','));
	check('決定は、親ごとに最大の 1 つを残す (d1 は消え、d2 は残る)', !ids.includes('p261020-01-d1') && ids.includes('p261020-01-d2'), ids.join(','));
	const choices = list(path.join(base, 'choices'));
	check('選択肢は、最大の 1 つを残す (5 は消え、6 は残る)', choices.join(',') === '6', choices.join(','));
	const c = run(['choice', 'next', '--root', dir], dir, numbers);
	check('残した最大の次から取る (7)', c.out === '7', c.out + c.err);
}

console.log(`\n=== issue (番号の予約): ${pass} 件成功 ・ ${fail} 件失敗 ===`);
process.exit(fail === 0 ? 0 : 1);
