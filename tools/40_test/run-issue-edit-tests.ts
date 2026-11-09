/*
	issue（課題管理ツール）のフェーズ 2 の後半のテスト: set ・ todo ・ search ・ archive ・ unarchive。
	計画は p261103-01、仕様は notes/50_spec/課題ファイルの形と検査.html。

	状態は、置いてあるフォルダ (todo / doing / done / archived) で持つ (126-A)。
	状態を変えるのは、ファイルを隣のフォルダへ動かすこと (git の管理下なら git mv)。
	期待値は、仕様と計画の決定から先に手で書いた（実装の出力から作っていない）。
	本物のプロジェクトには触らない。tmp/ の下に、ケースごとの小さなプロジェクトを作る。

	人を表す値は example.com のような仮の値にする（共通ルール「テストのルール」）。
*/
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..', '..');
const work = path.join(root, 'tmp', 'issue-edit-tests');
const main = path.join(root, 'src', 'issue', 'main.ts');

let pass = 0;
let fail = 0;
function check(name: string, ok: boolean, detail: string = ''): void {
	if (ok) { pass++; console.log('  ✅ [OK] ' + name); }
	else { fail++; console.log('  ❌ [NG] ' + name + (detail ? '  ' + detail : '')); }
}

// ---- 材料 ----

/** project-uuid.txt (schema 2)。project_id はプロジェクトのフォルダ名 (計画 p261109-01 の 207-A ・ 208-A) */
const uuidText = (name: string): string => `schema: 2\nproject_uuid: 7b0c4e1a9f3d4a62b8d51c2e6f90a3b7\nproject_id: ${name}\n`;
const Items = 'notes/40_issues/items/';
const Todo = Items + 'todo/';
const Doing = Items + 'doing/';
const Done = Items + 'done/';
const Archived = Items + 'archived/';
const Today = '2026-11-05';

const KeyOrder = ['schema', 'id', 'title', 'group', 'created', 'from', 'confirmed', 'refs'];
const Defaults: Record<string, string> = {
	schema: '1', id: 'i261103-01', title: '題', group: 'html2md', created: '2026-11-03',
};

function issueText(over: Record<string, string | null> = {}, body: string = '\n本文\n'): string {
	const all: Record<string, string | null> = { ...Defaults, ...over };
	const keys = [...KeyOrder.filter((k) => k in all), ...Object.keys(all).filter((k) => !KeyOrder.includes(k))];
	const lines = keys.filter((k) => all[k] !== null).map((k) => k + ': ' + all[k]);
	return '---\n' + lines.join('\n') + '\n---\n' + body;
}

function mkProject(name: string, files: Record<string, string>): string {
	const dir = path.join(work, name);
	fs.rmSync(dir, { recursive: true, force: true });
	fs.mkdirSync(dir, { recursive: true });
	for (const [rel, text] of Object.entries(files)) {
		const full = path.join(dir, rel);
		fs.mkdirSync(path.dirname(full), { recursive: true });
		fs.writeFileSync(full, text);
	}
	return dir;
}

function std(name: string, files: Record<string, string> = {}): string {
	return mkProject(name, { [Items + 'project-uuid.txt']: uuidText(name), ...files });
}

type Result = { code: number; out: string; err: string };

const BaseEnv = {
	...process.env,
	ISSUE_TEST_TODAY: Today,
	GIT_AUTHOR_NAME: 'Tester One', GIT_AUTHOR_EMAIL: 'tester1@example.com',
	GIT_COMMITTER_NAME: 'Tester One', GIT_COMMITTER_EMAIL: 'tester1@example.com',
} as Record<string, string>;

function run(args: string[], dir: string): Result {
	const r = spawnSync(process.execPath, [main, ...args, '--root', dir], { cwd: dir, env: BaseEnv, encoding: 'utf8', timeout: 60000 });
	return { code: r.status ?? -1, out: (r.stdout ?? '').trim(), err: (r.stderr ?? '').trim() };
}

