/*
	issue（課題管理ツール）のフェーズ 3b のテスト:
	  ・issue view (render して開く。開けなければパスを出して終了コード 0)
	  ・更新の操作 (new ・ set ・ todo ・ confirm ・ archive ・ unarchive) の最後の、_issues.html の自動の作り直し
	  ・issue check の、.gitignore が _issues.html を除外しているかの検査
	計画は p261103-01 (131-A ・ 134-A)、仕様は notes/50_spec/課題ファイルの形と検査.html。

	期待値は、計画の決定から先に手で書いた（実装の出力から作っていない）。
	本物のプロジェクトには触らない。tmp/ の下に、ケースごとの小さなプロジェクトを作る。
	アプリを実際に開かないよう、環境変数 ISSUE_TEST_OPEN_LOG (開くパスを追記するファイル) と
	ISSUE_TEST_OPEN_FAIL (1 なら、開けなかった扱い) で差し替える。
*/
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..', '..');
const work = path.join(root, 'tmp', 'issue-view-tests');
const main = path.join(root, 'src', 'issue', 'main.ts');

let pass = 0;
let fail = 0;
function check(name: string, ok: boolean, detail: string = ''): void {
	if (ok) { pass++; console.log('  ✅ [OK] ' + name); }
	else { fail++; console.log('  ❌ [NG] ' + name + (detail ? '  ' + detail : '')); }
}

// ---- 材料 ----

const ProjectIdText = 'schema: 1\nproject_id: 7b0c4e1a9f3d4a62b8d51c2e6f90a3b7\n';
/** project-uuid.txt (schema 2)。project_id はプロジェクトのフォルダ名 (計画 p261109-01 の 207-A ・ 208-A) */
const uuidText = (name: string): string => `schema: 2\nproject_uuid: 7b0c4e1a9f3d4a62b8d51c2e6f90a3b7\nproject_id: ${name}\n`;
const Items = 'notes/40_issues/items/';
const Todo = Items + 'todo/';
const Doing = Items + 'doing/';
const Done = Items + 'done/';
const Archived = Items + 'archived/';
const Out = 'notes/40_issues/_issues.html';

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

function run(args: string[], dir: string, env: Record<string, string> = {}): Result {
	const e = { ...process.env, ISSUE_TEST_TODAY: '2026-11-05', ISSUE_TEST_NOW: '2026/11/05 12:34:56', ...env } as Record<string, string>;
	const r = spawnSync(process.execPath, [main, ...args, '--root', dir], { cwd: dir, env: e, encoding: 'utf8', timeout: 60000 });
	return { code: r.status ?? -1, out: (r.stdout ?? '').trim(), err: (r.stderr ?? '').trim() };
}

function html(dir: string, rel: string = Out): string {
	try { return fs.readFileSync(path.join(dir, rel), 'utf8').replace(/^﻿/, ''); } catch { return ''; }
}

function exists(dir: string, rel: string): boolean {
	return fs.existsSync(path.join(dir, rel));
}

function readOpenLog(file: string): string {
	try { return fs.readFileSync(file, 'utf8'); } catch { return ''; }
}

const A = 'i261103-01-a.md';
const B = 'i261103-02-b.md';
const C = 'i261103-03-c.md';

function basic(name: string): string {
	return std(name, {
		[Todo + A]: issueText({ id: 'i261103-01', title: '未の課題あ', group: 'html2md' }),
		[Doing + B]: issueText({ id: 'i261103-02', title: '着手の課題い', group: 'html2md' }),
		[Done + C]: issueText({ id: 'i261103-03', title: '済の課題う', group: 'text' }),
		[Archived + 'i261103-04-d.md']: issueText({ id: 'i261103-04', title: '保管の課題え', group: 'old' }),
	});
}

// ---- issue view ----

