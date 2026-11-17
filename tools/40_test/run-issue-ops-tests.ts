/*
	issue（課題管理ツール）のフェーズ 2 の前半のテスト: init ・ new ・ show ・ list。
	計画は p261103-01、仕様は notes/50_spec/課題ファイルの形と検査.html。

	状態は、置いてあるフォルダ (todo / doing / done / archived) で持つ (計画の 126-A)。
	期待値は、仕様から先に手で書いた（実装の出力から作っていない）。
	本物のプロジェクトには触らない。tmp/ の下に、ケースごとの小さなプロジェクトを作る。
	日付は、環境変数 ISSUE_TEST_TODAY で固定する (本番の道具は、環境変数が無ければ JST の今日)。

	人を表す値は example.com のような仮の値にする（共通ルール「テストのルール」）。
*/
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..', '..');
const work = path.join(root, 'tmp', 'issue-ops-tests');
const main = path.join(root, 'src', 'issue', 'main.ts');

let pass = 0;
let fail = 0;
function check(name: string, ok: boolean, detail: string = ''): void {
	if (ok) { pass++; console.log('  ✅ [OK] ' + name); }
	else { fail++; console.log('  ❌ [NG] ' + name + (detail ? '  ' + detail : '')); }
}

function fwd(p: string): string {
	return p.split('\\').join('/');
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

const KeyOrder = ['schema', 'id', 'title', 'group', 'created', 'from', 'confirmed', 'refs', 'version', 'released', 'kind', 'note'];
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

function envOf(env: Record<string, string>): Record<string, string> {
	return { ...process.env, ISSUE_TEST_TODAY: Today, ...env } as Record<string, string>;
}

function run(args: string[], cwd: string, env: Record<string, string> = {}): Result {
	const r = spawnSync(process.execPath, [main, ...args], { cwd, env: envOf(env), encoding: 'utf8', timeout: 60000 });
	return { code: r.status ?? -1, out: (r.stdout ?? '').trim(), err: (r.stderr ?? '').trim() };
}

function runAsync(args: string[], cwd: string): Promise<Result> {
	return new Promise((resolve) => {
		const child = spawn(process.execPath, [main, ...args], { cwd, env: envOf({}) });
		let out = '';
		let err = '';
		child.stdout.on('data', (d) => { out += String(d); });
		child.stderr.on('data', (d) => { err += String(d); });
		child.on('close', (code) => resolve({ code: code ?? -1, out: out.trim(), err: err.trim() }));
	});
}

function newIssue(dir: string, extra: string[], env: Record<string, string> = {}): Result {
	return run(['new', '--root', dir, ...extra], dir, env);
}

function read(dir: string, rel: string): string {
	try { return fs.readFileSync(path.join(dir, rel), 'utf8'); } catch { return ''; }
}

function exists(dir: string, rel: string): boolean {
	return fs.existsSync(path.join(dir, rel));
}

/** フォルダの中身の名前。フォルダが無ければ空 (実装が無くても、テストが落ちずに失敗として数えるため) */
function listDir(dir: string, rel: string): string[] {
	try { return fs.readdirSync(path.join(dir, rel)); } catch { return []; }
}

const Basic = ['--title', 'li の中の表', '--group', 'html2md'];

// ---- init ----

console.log('--- init');
{
	const dir = mkProject('init-new', { 'README.md': '# x\n' });
	const r = run(['init', '--root', dir], dir);
	const text = read(dir, Items + 'project-uuid.txt');
	check('init は project-uuid.txt を作る (schema 2 ・ 小文字 32 桁の project_uuid ・ フォルダ名の project_id)', r.code === 0 && /^schema: 2\nproject_uuid: [0-9a-f]{32}\nproject_id: init-new\n$/.test(text), r.out + ' / ' + text);
	check('init したプロジェクトは、issue check が通る', run(['check', '--root', dir], dir).code === 0);
	check('init は状態のフォルダを作らない (空フォルダを作らない)', listDir(dir, Items).join(',') === 'project-uuid.txt');
	check('init の出力に絶対パスを出さない', !r.out.includes(dir) && !r.out.includes(fwd(dir)), r.out);
}
{
	const dir = std('init-exists');
	const r = run(['init', '--root', dir], dir);
	check('project-uuid.txt が既にあれば、変えずに終了コード 0 (「既にある」と出す)', r.code === 0 && r.out.includes('既にある') && read(dir, Items + 'project-uuid.txt') === uuidText('init-exists'), r.out);
}
{
	const dir = std('init-newid');
	const r = run(['init', '--root', dir, '--new-id'], dir);
	const text = read(dir, Items + 'project-uuid.txt');
	check('--new-id は project_uuid を振り直す (形と project_id は同じで、乱数が変わる)', r.code === 0 && /^schema: 2\nproject_uuid: [0-9a-f]{32}\nproject_id: init-newid\n$/.test(text) && text !== uuidText('init-newid'), r.out + ' / ' + text);
}
{
	const lonely = fs.mkdtempSync(path.join(os.tmpdir(), 'issue-ops-'));
	try {
		const r = run(['init'], lonely);
		check('--root が無く、プロジェクトが見つからなければ、作業フォルダに作る', r.code === 0 && exists(lonely, Items + 'project-uuid.txt'), r.out + r.err);
	} finally {
		fs.rmSync(lonely, { recursive: true, force: true });
	}
}
{
	const dir = std('init-args');
	check('init に知らないオプションを渡せば終了コード 5', run(['init', '--bogus'], dir).code === 5);
}

// ---- new ----

console.log('--- new');
{
	const dir = std('new-basic');
	const r = newIssue(dir, Basic);
	const rel = Todo + 'i261105-01-li-の中の表.md';
	check('new は todo/ に <id>-<件名>.md を作る (id は今日の日付と連番 01)', r.code === 0 && exists(dir, rel), r.out + r.err);
	check('new が作るファイルの中身 (キーは仕様の順。state は無い。本文は空行 1 つ)',
		read(dir, rel) === '---\nschema: 1\nid: i261105-01\ntitle: li の中の表\ngroup: html2md\ncreated: 2026-11-05\n---\n\n', read(dir, rel));
	check('new の出力に、id と相対パスが出て、絶対パスは出ない', r.out.includes('i261105-01') && r.out.includes('notes/40_issues/items/todo/') && !r.out.includes(dir) && !r.out.includes(fwd(dir)), r.out);
	check('new したあとのプロジェクトは、issue check が通る', run(['check', '--root', dir], dir).code === 0, run(['check', '--root', dir], dir).out);
	let bytes: Buffer = Buffer.alloc(0);
	try { bytes = fs.readFileSync(path.join(dir, rel)); } catch { /* 実装が無いとき。下で失敗にする */ }
	check('new のファイルは UTF-8 (BOM 無し) ・ LF', bytes.length > 0 && !(bytes[0] === 0xef && bytes[1] === 0xbb) && !bytes.includes(0x0d));
}
{
	const dir = std('new-seq');
	newIssue(dir, Basic);
	const r = newIssue(dir, ['--title', '二つ目', '--group', 'html2md']);
	check('同じ日の 2 件目は連番 02', r.code === 0 && r.out.includes('i261105-02'), r.out);
}
{
	const dir = std('new-day');
	newIssue(dir, Basic);
	const r = newIssue(dir, ['--title', '翌日', '--group', 'html2md'], { ISSUE_TEST_TODAY: '2026-11-06' });
	check('日が変われば、連番は 01 から (i261106-01)', r.code === 0 && r.out.includes('i261106-01'), r.out);
}
{
	const dir = std('new-after', {
		[Todo + 'i261105-05-x.md']: issueText({ id: 'i261105-05' }),
		[Done + 'i261105-09-y.md']: issueText({ id: 'i261105-09' }),
	});
	const r = newIssue(dir, Basic);
	check('連番は、どの状態のフォルダにあっても、その日の最大の次 (09 の次は 36 進数の 0a)', r.code === 0 && r.out.includes('i261105-0a'), r.out);
}
{
	const dir = std('new-36', { [Todo + 'i261105-0k-x.md']: issueText({ id: 'i261105-0k' }) });
	const r = newIssue(dir, Basic);
	check('0k の次は、l を欠番にして 0m (共通ルール、ai-agent-rules #1903)', r.code === 0 && r.out.includes('i261105-0m'), r.out);
}
{
	const dir = std('new-35', { [Todo + 'i261105-0z-x.md']: issueText({ id: 'i261105-0z' }) });
	const r = newIssue(dir, Basic);
	check('0z の次は 10 (l を除く 35 字で桁が上がる)', r.code === 0 && r.out.includes('i261105-10'), r.out);
}
{
	const dir = std('new-legacy-L', { [Todo + 'i261105-0L-x.md']: issueText({ id: 'i261105-0L' }) });
	const r = newIssue(dir, Basic);
	check('前からある 0L の次は 0m (0L は k と m の間に数える)', r.code === 0 && r.out.includes('i261105-0m'), r.out);
}
{
	const dir = std('new-slug');
	const r = newIssue(dir, [...Basic, '--slug', '表の件']);
	check('--slug で件名を決められる', r.code === 0 && exists(dir, Todo + 'i261105-01-表の件.md'), r.out + r.err);
}
{
	const dir = std('new-slug-space');
	check('--slug に空白があれば終了コード 5 (ファイルを作らない)', newIssue(dir, [...Basic, '--slug', 'a b']).code === 5 && !exists(dir, Todo));
}
{
	const dir = std('new-slug-long');
	check('--slug が 30 文字を超えれば終了コード 5', newIssue(dir, [...Basic, '--slug', 'あ'.repeat(31)]).code === 5);
}
{
	const dir = std('new-slug-symbols');
	const r = newIssue(dir, ['--title', 'a/b:c?d', '--group', 'html2md']);
	check('題の記号は、件名では - に直す (a/b:c?d → a-b-c-d)', r.code === 0 && exists(dir, Todo + 'i261105-01-a-b-c-d.md'), r.out + r.err);
}
{
	const dir = std('new-slug-empty');
	check('題が記号だけで件名が作れなければ終了コード 5 (--slug を促す)', newIssue(dir, ['--title', '???', '--group', 'html2md']).code === 5);
}
{
	const dir = std('new-missing');
	check('--title が無ければ終了コード 5', newIssue(dir, ['--group', 'html2md']).code === 5);
	check('--group が無ければ終了コード 5', newIssue(dir, ['--title', '題']).code === 5);
}
{
	const dir = std('new-groups', { [Items + 'groups.txt']: 'html2md\n' });
	check('groups.txt があり、載っていない group なら終了コード 5', newIssue(dir, ['--title', '題', '--group', 'less']).code === 5 && !exists(dir, Todo));
	check('groups.txt に載っている group なら作れる', newIssue(dir, Basic).code === 0);
}
{
	const dir = std('new-from');
	newIssue(dir, [...Basic, '--from', 'project-a #1']);
	const text = read(dir, Todo + 'i261105-01-li-の中の表.md');
	check('--from を渡せば、from と confirmed: false を書く (キーの順どおり)', text.includes('created: 2026-11-05\nfrom: project-a #1\nconfirmed: false\n---\n'), text);
}
{
	const dir = std('new-refs');
	const r = newIssue(dir, [...Basic, '--refs', 'p261103-01,r261025-01']);
	check('--refs は、カンマ区切りで書く (カンマのあとに空白 1 つ)', r.code === 0 && read(dir, Todo + 'i261105-01-li-の中の表.md').includes('\nrefs: p261103-01, r261025-01\n'), r.out + r.err);
	check('--refs の形が違えば終了コード 5', newIssue(dir, ['--title', 'x', '--group', 'html2md', '--refs', '123']).code === 5);
}
{
	// i261111-07 (262-A)。chat の依頼から課題を立てるとき、依頼の発言の番号を refs に残したい
	const dir = std('new-refs-chat');
	const r = newIssue(dir, [...Basic, '--refs', 'i261103-01,#1923']);
	check('--refs は、chat の発言の番号 (#1923) も、課題番号と並べて書ける', r.code === 0 && read(dir, Todo + 'i261105-01-li-の中の表.md').includes('\nrefs: i261103-01, #1923\n'), r.out + r.err);
	for (const bad of ['#', '#abc', '#1923a', '# 1923', '#0', '##1', 'public#1923']) {
		check(`--refs の ${bad} は、chat の発言の番号の形でないので終了コード 5`, newIssue(dir, ['--title', 'x', '--group', 'html2md', '--refs', bad]).code === 5);
	}
}
{
	const dir = std('new-body');
	newIssue(dir, [...Basic, '--body', '本文です']);
	check('--body は、閉じの --- の次の空行のあとに書く', read(dir, Todo + 'i261105-01-li-の中の表.md').endsWith('---\n\n本文です\n'), read(dir, Todo + 'i261105-01-li-の中の表.md'));
}
{
	const dir = mkProject('new-bootstrap', { 'README.md': '# x\n' });
	const r = newIssue(dir, Basic);
	check('--root で指したプロジェクトに items/ が無くても、new が project-uuid.txt と課題を作る', r.code === 0 && exists(dir, Items + 'project-uuid.txt') &&exists(dir, Todo + 'i261105-01-li-の中の表.md'), r.out + r.err);
	check('new で作ったプロジェクトは、issue check が通る', run(['check', '--root', dir], dir).code === 0);
}
{
	const lonely = fs.mkdtempSync(path.join(os.tmpdir(), 'issue-ops-'));
	try {
		const r = run(['new', ...Basic], lonely);
		check('--root が無く、プロジェクトが見つからなければ終了コード 5 (init を促す)', r.code === 5 && (r.err + r.out).includes('init'), r.err + r.out);
	} finally {
		fs.rmSync(lonely, { recursive: true, force: true });
	}
}
{
	const dir = std('new-json');
	const r = newIssue(dir, [...Basic, '--json']);
	let parsed: { id?: string; file?: string } = {};
	try { parsed = JSON.parse(r.out); } catch { /* 下で失敗にする */ }
	check('--json は { id, file } を出す', parsed.id === 'i261105-01' && parsed.file === Todo + 'i261105-01-li-の中の表.md', r.out);
}
{
	// 試験では、予約の置き場はプロジェクトの _numbers/ (ISSUE_TEST_TODAY があり、AI_AGENT_TOOLS_NUMBERS_DIR が無いとき。p261109-01)
	const dir = std('new-locked');
	const reserved = path.join(dir, '_numbers', 'uuid_7b0c4e1a9f3d4a62b8d51c2e6f90a3b7_new-locked', 'ids', 'i261105-01');
	fs.mkdirSync(reserved, { recursive: true });
	const r = newIssue(dir, Basic);
	check('番号が別の持ち主に予約されていれば、次の番号を取る', r.code === 0 && r.out.includes('i261105-02') && fs.existsSync(reserved), r.out);
}
{
	const dir = std('new-lock-kept');
	newIssue(dir, Basic);
	check('new が終わっても、自分の予約を残す (p261109-01 の 205-A)', fs.existsSync(path.join(dir, '_numbers', 'uuid_7b0c4e1a9f3d4a62b8d51c2e6f90a3b7_new-lock-kept', 'ids', 'i261105-01', 'info.json')));
	check('_lock/ は作らない', !fs.existsSync(path.join(dir, 'notes', '40_issues', '_lock')));
}
{
	const dir = std('new-concurrent');
	const results = await Promise.all([1, 2, 3, 4].map((n) => runAsync(['new', '--root', dir, '--title', '同時 ' + n, '--group', 'html2md'], dir)));
	const ids = results.map((r) => /i261105-[0-9a-kLm-z]{2}/.exec(r.out)?.[0] ?? '');
	check('4 つの new を同時に走らせても、全部成功する', results.every((r) => r.code === 0), results.map((r) => r.code + r.err).join(' / '));
	check('同時の new で、同じ番号を取らない (4 つとも別の id)', new Set(ids).size === 4 && ids.every((i) => i !== ''), ids.join(','));
	check('同時の new のあとも、issue check が通る (重複 ID が無い)', run(['check', '--root', dir], dir).code === 0, run(['check', '--root', dir], dir).out);
}
{
	const dir = std('new-args');
	check('new に知らないオプションを渡せば終了コード 5', newIssue(dir, [...Basic, '--bogus']).code === 5);
}

// ---- show ----

console.log('--- show');
const showFiles: Record<string, string> = {
	[Todo + 'i261103-01-未.md']: issueText({ id: 'i261103-01', title: '未の題' }, '\n本文の一行目\n\n## やること\n- [未] a\n- [済] b\n'),
	[Doing + 'i261103-02-着手.md']: issueText({ id: 'i261103-02', title: '着手の題' }),
	[Done + 'i261103-03-済.md']: issueText({ id: 'i261103-03', title: '済の題' }),
	[Archived + 'i261103-04-退避.md']: issueText({ id: 'i261103-04', title: '退避の題' }),
};
{
	const dir = std('show', showFiles);
	const r = run(['show', 'i261103-01', '--root', dir], dir);
	check('show は、状態 ・ フォルダ ・ 題 ・ 本文を出す (todo/ は 未)', r.code === 0 && r.out.includes('i261103-01') && r.out.includes('未') && r.out.includes('todo/') && r.out.includes('未の題') && r.out.includes('本文の一行目'), r.out);
	check('show の出力に、絶対パスを出さない', !r.out.includes(dir) && !r.out.includes(fwd(dir)), r.out);
	check('doing/ の課題は 着手', run(['show', 'i261103-02', '--root', dir], dir).out.includes('着手'));
	check('done/ の課題は 済', run(['show', 'i261103-03', '--root', dir], dir).out.includes('済'));
	const arch = run(['show', 'i261103-04', '--root', dir], dir);
	check('archived/ の課題は 済 で、archived/ と出る', arch.out.includes('済') && arch.out.includes('archived/'), arch.out);
}
{
	const dir = std('show-json', showFiles);
	const r = run(['show', 'i261103-01', '--root', dir, '--json'], dir);
	let p: { id?: string; state?: string; folder?: string; file?: string; meta?: Record<string, string>; body?: string; todos?: { state: string; text: string }[] } = {};
	try { p = JSON.parse(r.out); } catch { /* 下で失敗にする */ }
	check('--json は id ・ state ・ folder ・ file ・ meta ・ body ・ todos を出す',
		p.id === 'i261103-01' && p.state === '未' && p.folder === 'todo' && p.file === Todo + 'i261103-01-未.md' && p.meta?.title === '未の題' && p.meta?.group === 'html2md' && typeof p.body === 'string' && p.body.includes('本文の一行目'), r.out);
	check('--json の todos は、やることの状態と文', JSON.stringify(p.todos) === JSON.stringify([{ state: '未', text: 'a' }, { state: '済', text: 'b' }]), r.out);
	let arch: { state?: string; folder?: string } = {};
	try { arch = JSON.parse(run(['show', 'i261103-04', '--root', dir, '--json'], dir).out); } catch { /* 下で失敗にする */ }
	check('--json: archived/ の課題は state が 済、folder が archived', arch.state === '済' && arch.folder === 'archived');
}
{
	const dir = std('show-missing', showFiles);
	check('見つからない id は終了コード 1', run(['show', 'i261103-99', '--root', dir], dir).code === 1);
	check('id の形でない引数は終了コード 5', run(['show', 'xyz', '--root', dir], dir).code === 5);
	check('id が無ければ終了コード 5', run(['show', '--root', dir], dir).code === 5);
}
{
	const dir = std('show-dup', {
		[Todo + 'i261103-01-a.md']: issueText({ id: 'i261103-01' }),
		[Done + 'i261103-01-b.md']: issueText({ id: 'i261103-01' }),
	});
	const r = run(['show', 'i261103-01', '--root', dir], dir);
	check('同じ id のファイルが複数あれば終了コード 1 (複数あると出す)', r.code === 1 && (r.err + r.out).includes('複数'), r.err + r.out);
}

// ---- list ----

console.log('--- list');
const listFiles: Record<string, string> = {
	[Todo + 'i261103-01-a.md']: issueText({ id: 'i261103-01', title: '一つ目', group: 'html2md' }),
	[Todo + 'i261103-02-b.md']: issueText({ id: 'i261103-02', title: '二つ目', group: 'less' }),
	[Doing + 'i261103-03-c.md']: issueText({ id: 'i261103-03', title: '三つ目', group: 'html2md' }),
	[Done + 'i261103-04-d.md']: issueText({ id: 'i261103-04', title: '四つ目', group: 'html2md' }),
	[Archived + 'i261103-05-e.md']: issueText({ id: 'i261103-05', title: '五つ目', group: 'less' }),
};
function ids(out: string): string[] {
	return out.split('\n').map((l) => /i\d{6}-[0-9a-kLm-z]{2}/.exec(l)?.[0] ?? '').filter((s) => s !== '');
}
{
	const dir = std('list', listFiles);
	const r = run(['list', '--root', dir], dir);
	check('list の既定は、未・着手 (todo/ と doing/) だけ', r.code === 0 && ids(r.out).join(',') === 'i261103-01,i261103-02,i261103-03', r.out);
	check('list の最後の行は件数', r.out.split('\n').pop() === '3 件', r.out);
	check('list の行には、id ・ 状態 ・ group ・ 題が出る', r.out.includes('着手') && r.out.includes('三つ目') && r.out.includes('less'), r.out);
	check('list の出力に、絶対パスを出さない', !r.out.includes(dir) && !r.out.includes(fwd(dir)), r.out);
	check('--state 済 は done/ だけ', ids(run(['list', '--root', dir, '--state', '済'], dir).out).join(',') === 'i261103-04');
	check('--state 未,着手 は、既定と同じ', ids(run(['list', '--root', dir, '--state', '未,着手'], dir).out).join(',') === 'i261103-01,i261103-02,i261103-03');
	check('--state archived は archived/ だけ', ids(run(['list', '--root', dir, '--state', 'archived'], dir).out).join(',') === 'i261103-05');
	check('--all は 4 つのフォルダすべて', ids(run(['list', '--root', dir, '--all'], dir).out).join(',') === 'i261103-01,i261103-02,i261103-03,i261103-04,i261103-05');
	check('--group で絞れる (未・着手の less)', ids(run(['list', '--root', dir, '--group', 'less'], dir).out).join(',') === 'i261103-02');
	check('--state に知らない語を渡せば終了コード 5', run(['list', '--root', dir, '--state', '完了'], dir).code === 5);
	const j = run(['list', '--root', dir, '--json'], dir);
	let arr: { id?: string; state?: string; folder?: string; group?: string; title?: string; created?: string; file?: string }[] = [];
	try { arr = JSON.parse(j.out); } catch { /* 下で失敗にする */ }
	check('--json は、課題の配列 (id 順。id ・ state ・ folder ・ group ・ title ・ created ・ file)',
		Array.isArray(arr) && arr.map((a) => a.id).join(',') === 'i261103-01,i261103-02,i261103-03' && arr[2].state === '着手' && arr[2].folder === 'doing' && arr[0].title === '一つ目' && arr[0].created === '2026-11-03' && arr[0].file === Todo + 'i261103-01-a.md', j.out);
}
{
	const dir = std('list-sort', {
		[Doing + 'i261103-09-z.md']: issueText({ id: 'i261103-09' }),
		[Todo + 'i261103-05-a.md']: issueText({ id: 'i261103-05' }),
		[Todo + 'i261102-0a-b.md']: issueText({ id: 'i261102-0a' }),
	});
	check('list は、フォルダに関わらず id の順に並べる', ids(run(['list', '--root', dir], dir).out).join(',') === 'i261102-0a,i261103-05,i261103-09');
}
{
	const dir = std('list-empty');
	const r = run(['list', '--root', dir], dir);
	check('課題が無ければ「0 件」で終了コード 0', r.code === 0 && r.out === '0 件', r.out);
}
{
	const dir = std('list-broken', {
		[Todo + 'i261103-01-a.md']: issueText({ id: 'i261103-01' }),
		[Todo + 'i261103-02-b.md']: 'メタ情報が無い\n',
	});
	const r = run(['list', '--root', dir], dir);
	check('メタ情報が読めない課題は、飛ばして警告を出す (終了コードは 0)', r.code === 0 && ids(r.out).join(',') === 'i261103-01' && (r.err + r.out).includes('[警告]'), r.out + r.err);
}
{
	const dir = std('list-args');
	check('list に知らないオプションを渡せば終了コード 5', run(['list', '--root', dir, '--bogus'], dir).code === 5);
}

// ---- set で version ・ released ・ kind ・ note を書く (課題 i261117-03。決定 269-A 〜 272-B) ----

console.log('--- set の version ・ released ・ kind ・ note');
const FieldFile = Todo + 'i261103-01-a.md';
const FieldRel = (n: string): string => Todo + n;
{
	// 知らない鍵 (x_foo) を持つ課題に version を書いても、x_foo が残る
	const text = issueText({ refs: '#1923', x_foo: 'bar' });
	const dir = std('fields-unknown', { [FieldFile]: text });
	const r = run(['set', 'i261103-01', '--root', dir, '--version', '0.0.1347'], dir);
	const after = read(dir, FieldFile);
	check('--version を書ける (終了コード 0)', r.code === 0, r.out + r.err);
	check('知らない鍵 x_foo が残る', after.includes('\nx_foo: bar\n'), after);
	check('version は refs の後ろ (鍵の順の位置) に入り、ほかの行は変わらない',
		after === text.replace('refs: #1923\n', 'refs: #1923\nversion: 0.0.1347\n'), after);
	const again = run(['set', 'i261103-01', '--root', dir, '--version', '0.0.1347'], dir);
	check('同じ値をもう一度書いても、ファイルは変わらない', again.code === 0 && read(dir, FieldFile) === after, again.out + again.err);
}
{
	// 4 つを一度に。鍵の順は version → released → kind → note
	const dir = std('fields-all', { [FieldFile]: issueText({ refs: '#1923' }) });
	const r = run(['set', 'i261103-01', '--root', dir, '--note', '右下の表示が v0.0.1347: … の形に。', '--kind', 'fix', '--released', '2026-11-17 11:30', '--version', '0.0.1347'], dir);
	const after = read(dir, FieldFile);
	check('4 つを一度に書ける', r.code === 0, r.out + r.err);
	check('鍵の順は refs → version → released → kind → note',
		after.includes('refs: #1923\nversion: 0.0.1347\nreleased: 2026-11-17 11:30\nkind: fix\nnote: 右下の表示が v0.0.1347: … の形に。\n---\n'), after);
	const j = run(['show', 'i261103-01', '--root', dir, '--json'], dir);
	let meta: Record<string, string> = {};
	try { meta = JSON.parse(j.out).meta; } catch { /* 下で失敗にする */ }
	check('show --json の meta に 4 つの鍵が出る',
		meta.version === '0.0.1347' && meta.released === '2026-11-17 11:30' && meta.kind === 'fix' && meta.note === '右下の表示が v0.0.1347: … の形に。', j.out);
	const t = run(['show', 'i261103-01', '--root', dir], dir);
	check('show の表示に 4 つの鍵が出る', t.out.includes('version: 0.0.1347') && t.out.includes('released: 2026-11-17 11:30') && t.out.includes('kind: fix') && t.out.includes('note:'), t.out);
	check('書いたあとの issue check は、警告も出ない', run(['check', '--root', dir], dir).out.includes('問題なし') && !run(['check', '--root', dir], dir).out.includes('[警告]'), run(['check', '--root', dir], dir).out);
}
{
	// note の複数行 ・ コロン ・ 引用符は、読み戻して同じ文字列になる
	const note = '1 行目\n2 行目: コロンと "引用符" と \'一重\'\n  字下げの行\n\n空行のあと';
	const dir = std('fields-note', { [FieldFile]: issueText() });
	const r = run(['set', 'i261103-01', '--root', dir, '--note', note], dir);
	check('複数行の note を書ける', r.code === 0, r.out + r.err);
	const after = read(dir, FieldFile);
	check('複数行の note は、| の塊 (次の行から 2 字下げ) で書く',
		after.includes('note: |\n  1 行目\n  2 行目: コロンと "引用符" と \'一重\'\n    字下げの行\n\n  空行のあと\n---\n'), after);
	let meta: Record<string, string> = {};
	try { meta = JSON.parse(run(['show', 'i261103-01', '--root', dir, '--json'], dir).out).meta; } catch { /* 下で失敗にする */ }
	check('読み戻すと、同じ文字列になる', meta.note === note, JSON.stringify(meta.note));
	check('書いたあとの issue check は、エラーも警告も出ない', run(['check', '--root', dir], dir).code === 0 && !run(['check', '--root', dir], dir).out.includes('[警告]'), run(['check', '--root', dir], dir).out);
}
{
	// 1 行でも、塊にしないと読み戻せない値は塊で書く
	for (const note of ['|', '| 先頭が縦線', ' 先頭に空白']) {
		const dir = std('fields-note-edge', { [FieldFile]: issueText() });
		run(['set', 'i261103-01', '--root', dir, '--note', note], dir);
		let meta: Record<string, string> = {};
		try { meta = JSON.parse(run(['show', 'i261103-01', '--root', dir, '--json'], dir).out).meta; } catch { /* 下で失敗にする */ }
		check(`note が ${JSON.stringify(note)} でも、読み戻すと同じ文字列になる`, meta.note === note, JSON.stringify(meta.note) + ' / ' + read(dir, FieldFile));
	}
}
{
	// 値を空にすると鍵を消す (塊の行もすべて消える)。ほかの行は変わらない
	const base = issueText({ refs: '#1923', x_foo: 'bar' });
	const dir = std('fields-clear', { [FieldFile]: base });
	run(['set', 'i261103-01', '--root', dir, '--version', '0.0.1', '--note', 'あ\nい'], dir);
	const r = run(['set', 'i261103-01', '--root', dir, '--version', '', '--note', ''], dir);
	check('値を空にして、鍵を消せる', r.code === 0 && read(dir, FieldFile) === base, r.out + r.err + '\n' + read(dir, FieldFile));
	const none = run(['set', 'i261103-01', '--root', dir, '--kind', ''], dir);
	check('無い鍵を空にしても、エラーにならず、ファイルも変わらない', none.code === 0 && read(dir, FieldFile) === base, none.out + none.err);
}
{
	const dir = std('fields-replace', { [FieldFile]: issueText({ version: '0.0.1', note: '古い\n複数行', x_foo: 'bar' }).replace('note: 古い\n複数行', 'note: |\n  古い\n  複数行') });
	const r = run(['set', 'i261103-01', '--root', dir, '--note', '新しい 1 行'], dir);
	const after = read(dir, FieldFile);
	check('書いてある note (塊) を、新しい値に置き換える (古い塊の行は残らない)', r.code === 0 && after.includes('note: 新しい 1 行\nx_foo: bar\n---\n') && !after.includes('古い') && !after.includes('複数行') && after.includes('x_foo: bar\n'), r.out + r.err + '\n' + after);
}
{
	const dir = std('fields-bad', { [FieldFile]: issueText() });
	const before = read(dir, FieldFile);
	const bad = run(['set', 'i261103-01', '--root', dir, '--released', '2026/11/17 11:30'], dir);
	check('released がスラッシュ区切りなら終了コード 5 (書かない)', bad.code === 5 && read(dir, FieldFile) === before, bad.out + bad.err);
	check('released が実在しない日時なら終了コード 5', run(['set', 'i261103-01', '--root', dir, '--released', '2026-02-30 11:30'], dir).code === 5);
	check('version に改行を含めれば終了コード 5', run(['set', 'i261103-01', '--root', dir, '--version', '1\n2'], dir).code === 5);
	check('何も指定しなければ終了コード 5', run(['set', 'i261103-01', '--root', dir], dir).code === 5);
	check('見つからない id は終了コード 1', run(['set', 'i261103-99', '--root', dir, '--version', '1'], dir).code === 1);
}
{
	const dir = std('fields-state', { [FieldFile]: issueText() });
	const r = run(['set', 'i261103-01', '--root', dir, '--version', '0.0.2', '--state', '着手'], dir);
	check('--state と一緒に指定でき、書いてから動かす', r.code === 0 && read(dir, Doing + 'i261103-01-a.md').includes('version: 0.0.2\n') && !exists(dir, FieldFile), r.out + r.err);
}
{
	const dir = std('fields-bom', { [FieldFile]: '﻿' + issueText() });
	const r = run(['set', 'i261103-01', '--root', dir, '--version', '1'], dir);
	check('BOM のあるファイルは書き換えない (終了コード 1)', r.code === 1 && read(dir, FieldFile) === '﻿' + issueText(), r.out + r.err);
}
{
	const dir = std('fields-json', { [FieldFile]: issueText() });
	const r = run(['set', 'i261103-01', '--root', dir, '--version', '0.0.3', '--json'], dir);
	let p: { id?: string; changed?: string[] } = {};
	try { p = JSON.parse(r.out); } catch { /* 下で失敗にする */ }
	check('--json は、id と、書いた鍵 (changed) を出す', p.id === 'i261103-01' && JSON.stringify(p.changed) === JSON.stringify(['version']), r.out + r.err);
}

{
	// レビュー指摘 1: --state が誤りなら、鍵も書かない (何も変えない)
	const ok = issueText();
	const dir = std('fields-state-fail', { [FieldFile]: ok });
	const r1 = run(['set', 'i261103-01', '--root', dir, '--note', 'x', '--state', '完'], dir);
	check('--state が知らない語なら、終了コード 5 で、鍵も書かない', r1.code === 5 && read(dir, FieldFile) === ok, r1.out + r1.err + '\n' + read(dir, FieldFile));
	const r2 = run(['set', 'i261103-01', '--root', dir, '--released', '2026/11/17 11:30', '--state', '着手'], dir);
	check('鍵の値が誤りなら、終了コード 5 で、状態も動かさない', r2.code === 5 && read(dir, FieldFile) === ok && !exists(dir, Doing + 'i261103-01-a.md'), r2.out + r2.err);
	const withOpen = std('fields-state-open', { [FieldFile]: issueText({}, '\n本文\n\n## やること\n- [未] a\n') });
	const r3 = run(['set', 'i261103-01', '--root', withOpen, '--note', 'x', '--state', '済'], withOpen);
	check('やることが残っていて済にできなければ、終了コード 1 で、鍵も書かない (動かさない)', r3.code === 1 && read(withOpen, FieldFile) === issueText({}, '\n本文\n\n## やること\n- [未] a\n'), r3.out + r3.err);
	const arch = std('fields-state-archived', { [Archived + 'i261103-01-a.md']: ok });
	const r4 = run(['set', 'i261103-01', '--root', arch, '--note', 'x', '--state', '済'], arch);
	check('archived/ の課題に --state 済 を付ければ、終了コード 1 で、鍵も書かない', r4.code === 1 && read(arch, Archived + 'i261103-01-a.md') === ok, r4.out + r4.err);
	const r5 = run(['set', 'i261103-01', '--root', arch, '--note', 'x'], arch);
	check('archived/ の課題にも、鍵だけなら書ける (状態を問わない。file-manager の依頼)', r5.code === 0 && read(arch, Archived + 'i261103-01-a.md').includes('note: x\n'), r5.out + r5.err);
}
{
	// レビュー指摘 4: 塊の中の空行は、空行のままでも、2 字の空白だけの行でも読める (末尾の空白を消すエディタ対策)
	const body = '---\nschema: 1\nid: i261103-01\ntitle: 題\ngroup: html2md\ncreated: 2026-11-03\nnote: |\n  段落 1\n\n  段落 2\n  \n  段落 3\nx_foo: bar\n---\n本文\n';
	const dir = std('fields-blank', { [FieldFile]: body });
	let meta: Record<string, string> = {};
	try { meta = JSON.parse(run(['show', 'i261103-01', '--root', dir, '--json'], dir).out).meta; } catch { /* 下で失敗にする */ }
	check('塊の中の空行 (空行のまま ・ 2 字の空白だけ) は、続きとして読む', meta.note === '段落 1\n\n段落 2\n\n段落 3' && meta.x_foo === 'bar', JSON.stringify(meta));
	check('空行を含む塊も、issue check はエラーにしない (x_foo の警告だけ)', run(['check', '--root', dir], dir).code === 0 && !run(['check', '--root', dir], dir).out.includes('[meta]'), run(['check', '--root', dir], dir).out);
	const rep = run(['set', 'i261103-01', '--root', dir, '--note', '新しい'], dir);
	check('空行を含む塊を置き換えても、古い行が残らない', rep.code === 0 && read(dir, FieldFile) === body.replace(/note: \|[\s\S]*?(?=x_foo)/, 'note: 新しい\n'), rep.out + rep.err + '\n' + read(dir, FieldFile));
	const dir2 = std('fields-blank-clear', { [FieldFile]: body });
	const clr = run(['set', 'i261103-01', '--root', dir2, '--note', ''], dir2);
	check('空行を含む塊を消しても、古い行が残らない', clr.code === 0 && read(dir2, FieldFile) === body.replace(/note: \|[\s\S]*?(?=x_foo)/, ''), clr.out + clr.err + '\n' + read(dir2, FieldFile));
	// 塊のあとの空行は、塊に含めない (閉じの --- の前の空行は誤りのまま)
	const trailing = '---\nschema: 1\nid: i261103-01\ntitle: 題\ngroup: html2md\ncreated: 2026-11-03\nnote: |\n  あ\n\n---\n本文\n';
	const dir3 = std('fields-blank-trailing', { [FieldFile]: trailing });
	check('塊のあとに続く行が無い空行は、塊に含めず、今までどおり誤り (空行は置けない)', run(['check', '--root', dir3], dir3).code === 1, run(['check', '--root', dir3], dir3).out);
}

console.log('--- list --missing');
{
	const dir = std('missing', {
		[FieldRel('i261103-01-a.md')]: issueText({ id: 'i261103-01', version: '0.0.1', note: 'あ' }),
		[FieldRel('i261103-02-b.md')]: issueText({ id: 'i261103-02', version: '0.0.2' }),
		[FieldRel('i261103-03-c.md')]: issueText({ id: 'i261103-03', note: 'う' }),
		[Doing + 'i261103-04-d.md']: issueText({ id: 'i261103-04' }),
		[Done + 'i261103-05-e.md']: issueText({ id: 'i261103-05' }),
	});
	check('--missing note は、note を持たない課題 (未・着手)', ids(run(['list', '--root', dir, '--missing', 'note'], dir).out).join(',') === 'i261103-02,i261103-04');
	check('--missing version は、version を持たない課題', ids(run(['list', '--root', dir, '--missing', 'version'], dir).out).join(',') === 'i261103-03,i261103-04');
	check('--missing version,note は、どちらかを持たない課題 (複数はカンマ区切り)', ids(run(['list', '--root', dir, '--missing', 'version,note'], dir).out).join(',') === 'i261103-02,i261103-03,i261103-04');
	check('--state ・ --all と一緒に使える', ids(run(['list', '--root', dir, '--missing', 'note', '--all'], dir).out).join(',') === 'i261103-02,i261103-04,i261103-05');
	check('件数の行は、絞った後の件数', run(['list', '--root', dir, '--missing', 'note'], dir).out.split('\n').pop() === '2 件');
	check('知らない鍵を渡せば終了コード 5', run(['list', '--root', dir, '--missing', 'priority'], dir).code === 5);
	check('--missing に鍵が無ければ終了コード 5', run(['list', '--root', dir, '--missing', ''], dir).code === 5);
}

console.log('');
console.log(`=== issue (操作): ${pass} 件成功 ・ ${fail} 件失敗 ===`);
fs.rmSync(work, { recursive: true, force: true });
process.exit(fail === 0 ? 0 : 1);