function git(dir: string, ...args: string[]): string {
	const r = spawnSync('git', args, { cwd: dir, env: BaseEnv, encoding: 'utf8', timeout: 60000 });
	return (r.stdout ?? '').trim();
}

function read(dir: string, rel: string): string {
	try { return fs.readFileSync(path.join(dir, rel), 'utf8'); } catch { return ''; }
}

function exists(dir: string, rel: string): boolean {
	return fs.existsSync(path.join(dir, rel));
}

function idsOf(out: string): string[] {
	return out.split('\n').map((l) => /i\d{6}-[0-9a-kLm-z]{2}/.exec(l)?.[0] ?? '').filter((s) => s !== '');
}

const A = 'i261103-01-a.md';
const B = 'i261103-02-b.md';
const C = 'i261103-03-c.md';

// ---- set ----

console.log('--- set');
{
	const dir = std('set-basic', { [Todo + A]: issueText() });
	const before = read(dir, Todo + A);
	const r = run(['set', 'i261103-01', '--state', '着手'], dir);
	check('set --state 着手: todo/ から doing/ へ動かす (中身は変えない)', r.code === 0 && !exists(dir, Todo + A) && read(dir, Doing + A) === before, r.out + r.err);
	check('set の出力に、id と、動かした先 (todo/ → doing/) が出る', r.out.includes('i261103-01') && r.out.includes('todo/') && r.out.includes('doing/'), r.out);
	check('set の出力に、絶対パスを出さない', !r.out.includes(dir) && !r.out.split('\\').join('/').includes(dir.split('\\').join('/')), r.out);
	check('動かしたあとのプロジェクトは、issue check が通る', run(['check'], dir).code === 0, run(['check'], dir).out);
	const back = run(['set', 'i261103-01', '--state', '未'], dir);
	check('set --state 未: doing/ から todo/ へ戻せる', back.code === 0 && exists(dir, Todo + A) && !exists(dir, Doing + A), back.out + back.err);
}
{
	const dir = std('set-done', { [Doing + A]: issueText() });
	const r = run(['set', 'i261103-01', '--state', '済'], dir);
	check('set --state 済: やることが無く、報告元も無ければ、done/ へ動かせる', r.code === 0 && exists(dir, Done + A), r.out + r.err);
}
{
	const dir = std('set-done-todo', { [Doing + A]: issueText({}, '\n## やること\n- [済] a\n- [未] b\n') });
	const r = run(['set', 'i261103-01', '--state', '済'], dir);
	check('やること (未) が残っていれば、済にできない (終了コード 1。ファイルは動かない)', r.code === 1 && exists(dir, Doing + A) && !exists(dir, Done + A), r.out + r.err);
	check('拒否の理由に「やること」が出る', (r.out + r.err).includes('やること'), r.out + r.err);
}
{
	const dir = std('set-done-doing-todo', { [Doing + A]: issueText({}, '\n## やること\n- [着手] a\n') });
	check('やること (着手) が残っていても、済にできない', run(['set', 'i261103-01', '--state', '済'], dir).code === 1);
}
{
	const dir = std('set-done-confirmed', { [Doing + A]: issueText({ from: 'project-a #1', confirmed: 'false' }) });
	const r = run(['set', 'i261103-01', '--state', '済'], dir);
	check('報告元の確認 (confirmed) が true でなければ、済にできない (理由に confirmed が出る)', r.code === 1 && exists(dir, Doing + A) && (r.out + r.err).includes('confirmed'), r.out + r.err);
}
{
	const dir = std('set-done-confirmed-ok', { [Doing + A]: issueText({ from: 'project-a #1', confirmed: 'true' }, '\n## やること\n- [済] a\n') });
	check('報告元の確認が true で、やることが全部済なら、済にできる', run(['set', 'i261103-01', '--state', '済'], dir).code === 0 && exists(dir, Done + A));
}
{
	const dir = std('set-same', { [Todo + A]: issueText() });
	const r = run(['set', 'i261103-01', '--state', '未'], dir);
	check('既にその状態なら、何もせず終了コード 0 (「既に」と出す)', r.code === 0 && r.out.includes('既に') && exists(dir, Todo + A), r.out);
}
{
	const dir = std('set-archived', { [Archived + A]: issueText() });
	const r = run(['set', 'i261103-01', '--state', '未'], dir);
	check('archived/ の課題は、set で動かさない (終了コード 1。unarchive を促す)', r.code === 1 && exists(dir, Archived + A) && (r.out + r.err).includes('unarchive'), r.out + r.err);
}
{
	const dir = std('set-args', { [Todo + A]: issueText() });
	check('見つからない id は終了コード 1', run(['set', 'i261103-99', '--state', '着手'], dir).code === 1);
	check('id の形でない引数は終了コード 5', run(['set', 'xyz', '--state', '着手'], dir).code === 5);
	check('--state が無ければ終了コード 5', run(['set', 'i261103-01'], dir).code === 5);
	check('--state に知らない語を渡せば終了コード 5 (archived は archive で動かす)', run(['set', 'i261103-01', '--state', '完了'], dir).code === 5 && run(['set', 'i261103-01', '--state', 'archived'], dir).code === 5);
	check('動かさなかったので、課題は todo/ のまま', exists(dir, Todo + A));
}
{
	const dir = std('set-json', { [Todo + A]: issueText() });
	const r = run(['set', 'i261103-01', '--state', '着手', '--json'], dir);
	let p: { id?: string; state?: string; folder?: string; from?: { state?: string; folder?: string }; file?: string } = {};
	try { p = JSON.parse(r.out); } catch { /* 下で失敗にする */ }
	check('--json は { id, state, folder, from, file } を出す', p.id === 'i261103-01' && p.state === '着手' && p.folder === 'doing' && p.from?.state === '未' && p.from?.folder === 'todo' && p.file === Doing + A, r.out);
}
{
	const dir = std('set-git', { [Todo + A]: issueText() });
	git(dir, 'init', '-q', '-b', 'develop');
	git(dir, 'add', '-A');
	git(dir, 'commit', '-q', '-m', 'init');
	const r = run(['set', 'i261103-01', '--state', '着手'], dir);
	const status = git(dir, 'status', '--porcelain');
	check('git の管理下なら git mv で動かす (ステージされた rename になる)', r.code === 0 && /^R {2}.*todo\/i261103-01-a\.md -> .*doing\/i261103-01-a\.md$/m.test(status), r.out + r.err + ' / ' + status);
}