console.log('--- issue view ---');
{
	const dir = basic('view-basic');
	const log = path.join(dir, 'open.log');
	const r = run(['view'], dir, { ISSUE_TEST_OPEN_LOG: log });
	check('view は終了コード 0', r.code === 0, r.out + r.err);
	check('view は _issues.html を作る', exists(dir, Out));
	check('作った HTML に課題の題がある', html(dir).includes('未の課題あ') && html(dir).includes('済の課題う'));
	check('既定の範囲は未・着手・済 (archived は含まない)', !html(dir).includes('保管の課題え'));
	const opened = readOpenLog(log);
	check('開く対象に _issues.html の絶対パスを渡す', opened.trim().replace(/\\/g, '/').endsWith('notes/40_issues/_issues.html') && path.isAbsolute(opened.trim()), opened);
	check('開く対象は 1 行だけ', opened.trim().split('\n').length === 1, opened);
	check('標準出力に、作った・開いた旨を書く', /_issues\.html/.test(r.out), r.out);

	// 中身が同じでも、開く
	fs.rmSync(log, { force: true });
	const r2 = run(['view'], dir, { ISSUE_TEST_OPEN_LOG: log });
	check('中身が変わらなくても、開く', r2.code === 0 && readOpenLog(log).trim() !== '', r2.out + r2.err);
}
{
	const dir = basic('view-all');
	const log = path.join(dir, 'open.log');
	const r = run(['view', '--all'], dir, { ISSUE_TEST_OPEN_LOG: log });
	check('view --all は archived も含めて作る', r.code === 0 && html(dir).includes('保管の課題え'), r.out + r.err);
}
{
	const dir = basic('view-state');
	const log = path.join(dir, 'open.log');
	const r = run(['view', '--state', '着手'], dir, { ISSUE_TEST_OPEN_LOG: log });
	check('view --state 着手 は着手だけを作る', r.code === 0 && html(dir).includes('着手の課題い') && !html(dir).includes('未の課題あ'), r.out + r.err);
}
{
	const dir = basic('view-fail');
	const r = run(['view'], dir, { ISSUE_TEST_OPEN_FAIL: '1' });
	check('開けない環境でも、終了コード 0', r.code === 0, r.out + r.err);
	check('開けないときも HTML は作る', exists(dir, Out));
	check('開けないときは、パスを標準出力に出す', /_issues\.html/.test(r.out), r.out);
	check('開けなかった旨を伝える', /開け/.test(r.out + r.err), r.out + r.err);
}
{
	const dir = basic('view-bad');
	check('view の知らないオプションは終了コード 5', run(['view', '--bogus'], dir).code === 5);
	check('view に --out は渡せない (終了コード 5)', run(['view', '--out', 'x.html'], dir).code === 5);
	check('view に --standalone は渡せない (終了コード 5)', run(['view', '--standalone'], dir).code === 5);
	check('view の --state に知らない語は終了コード 5', run(['view', '--state', '完了'], dir).code === 5);
}

// ---- 更新の操作の最後の、自動の作り直し ----