// ---- todo ----

console.log('--- todo');
const todoBody = '\n本文\n\n## やること\n- [未] a\n- [済] b\n';
{
	const dir = std('todo-list', { [Todo + A]: issueText({}, todoBody) });
	const r = run(['todo', 'i261103-01'], dir);
	check('todo <id> は、やることを番号つきで出す', r.code === 0 && r.out.includes('1 [未] a') && r.out.includes('2 [済] b'), r.out);
}
{
	const dir = std('todo-add', { [Todo + A]: issueText({}, todoBody) });
	const r = run(['todo', 'i261103-01', '--add', 'c'], dir);
	check('--add は、やることの最後に「- [未] 文」を足す', r.code === 0 && read(dir, Todo + A) === issueText({}, todoBody + '- [未] c\n'), r.out + r.err + ' / ' + read(dir, Todo + A));
}
{
	const dir = std('todo-add-new-section', { [Todo + A]: issueText() });
	run(['todo', 'i261103-01', '--add', 'c'], dir);
	check('やることの節が無ければ、「## やること」の節を作って足す', read(dir, Todo + A) === issueText({}, '\n本文\n\n## やること\n- [未] c\n'), read(dir, Todo + A));
}
{
	const dir = std('todo-done', { [Todo + A]: issueText({}, todoBody) });
	const r = run(['todo', 'i261103-01', '--done', '1'], dir);
	check('--done <n> は、n 番目を 済 にする', r.code === 0 && read(dir, Todo + A) === issueText({}, todoBody.replace('- [未] a', '- [済] a')), r.out + r.err + ' / ' + read(dir, Todo + A));
	check('--done の出力に 済 と文が出る', r.out.includes('済') && r.out.includes('a'), r.out);
}
{
	const dir = std('todo-doing', { [Todo + A]: issueText({}, todoBody) });
	run(['todo', 'i261103-01', '--doing', '1'], dir);
	check('--doing <n> は、n 番目を 着手 にする', read(dir, Todo + A).includes('- [着手] a'), read(dir, Todo + A));
	run(['todo', 'i261103-01', '--undone', '2'], dir);
	check('--undone <n> は、n 番目を 未 に戻す', read(dir, Todo + A).includes('- [未] b'), read(dir, Todo + A));
	check('やることを直したあとも、issue check が通る', run(['check'], dir).code === 0, run(['check'], dir).out);
}
{
	const dir = std('todo-range', { [Todo + A]: issueText({}, todoBody) });
	check('番号が範囲外なら終了コード 5 (ファイルは変えない)', run(['todo', 'i261103-01', '--done', '3'], dir).code === 5 && read(dir, Todo + A) === issueText({}, todoBody));
	check('番号が整数でなければ終了コード 5', run(['todo', 'i261103-01', '--done', 'x'], dir).code === 5);
	check('操作を 2 つ同時に渡せば終了コード 5', run(['todo', 'i261103-01', '--done', '1', '--add', 'c'], dir).code === 5);
	check('--add に空の文なら終了コード 5', run(['todo', 'i261103-01', '--add', ''], dir).code === 5);
	check('見つからない id は終了コード 1', run(['todo', 'i261103-99'], dir).code === 1);
}
{
	const dir = std('todo-in-done', { [Done + A]: issueText({}, '\n## やること\n- [済] a\n') });
	const r = run(['todo', 'i261103-01', '--add', 'c'], dir);
	check('done/ の課題に、やること (未) は足せない (終了コード 1)', r.code === 1 && !read(dir, Done + A).includes('[未]'), r.out + r.err);
	check('done/ の課題のやることを、未に戻せない (終了コード 1)', run(['todo', 'i261103-01', '--undone', '1'], dir).code === 1);
	check('done/ の課題のやることを、済のままにする操作は通る', run(['todo', 'i261103-01', '--done', '1'], dir).code === 0);
}
{
	const dir = std('todo-crlf', { [Todo + A]: issueText({}, todoBody).split('\n').join('\r\n') });
	const before = read(dir, Todo + A);
	check('CRLF のファイルは書き換えない (終了コード 1。issue check で直す)', run(['todo', 'i261103-01', '--done', '1'], dir).code === 1 && read(dir, Todo + A) === before);
}
{
	const dir = std('todo-json', { [Todo + A]: issueText({}, todoBody) });
	const r = run(['todo', 'i261103-01', '--json'], dir);
	let p: { id?: string; todos?: { n: number; state: string; text: string }[] } = {};
	try { p = JSON.parse(r.out); } catch { /* 下で失敗にする */ }
	check('--json は { id, todos: [{ n, state, text }] } を出す', p.id === 'i261103-01' && JSON.stringify(p.todos) === JSON.stringify([{ n: 1, state: '未', text: 'a' }, { n: 2, state: '済', text: 'b' }]), r.out);
}