console.log('--- 自動の作り直し ---');
{
	const dir = std('auto-new');
	const r = run(['new', '--title', '自動の題', '--group', 'html2md'], dir);
	check('new は終了コード 0', r.code === 0, r.out + r.err);
	check('new の最後に _issues.html を作る', exists(dir, Out));
	check('作った HTML に、新しい課題の題がある', html(dir).includes('自動の題'));
	check('自動の作り直しは、標準出力を増やさない (new の 1 行目だけ)', r.out.split('\n').filter((l) => l.trim() !== '').length <= 2, r.out);
}
{
	const dir = std('auto-new-json');
	const r = run(['new', '--title', 'json の題', '--group', 'html2md', '--json'], dir);
	let ok = false;
	try { ok = typeof JSON.parse(r.out).id === 'string'; } catch { ok = false; }
	check('--json の標準出力は、自動の作り直しを足しても JSON のまま', ok, r.out);
	check('--json でも _issues.html を作る', exists(dir, Out));
}
{
	const dir = basic('auto-set');
	run(['render'], dir);
	check('前提: 最初の _issues.html に、着手の課題がある', html(dir).includes('着手の課題い'));
	const before = html(dir);
	const r = run(['set', 'i261103-01', '--state', '着手'], dir);
	check('set は終了コード 0', r.code === 0, r.out + r.err);
	check('set の最後に _issues.html が変わる', html(dir) !== before);
}
{
	const dir = basic('auto-todo');
	const r = run(['todo', 'i261103-01', '--add', '足したやること'], dir);
	check('todo --add は終了コード 0', r.code === 0, r.out + r.err);
	check('todo の最後に、_issues.html へ新しいやることが入る', html(dir).includes('足したやること'));
}
{
	const dir = std('auto-confirm', {
		[Todo + A]: issueText({ id: 'i261103-01', title: '報告の課題', from: 'project-a' }),
	});
	const r = run(['confirm', 'i261103-01'], dir);
	check('confirm は終了コード 0', r.code === 0, r.out + r.err);
	check('confirm の最後に _issues.html を作る', exists(dir, Out));
}
{
	const dir = basic('auto-archive');
	run(['render', '--all'], dir);
	const r = run(['archive', 'text'], dir);
	check('archive は終了コード 0', r.code === 0, r.out + r.err);
	check('archive の最後に、既定の範囲で作り直す (archived へ動かした課題が消える)', exists(dir, Out) && !html(dir).includes('済の課題う'), r.out + r.err);
	const r2 = run(['unarchive', 'text'], dir);
	check('unarchive は終了コード 0', r2.code === 0, r2.out + r2.err);
	check('unarchive の最後に、課題が _issues.html へ戻る', html(dir).includes('済の課題う'));
}
// 159-A: 保管 (archived/) の全件は _issues-archive.html に置き、archive ・ unarchive の最後に作り直す。
// _issues.html の既定の範囲 (158-A) から外した保管の課題を、ブラウザで辿れるようにするため
{
	const OutArchive = 'notes/40_issues/_issues-archive.html';
	const dir = basic('auto-archive-html');
	const r = run(['archive', 'text'], dir);
	check('159-A: archive の最後に _issues-archive.html を作る', r.code === 0 && exists(dir, OutArchive), r.out + r.err);
	check('159-A: _issues-archive.html に、動かした課題がある', exists(dir, OutArchive) && html(dir, OutArchive).includes('済の課題う'));
	check('159-A: _issues-archive.html に、もとから保管の課題もある (全件)', exists(dir, OutArchive) && html(dir, OutArchive).includes('保管の課題え'));
	check('159-A: _issues-archive.html に、未・着手の課題は無い', exists(dir, OutArchive) && !html(dir, OutArchive).includes('未の課題あ') && !html(dir, OutArchive).includes('着手の課題い'));
	check('159-A: _issues.html から _issues-archive.html へリンクする', html(dir).includes('href="_issues-archive.html"'));
	check('159-A: _issues-archive.html から _issues.html へリンクする', exists(dir, OutArchive) && html(dir, OutArchive).includes('href="_issues.html"'));
	check('159-A: 自動の作り直しは、archive の標準出力を増やさない', r.out.split('\n').filter((l) => l.trim() !== '').length <= 1, r.out);
	const r2 = run(['unarchive', 'text'], dir);
	check('159-A: unarchive の最後に、戻した課題が _issues-archive.html から消える', r2.code === 0 && exists(dir, OutArchive) && !html(dir, OutArchive).includes('済の課題う'), r2.out + r2.err);
}
{
	const dir = basic('no-archive-link');
	run(['set', 'i261103-01', '--state', '着手'], dir);
	check('159-A: _issues-archive.html が無ければ、_issues.html からリンクしない', exists(dir, Out) && !html(dir).includes('_issues-archive.html'));
}
{
	const dir = basic('auto-readonly');
	run(['list'], dir);
	run(['show', 'i261103-01'], dir);
	run(['search', '課題'], dir);
	run(['check'], dir);
	check('list ・ show ・ search ・ check は _issues.html を作らない', !exists(dir, Out));
}
{
	const dir = basic('auto-failed-op');
	const r = run(['set', 'i261103-99', '--state', '着手'], dir);
	check('失敗した操作 (見つからない id) は終了コード 1', r.code === 1, r.out + r.err);
	check('失敗した操作では _issues.html を作らない', !exists(dir, Out));
}
{
	const dir = basic('auto-render-fail');
	// _issues.html の場所をフォルダにして、書けなくする
	fs.mkdirSync(path.join(dir, Out), { recursive: true });
	const r = run(['set', 'i261103-01', '--state', '着手'], dir);
	check('作り直しに失敗しても、主な操作は成功する (終了コード 0)', r.code === 0, r.out + r.err);
	check('主な操作は反映される (課題が doing/ へ動く)', exists(dir, Doing + A) && !exists(dir, Todo + A));
	check('作り直しの失敗は、標準エラーに警告で出す', /警告/.test(r.err), r.err);
}
{
	const dir = basic('auto-init');
	const r = run(['init'], dir);
	check('init は _issues.html を作らない', r.code === 0 && !exists(dir, Out), r.out + r.err);
}