// ---- search ----

console.log('--- search');
const searchFiles: Record<string, string> = {
	[Todo + A]: issueText({ id: 'i261103-01', title: '表のまま出す', group: 'html2md' }, '\n項目の中の表を、表のまま出す。\nHTML2MD の話\n'),
	[Doing + B]: issueText({ id: 'i261103-02', title: '幅', group: 'less' }, '\n折り返しの幅を決める。表のこと\n'),
	[Done + C]: issueText({ id: 'i261103-03', title: '済の件', group: 'html2md' }, '\n昔の表の件\n'),
	[Archived + 'i261103-04-d.md']: issueText({ id: 'i261103-04', title: '退避の件', group: 'less' }, '\n退避した表の話\n'),
};
{
	const dir = std('search', searchFiles);
	const r = run(['search', '表のまま'], dir);
	check('search は、題と本文から探す (既定は未・着手)', r.code === 0 && idsOf(r.out).join(',') === 'i261103-01', r.out);
	check('search の出力に、一致した行 (L<行番号>: …) が出る', /L\d+: .*表のまま/.test(r.out), r.out);
	check('search の最後の行は件数', r.out.split('\n').pop() === '1 件', r.out);
	check('既定の範囲は未・着手だけ (done/ ・ archived/ は読まない)', idsOf(run(['search', '表'], dir).out).join(',') === 'i261103-01,i261103-02');
	check('--all は 4 つのフォルダすべて', idsOf(run(['search', '表', '--all'], dir).out).join(',') === 'i261103-01,i261103-02,i261103-03,i261103-04');
	check('--state 済 は done/ だけ', idsOf(run(['search', '表', '--state', '済'], dir).out).join(',') === 'i261103-03');
	check('--group で絞れる (未・着手の less)', idsOf(run(['search', '表', '--group', 'less'], dir).out).join(',') === 'i261103-02');
	check('英字は大小を区別しない (html2md で HTML2MD を探せる)', idsOf(run(['search', 'html2md'], dir).out).includes('i261103-01'));
	check('見つからなければ「0 件」で終了コード 0', (() => { const x = run(['search', '存在しない語'], dir); return x.code === 0 && x.out === '0 件'; })());
	check('探す語が無ければ終了コード 5', run(['search'], dir).code === 5);
	check('search の出力に、絶対パスを出さない', !run(['search', '表'], dir).out.includes(dir));
	const j = run(['search', '表のまま', '--json'], dir);
	let arr: { id?: string; state?: string; folder?: string; group?: string; title?: string; file?: string; matches?: { line: number; text: string }[] }[] = [];
	try { arr = JSON.parse(j.out); } catch { /* 下で失敗にする */ }
	check('--json は、課題の配列 (id ・ state ・ folder ・ group ・ title ・ file ・ matches[{ line, text }])',
		Array.isArray(arr) && arr.length === 1 && arr[0].id === 'i261103-01' && arr[0].folder === 'todo' && arr[0].file === Todo + A && (arr[0].matches ?? []).length >= 1 && typeof arr[0].matches?.[0].line === 'number', j.out);
}
{
	const lots = Array.from({ length: 6 }, (_, i) => `行${i} 表\n`).join('');
	const dir = std('search-limit', { [Todo + A]: issueText({}, '\n' + lots) });
	const r = run(['search', '表'], dir);
	check('一致した行は、1 件の課題につき 3 行までを出す', (r.out.match(/L\d+:/g) ?? []).length === 3, r.out);
}
{
	// 213-A: --regex を付けたときだけ、正規表現として探す
	const dir = std('search-regex', searchFiles);
	check('213-A: --regex なしでは、| も文字として探す (0 件)', run(['search', '表のまま|折り返し'], dir).out === '0 件');
	check('213-A: --regex で A|B を探せる', idsOf(run(['search', '表のまま|折り返し', '--regex'], dir).out).join(',') === 'i261103-01,i261103-02');
	check('213-A: --regex でも英字の大小を区別しない', idsOf(run(['search', 'html2md\\s*の話', '--regex'], dir).out).includes('i261103-01'));
	check('213-A: --regex に壊れた式を渡したら終了コード 5', run(['search', '表(', '--regex'], dir).code === 5);
	check('213-A: --regex なしなら、記号を含む語もそのまま探せる (表( は 0 件で終了コード 0)', (() => { const x = run(['search', '表('], dir); return x.code === 0 && x.out === '0 件'; })());
}