// ---- issue check: .gitignore の検査 ----

console.log('--- issue check の .gitignore ---');

function gitInit(dir: string): boolean {
	const r = spawnSync('git', ['init', '-q', '-b', 'develop'], { cwd: dir, encoding: 'utf8', timeout: 30000 });
	return r.status === 0;
}

function codes(out: string): string[] {
	return [...out.matchAll(/\[(gitignore)\]/g)].map((m) => m[1]);
}

{
	const dir = basic('ignore-missing');
	const inited = gitInit(dir);
	check('前提: git init できる', inited);
	const r = run(['check'], dir);
	check('除外が無ければ、警告 [gitignore] を出す', codes(r.out).length === 1, r.out);
	check('警告は終了コードを変えない (0)', r.code === 0, r.out + r.err);
	check('警告に _issues.html を挙げ、_lock/ は挙げない (番号の予約はホームの下に移した。p261109-01)', /_issues\.html/.test(r.out) && !/_lock/.test(r.out), r.out);
	const j = run(['check', '--json'], dir);
	let hasFinding = false;
	let level = '';
	try {
		const parsed = JSON.parse(j.out);
		const f = parsed.findings.find((x: { code: string }) => x.code === 'gitignore');
		hasFinding = f !== undefined;
		level = f?.level ?? '';
	} catch { hasFinding = false; }
	check('--json の findings に gitignore があり、level は warning', hasFinding && level === 'warning', j.out);
}
{
	const dir = basic('ignore-ok');
	gitInit(dir);
	fs.writeFileSync(path.join(dir, '.gitignore'), 'tmp/\n_*\n');
	const r = run(['check'], dir);
	check('.gitignore に _* があれば、警告しない', codes(r.out).length === 0 && /問題なし/.test(r.out), r.out);
}
{
	const dir = basic('ignore-partial');
	gitInit(dir);
	fs.writeFileSync(path.join(dir, '.gitignore'), '_issues.html\n');
	const r = run(['check'], dir);
	check('_issues.html だけの除外で足りる (_lock/ は使わなくなった。p261109-01)', codes(r.out).length === 0, r.out);
}
{
	// git 管理の外 (OS の一時フォルダ) では、見られないので警告しない
	const dir = path.join(os.tmpdir(), 'issue-view-tests-nogit-' + process.pid);
	fs.rmSync(dir, { recursive: true, force: true });
	fs.mkdirSync(path.join(dir, Todo), { recursive: true });
	fs.writeFileSync(path.join(dir, Items + 'project-id.txt'), ProjectIdText);
	fs.writeFileSync(path.join(dir, Todo + A), issueText({}));
	const r = run(['check'], dir);
	check('git 管理の外では、警告しない', r.code === 0 && codes(r.out).length === 0, r.out + r.err);
	fs.rmSync(dir, { recursive: true, force: true });
}

console.log('');
console.log(`=== issue (view): ${pass} 件成功 ・ ${fail} 件失敗 ===`);
fs.rmSync(work, { recursive: true, force: true });
process.exit(fail === 0 ? 0 : 1);