// ---- archive ・ unarchive ----

console.log('--- archive ・ unarchive');
const groupFiles: Record<string, string> = {
	[Done + A]: issueText({ id: 'i261103-01', group: 'less' }),
	[Done + B]: issueText({ id: 'i261103-02', group: 'less' }, '\n## やること\n- [済] a\n'),
	[Done + C]: issueText({ id: 'i261103-03', group: 'html2md' }),
};
{
	const dir = std('archive', groupFiles);
	const r = run(['archive', 'less'], dir);
	check('archive <group>: グループの全件が済なら、done/ から archived/ へ動かす', r.code === 0 && exists(dir, Archived + A) && exists(dir, Archived + B) && !exists(dir, Done + A) && !exists(dir, Done + B), r.out + r.err);
	check('archive の出力に、件数と archived/ が出る', r.out.includes('2 件') && r.out.includes('archived/'), r.out);
	check('別のグループの課題は動かさない', exists(dir, Done + C));
	check('archive したあとのプロジェクトは、issue check が通る', run(['check'], dir).code === 0, run(['check'], dir).out);
	const again = run(['archive', 'less'], dir);
	check('もう動かすものが無ければ、終了コード 0 (「既に」と出す)', again.code === 0 && again.out.includes('既に'), again.out);
}
{
	const dir = std('archive-open', { ...groupFiles, [Todo + 'i261103-04-d.md']: issueText({ id: 'i261103-04', group: 'less' }) });
	const r = run(['archive', 'less'], dir);
	check('グループに未・着手の課題が残っていれば、1 件も動かさず終了コード 1 (その id を出す)', r.code === 1 && exists(dir, Done + A) && !exists(dir, Archived + A) && (r.out + r.err).includes('i261103-04'), r.out + r.err);
}
{
	const dir = std('archive-bad-done', { ...groupFiles, [Done + 'i261103-05-e.md']: issueText({ id: 'i261103-05', group: 'less' }, '\n## やること\n- [未] x\n') });
	const r = run(['archive', 'less'], dir);
	check('done/ の課題が済の条件を満たさなければ (やることが残る)、1 件も動かさず終了コード 1', r.code === 1 && exists(dir, Done + A) && !exists(dir, Archived + A), r.out + r.err);
}
{
	const dir = std('archive-nogroup', groupFiles);
	check('課題が 1 件も無いグループは終了コード 1', run(['archive', 'nothing'], dir).code === 1);
	check('グループが無ければ終了コード 5', run(['archive'], dir).code === 5);
}
{
	const dir = std('archive-broken', { ...groupFiles, [Todo + 'i261103-09-z.md']: 'メタ情報が無い\n' });
	const r = run(['archive', 'less'], dir);
	check('メタ情報が読めない課題があれば、グループを判定できないので、1 件も動かさず終了コード 1', r.code === 1 && exists(dir, Done + A) && !exists(dir, Archived + A), r.out + r.err);
}
{
	const dir = std('unarchive', { [Archived + A]: issueText({ id: 'i261103-01', group: 'less' }), [Archived + B]: issueText({ id: 'i261103-02', group: 'less' }), [Archived + C]: issueText({ id: 'i261103-03', group: 'html2md' }) });
	const r = run(['unarchive', 'less'], dir);
	check('unarchive <group>: archived/ のグループの課題を、done/ へ戻す', r.code === 0 && exists(dir, Done + A) && exists(dir, Done + B) && !exists(dir, Archived + A) && exists(dir, Archived + C), r.out + r.err);
	check('戻したあとのプロジェクトは、issue check が通る', run(['check'], dir).code === 0, run(['check'], dir).out);
	check('archived/ に無いグループの unarchive は終了コード 1', run(['unarchive', 'nothing'], dir).code === 1);
}
{
	const dir = std('archive-json', groupFiles);
	const r = run(['archive', 'less', '--json'], dir);
	let p: { group?: string; moved?: string[]; count?: number } = {};
	try { p = JSON.parse(r.out); } catch { /* 下で失敗にする */ }
	check('--json は { group, moved, count } を出す', p.group === 'less' && JSON.stringify(p.moved) === JSON.stringify(['i261103-01', 'i261103-02']) && p.count === 2, r.out);
}
{
	const dir = std('archive-git', groupFiles);
	git(dir, 'init', '-q', '-b', 'develop');
	git(dir, 'add', '-A');
	git(dir, 'commit', '-q', '-m', 'init');
	const r = run(['archive', 'less'], dir);
	const status = git(dir, 'status', '--porcelain');
	check('git の管理下なら、archive も git mv で動かす (ステージされた rename が 2 件)', r.code === 0 && (status.match(/^R /gm) ?? []).length === 2, r.out + r.err + ' / ' + status);
}
{
	const dir = std('new-archived-group', { [Archived + A]: issueText({ id: 'i261103-01', group: 'less' }) });
	const r = run(['new', '--title', '新しい件', '--group', 'less'], dir);
	check('グループが archived/ に退避済みなら、new は終了コード 5 (112-A。unarchive を促す。何も作らない)', r.code === 5 && (r.out + r.err).includes('unarchive') && !exists(dir, Todo), r.out + r.err);
	run(['unarchive', 'less'], dir);
	check('unarchive で戻せば、new できる', run(['new', '--title', '新しい件', '--group', 'less'], dir).code === 0);
}

// ---- 214-A: archive <番号> で、済の課題を 1 件だけ保管する ・ 215-A: 一部が保管されていても new を止めない ----
{
	const dir = std('archive-one', groupFiles);
	const r = run(['archive', 'i261103-01'], dir);
	check('214-A: archive <番号> は、済の課題 1 件だけを archived/ へ動かす', r.code === 0 && exists(dir, Archived + A) && !exists(dir, Done + A) && exists(dir, Done + B), r.out + r.err);
	check('214-A: 1 件の archive の出力に、番号と archived/ が出る', r.out.includes('i261103-01') && r.out.includes('archived/'), r.out);
	check('214-A: 1 件の archive のあと、issue check が通る', run(['check'], dir).code === 0, run(['check'], dir).out);
	check('214-A: 既に archived/ にある番号は、終了コード 0 (「既に」と出す)', (() => { const x = run(['archive', 'i261103-01'], dir); return x.code === 0 && x.out.includes('既に'); })());
	check('215-A: 同じグループに済の課題が残っていれば、new はそのグループに立てられる', run(['new', '--title', '新しい件', '--group', 'less'], dir).code === 0);
}
{
	const dir = std('archive-one-open', { ...groupFiles, [Todo + 'i261103-04-d.md']: issueText({ id: 'i261103-04', group: 'less' }) });
	const r = run(['archive', 'i261103-04'], dir);
	check('214-A: 未・着手の課題は、1 件の archive でも動かさず終了コード 1', r.code === 1 && exists(dir, Todo + 'i261103-04-d.md'), r.out + r.err);
	const bad = run(['archive', 'i261103-02'], std('archive-one-bad', { ...groupFiles, [Done + B]: issueText({ id: 'i261103-02', group: 'less' }, '\n## やること\n- [未] x\n') }));
	check('214-A: 済の条件を満たさない課題は、1 件の archive でも動かさず終了コード 1', bad.code === 1, bad.out + bad.err);
	check('214-A: 無い番号の archive は終了コード 1', run(['archive', 'i269999-01'], dir).code === 1);
	check('215-A: 同じグループに未の課題が残っていれば、archived/ に同じグループがあっても new は通る',
		(() => { const d = std('new-split-group', { [Archived + A]: issueText({ id: 'i261103-01', group: 'less' }), [Doing + B]: issueText({ id: 'i261103-02', group: 'less' }) }); return run(['new', '--title', '新しい件', '--group', 'less'], d).code === 0; })());
}

// ---- confirm ----

console.log('--- confirm');
const fromFalse = issueText({ from: 'project-a #1', confirmed: 'false' });
const fromTrue = issueText({ from: 'project-a #1', confirmed: 'true' });
{
	const dir = std('confirm-basic', { [Todo + A]: fromFalse });
	const r = run(['confirm', 'i261103-01'], dir);
	check('confirm は、confirmed を true に直す (その行だけ。ほかは変えない)', r.code === 0 && read(dir, Todo + A) === fromTrue, r.out + r.err + ' / ' + read(dir, Todo + A));
	check('confirm の出力に、true と報告元が出る (絶対パスは出ない)', r.out.includes('true') && r.out.includes('project-a #1') && !r.out.includes(dir), r.out);
	const u = run(['confirm', 'i261103-01', '--undo'], dir);
	check('--undo は、confirmed を false に戻す', u.code === 0 && read(dir, Todo + A) === fromFalse, u.out + u.err);
}
{
	const dir = std('confirm-already', { [Todo + A]: fromTrue });
	const r = run(['confirm', 'i261103-01'], dir);
	check('既に true なら、何もせず終了コード 0 (「既に」と出す)', r.code === 0 && r.out.includes('既に') && read(dir, Todo + A) === fromTrue, r.out);
}
{
	const dir = std('confirm-nofrom', { [Todo + A]: issueText() });
	const before = read(dir, Todo + A);
	const r = run(['confirm', 'i261103-01'], dir);
	check('from が無い課題は、終了コード 5 (confirmed は要らない。ファイルは変えない)', r.code === 5 && read(dir, Todo + A) === before, r.out + r.err);
}
{
	const dir = std('confirm-nokey', { [Todo + A]: issueText({ from: 'project-a #1' }) });
	const r = run(['confirm', 'i261103-01'], dir);
	check('from はあるが confirmed のキーが無いときは、from の次に confirmed: true を足す', r.code === 0 && read(dir, Todo + A) === fromTrue, r.out + r.err + ' / ' + read(dir, Todo + A));
}
{
	const dir = std('confirm-undo-done', { [Done + A]: fromTrue });
	const r = run(['confirm', 'i261103-01', '--undo'], dir);
	check('done/ にある課題の確認は、false に戻せない (終了コード 1。先に issue set --state 着手)', r.code === 1 && read(dir, Done + A) === fromTrue, r.out + r.err);
}
{
	const dir = std('confirm-fix-done', { [Done + A]: fromFalse });
	check('done/ に置かれて確認が false の課題 (直接動かした誤り) は、confirm で直せる', run(['confirm', 'i261103-01'], dir).code === 0 && run(['check'], dir).code === 0, run(['check'], dir).out);
}
{
	const dir = std('confirm-then-set', { [Doing + A]: fromFalse });
	check('確認が false のあいだは、済にできない', run(['set', 'i261103-01', '--state', '済'], dir).code === 1);
	run(['confirm', 'i261103-01'], dir);
	check('confirm したあとは、済にできる (やることが無ければ)', run(['set', 'i261103-01', '--state', '済'], dir).code === 0 && exists(dir, Done + A));
}
{
	const dir = std('confirm-args', { [Todo + A]: fromFalse });
	check('見つからない id は終了コード 1', run(['confirm', 'i261103-99'], dir).code === 1);
	check('id の形でない引数は終了コード 5', run(['confirm', 'xyz'], dir).code === 5);
	check('id が無ければ終了コード 5', run(['confirm'], dir).code === 5);
	check('知らないオプションは終了コード 5', run(['confirm', 'i261103-01', '--bogus'], dir).code === 5);
}
{
	const dir = std('confirm-crlf', { [Todo + A]: fromFalse.split('\n').join('\r\n') });
	const before = read(dir, Todo + A);
	check('CRLF のファイルは書き換えない (終了コード 1。issue check で直す)', run(['confirm', 'i261103-01'], dir).code === 1 && read(dir, Todo + A) === before);
}
{
	const dir = std('confirm-json', { [Todo + A]: fromFalse });
	const r = run(['confirm', 'i261103-01', '--json'], dir);
	let p: { id?: string; confirmed?: boolean; from?: string; changed?: boolean; file?: string } = {};
	try { p = JSON.parse(r.out); } catch { /* 下で失敗にする */ }
	check('--json は { id, confirmed, from, changed, file } を出す', p.id === 'i261103-01' && p.confirmed === true && p.from === 'project-a #1' && p.changed === true && p.file === Todo + A, r.out);
}

console.log('');
console.log(`=== issue (更新の操作): ${pass} 件成功 ・ ${fail} 件失敗 ===`);
fs.rmSync(work, { recursive: true, force: true });
process.exit(fail === 0 ? 0 : 1);
