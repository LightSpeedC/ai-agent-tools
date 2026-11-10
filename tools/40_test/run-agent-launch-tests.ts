/*
	cc ・ cx ・ ag の共通部 (src/agent-launch) のテスト。

	計画: notes/10_plan/i261101-02-ag-cmdと起動の共通部.html
	  ・フォルダの決定 (置き場 → 年のフォルダ → 無ければ作る)
	  ・そのエージェントの履歴の有無 (claude ・ agy ・ codex。読み取りのみ)

	履歴の置き場は、ホームのフォルダを引数で受けるので、一時のホームに履歴の形を作って確かめる。
	本物の ~/.claude ・ ~/.gemini ・ ~/.codex は触らない。

	期待値は、実データで確かめた形から手で書いた (2026-11-01):
	  ・claude: W:\2026\<名前> → ~/.claude/projects/W--2026-<名前>/ の中の *.jsonl
	  ・agy:    ~/.gemini/antigravity-cli/cache/last_conversations.json のキー (W:\2026\<名前>)
	  ・codex:  ~/.codex/state_5.sqlite の threads 表の cwd (\\?\C:\work\2026\<名前>)。archived = 0 の行
	確かめられていないこと: claude の符号化で _ ・ . ・ 日本語がどうなるか (実データに該当が無い)。
	ここでは「英数字以外はすべて - にする」と仮定した試験を置く。
*/

import * as fs from 'node:fs';
import * as path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { encodeClaudeDir, hasHistory, pathForms } from '../../src/agent-launch/history.ts';
import { datePart, pickFolder } from '../../src/agent-launch/pick.ts';
import { agentEnv, keeperEnv, launchSpec, startArgs, windowTitle } from '../../src/agent-launch/launch.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..', '..');
const work = path.join(root, 'tmp', 'agent-launch-test');

let pass = 0;
let fail = 0;

function ok(name: string): void {
	pass++;
	console.log('  [OK] ' + name);
}

function ng(name: string, detail: string): void {
	fail++;
	console.log('  [NG] ' + name + '  ' + detail);
}

function assertEqual(name: string, expected: unknown, actual: unknown): void {
	const e = JSON.stringify(expected);
	const a = JSON.stringify(actual);
	if (e === a) { ok(name); } else { ng(name, '期待 ' + e + ' / 実際 ' + a); }
}

function fresh(name: string): string {
	const d = path.join(work, name);
	fs.rmSync(d, { recursive: true, force: true });
	fs.mkdirSync(d, { recursive: true });
	return d;
}

const now = new Date(2026, 10, 1, 9, 5, 0);

console.log('');
console.log('=== 共通部のテスト ===');
console.log('');

fs.rmSync(work, { recursive: true, force: true });

// ---- 日付 ----
console.log('--- 日付 ---');
{
	assertEqual('日付: 年 ・ yyyymmdd ・ 月/日 ・ 時:分 (cmd の %date% と同じ並び)', { year: '2026', ymd: '20261101', md: '11/01', hm: '09:05' }, datePart(now));
}

// ---- フォルダの決定 ----
console.log('--- フォルダの決定 ---');
{
	const r = fresh('pick-new');
	const p = pickFolder(r, 'foo', now);
	assertEqual('新規: 年のフォルダの下に <yyyymmdd>-<名前> を作る', path.join(r, '2026', '20261101-foo'), p.dir);
	assertEqual('新規: existing は false', false, p.existing);
	assertEqual('新規: 作ったフォルダが実在する', true, fs.existsSync(p.dir));

	const r2 = fresh('pick-year');
	fs.mkdirSync(path.join(r2, '2026', '20260901-foo'), { recursive: true });
	const p2 = pickFolder(r2, 'foo', now);
	assertEqual('既存: 年のフォルダの中で、名前の一部が当たるフォルダを使う', path.join(r2, '2026', '20260901-foo'), p2.dir);
	assertEqual('既存: existing は true', true, p2.existing);

	const r3 = fresh('pick-root');
	fs.mkdirSync(path.join(r3, 'bar-project'), { recursive: true });
	const p3 = pickFolder(r3, 'bar', now);
	assertEqual('既存: 置き場の直下のフォルダにも当たる', path.join(r3, 'bar-project'), p3.dir);

	const r4 = fresh('pick-both');
	fs.mkdirSync(path.join(r4, 'zzz-foo'), { recursive: true });
	fs.mkdirSync(path.join(r4, '2026', '20260901-foo'), { recursive: true });
	assertEqual('優先: 置き場の直下を、年のフォルダの中より先に探す', path.join(r4, 'zzz-foo'), pickFolder(r4, 'foo', now).dir);

	const r5 = fresh('pick-many');
	fs.mkdirSync(path.join(r5, '2026', 'b-foo2'), { recursive: true });
	fs.mkdirSync(path.join(r5, '2026', 'a-foo1'), { recursive: true });
	assertEqual('複数に当たるときは、名前順で最初の 1 つ', path.join(r5, '2026', 'a-foo1'), pickFolder(r5, 'foo', now).dir);

	const r6 = fresh('pick-case');
	fs.mkdirSync(path.join(r6, '2026', 'Foo-App'), { recursive: true });
	assertEqual('大小を区別しない', path.join(r6, '2026', 'Foo-App'), pickFolder(r6, 'foo', now).dir);

	const r7 = fresh('pick-file');
	fs.writeFileSync(path.join(r7, 'foo.txt'), 'x');
	const p7 = pickFolder(r7, 'foo', now);
	assertEqual('ファイルは対象外 (フォルダだけを探す)。名前が当たるファイルがあっても、新規に作る', false, p7.existing);

	const r8 = fresh('pick-ja');
	assertEqual('日本語の名前でも、新規に作れる', path.join(r8, '2026', '20261101-テスト'), pickFolder(r8, 'テスト', now).dir);

	const r9 = fresh('pick-again');
	const first = pickFolder(r9, 'once', now);
	const second = pickFolder(r9, 'once', now);
	assertEqual('2 回目は、作ったフォルダを既存として使う (冪等)', { dir: first.dir, existing: true }, second);
}

// ---- パスの形 ----
console.log('--- パスの形 ---');
{
	assertEqual('パスの形: W: は C:\\work と同じ場所として、両方の形を返す', ['W:\\2026\\foo', 'C:\\work\\2026\\foo'], pathForms('W:\\2026\\foo'));
	assertEqual('パスの形: C:\\work からも W: の形が出る (大小を区別しない)', ['W:\\2026\\foo', 'C:\\work\\2026\\foo'], pathForms('c:\\WORK\\2026\\foo'));
	assertEqual('パスの形: 末尾の区切りと \\\\?\\ の接頭辞を落とす', ['W:\\2026\\foo', 'C:\\work\\2026\\foo'], pathForms('\\\\?\\W:\\2026\\foo\\'));
	assertEqual('パスの形: ほかのドライブはそのまま 1 つ', ['D:\\x\\y'], pathForms('D:\\x\\y'));
}

// ---- claude の履歴 ----
console.log('--- claude の履歴 ---');
{
	assertEqual('claude の符号化: 実データの形 (: と \\ が - になる)', 'W--2026-20260502-inspect-my-pc', encodeClaudeDir('W:\\2026\\20260502-inspect-my-pc'));
	assertEqual('claude の符号化: 英数字以外はすべて - (仮定。実データに該当が無い)', 'W--2026-a-b-c', encodeClaudeDir('W:\\2026\\a_b.c'));
	assertEqual('claude の符号化: 日本語も 1 文字ずつ - (仮定)', 'W--2026----', encodeClaudeDir('W:\\2026\\日本語'));

	const home = fresh('claude-home');
	const proj = (n: string): string => path.join(home, '.claude', 'projects', n);
	fs.mkdirSync(proj('W--2026-foo'), { recursive: true });
	fs.writeFileSync(path.join(proj('W--2026-foo'), 'a.jsonl'), '{}\n');
	fs.mkdirSync(proj('W--2026-empty'), { recursive: true });
	fs.mkdirSync(proj('W--2026-notes'), { recursive: true });
	fs.writeFileSync(path.join(proj('W--2026-notes'), 'memo.txt'), 'x');
	fs.mkdirSync(proj('C--work-2026-viac'), { recursive: true });
	fs.writeFileSync(path.join(proj('C--work-2026-viac'), 'b.jsonl'), '{}\n');
	assertEqual('claude: *.jsonl があれば履歴あり', true, hasHistory('cc', 'W:\\2026\\foo', home));
	assertEqual('claude: フォルダだけあって *.jsonl が 0 個なら履歴なし (実データにもある形)', false, hasHistory('cc', 'W:\\2026\\empty', home));
	assertEqual('claude: *.jsonl 以外のファイルだけなら履歴なし', false, hasHistory('cc', 'W:\\2026\\notes', home));
	assertEqual('claude: そのフォルダの置き場が無ければ履歴なし', false, hasHistory('cc', 'W:\\2026\\nothing', home));
	assertEqual('claude: 別のフォルダの履歴は数えない', false, hasHistory('cc', 'W:\\2026\\fo', home));
	assertEqual('claude: C:\\work の形で残った履歴も、W: のフォルダの履歴として数える', true, hasHistory('cc', 'W:\\2026\\viac', home));
	assertEqual('claude: ホームに .claude が無ければ履歴なし', false, hasHistory('cc', 'W:\\2026\\foo', fresh('claude-none')));
}

// ---- agy の履歴 ----
console.log('--- agy の履歴 ---');
{
	const home = fresh('agy-home');
	const base = path.join(home, '.gemini', 'antigravity-cli');
	fs.mkdirSync(path.join(base, 'cache'), { recursive: true });
	fs.mkdirSync(path.join(base, 'conversations'), { recursive: true });
	fs.writeFileSync(path.join(base, 'cache', 'last_conversations.json'), JSON.stringify({
		'W:\\2026\\foo': 'id-foo',
		'W:\\2026\\gone': 'id-gone',
		'C:\\work\\2026\\viac': 'id-viac',
	}, null, 2));
	fs.writeFileSync(path.join(base, 'conversations', 'id-foo.db'), 'x');
	fs.writeFileSync(path.join(base, 'conversations', 'id-viac.db'), 'x');
	assertEqual('agy: 記録のキーがあり、会話の .db も在れば履歴あり', true, hasHistory('ag', 'W:\\2026\\foo', home));
	assertEqual('agy: キーはあるが会話の .db が無ければ履歴なし (消された会話)', false, hasHistory('ag', 'W:\\2026\\gone', home));
	assertEqual('agy: キーが無ければ履歴なし', false, hasHistory('ag', 'W:\\2026\\nothing', home));
	assertEqual('agy: 大小を区別しない', true, hasHistory('ag', 'w:\\2026\\FOO', home));
	assertEqual('agy: C:\\work の形のキーも、W: のフォルダの履歴として数える', true, hasHistory('ag', 'W:\\2026\\viac', home));
	assertEqual('agy: 記録のファイルが無ければ履歴なし', false, hasHistory('ag', 'W:\\2026\\foo', fresh('agy-none')));
	const broken = fresh('agy-broken');
	fs.mkdirSync(path.join(broken, '.gemini', 'antigravity-cli', 'cache'), { recursive: true });
	fs.writeFileSync(path.join(broken, '.gemini', 'antigravity-cli', 'cache', 'last_conversations.json'), '{ broken');
	assertEqual('agy: 記録が壊れていても落ちず、履歴なし', false, hasHistory('ag', 'W:\\2026\\foo', broken));
}

// ---- codex の履歴 ----
console.log('--- codex の履歴 ---');
{
	const home = fresh('codex-home');
	fs.mkdirSync(path.join(home, '.codex'), { recursive: true });
	const dbPath = path.join(home, '.codex', 'state_5.sqlite');
	const db = new DatabaseSync(dbPath);
	db.exec('create table threads (id text primary key, cwd text not null, archived integer not null default 0)');
	const ins = db.prepare('insert into threads (id, cwd, archived) values (?, ?, ?)');
	ins.run('t1', '\\\\?\\C:\\work\\2026\\foo', 0);
	ins.run('t2', '\\\\?\\C:\\work\\2026\\archived-only', 1);
	ins.run('t3', 'W:\\2026\\plain', 0);
	ins.run('t4', '\\\\?\\C:\\work\\2026\\Mixed-Case', 0);
	db.close();
	assertEqual('codex: cwd が一致し、archived = 0 の会話があれば履歴あり (実データの形 \\\\?\\C:\\work\\…)', true, hasHistory('cx', 'W:\\2026\\foo', home));
	assertEqual('codex: archived = 1 だけなら履歴なし', false, hasHistory('cx', 'W:\\2026\\archived-only', home));
	assertEqual('codex: \\\\?\\ の接頭辞が無い cwd (W: の形) も数える', true, hasHistory('cx', 'W:\\2026\\plain', home));
	assertEqual('codex: 大小を区別しない', true, hasHistory('cx', 'W:\\2026\\mixed-case', home));
	assertEqual('codex: 別のフォルダの会話は数えない', false, hasHistory('cx', 'W:\\2026\\fo', home));
	assertEqual('codex: 状態のファイルが無ければ履歴なし', false, hasHistory('cx', 'W:\\2026\\foo', fresh('codex-none')));
	const nothreads = fresh('codex-nothreads');
	fs.mkdirSync(path.join(nothreads, '.codex'), { recursive: true });
	const db2 = new DatabaseSync(path.join(nothreads, '.codex', 'state_5.sqlite'));
	db2.exec('create table other (x text)');
	db2.close();
	assertEqual('codex: threads 表が無くても落ちず、履歴なし', false, hasHistory('cx', 'W:\\2026\\foo', nothreads));
}

// ---- 起こす処理 (窓のタイトル ・ 引数 ・ 環境 ・ start の行) ----
// 期待値は、いまの cc.cmd ・ cx.cmd と、計画書の決め (87-B ・ 90-A) から手で書いた:
//   ・窓のタイトルは「<入口のコマンド名> <フォルダ名>」
//   ・cc: claude.exe [-c] -n "<フォルダ名> <月/日> <時:分>"。cx: codex-trusted [resume]
//   ・ag: ag-trusted --dangerously-skip-permissions --mode auto [-c]
//   ・cc は CLAUDE で始まる変数を、CLAUDE_CODE_USE_POWERSHELL_TOOL 以外、子に渡さない
//   ・番人への入力 (KEEPER_*) は、エージェントに渡さない
console.log('--- 起こす処理 ---');
{
	const dir = 'C:\\work\\2026\\20261101-foo';
	assertEqual('タイトル: <入口のコマンド名> <フォルダ名> (cc)', 'cc 20261101-foo', windowTitle('cc', dir));
	assertEqual('タイトル: cx', 'cx 20261101-foo', windowTitle('cx', dir));
	assertEqual('タイトル: ag', 'ag 20261101-foo', windowTitle('ag', dir));
	assertEqual('タイトル: 日本語のフォルダ名はそのまま', 'cc 20261101-テスト', windowTitle('cc', 'C:\\work\\2026\\20261101-テスト'));
	assertEqual('タイトル: 引用符は取り除く (start の引数を壊さない)', 'cc ab', windowTitle('cc', 'C:\\work\\2026\\a"b'));

	const name = '20261101-foo 11/01 09:05';
	assertEqual('cc 履歴なし: -c を付けない。再起動は -c', { exe: 'claude.exe', first: '-n "' + name + '"', again: '-c -n "' + name + '"' }, launchSpec('cc', dir, false, now));
	assertEqual('cc 履歴あり: 最初から -c', '-c -n "' + name + '"', launchSpec('cc', dir, true, now).first);
	assertEqual('cx 履歴なし: resume を付けない。再起動は resume', { exe: 'codex-trusted', first: '', again: 'resume' }, launchSpec('cx', dir, false, now));
	assertEqual('cx 履歴あり: 最初から resume', 'resume', launchSpec('cx', dir, true, now).first);
	assertEqual('ag 履歴なし: -c を付けない。再起動は -c', { exe: 'ag-trusted', first: '--dangerously-skip-permissions --mode auto', again: '--dangerously-skip-permissions --mode auto -c' }, launchSpec('ag', dir, false, now));
	assertEqual('ag 履歴あり: 最初から -c', '--dangerously-skip-permissions --mode auto -c', launchSpec('ag', dir, true, now).first);

	const env = { PATH: 'p', CLAUDECODE: '1', claude_code_x: 'y', CLAUDE_CODE_USE_POWERSHELL_TOOL: '1', KEEPER_EXE: 'z', OTHER: 'o' };
	assertEqual('環境 cc: CLAUDE で始まる変数を外す (USE_POWERSHELL_TOOL は残す。大小を区別しない。KEEPER_ も外す)', { PATH: 'p', CLAUDE_CODE_USE_POWERSHELL_TOOL: '1', OTHER: 'o' }, agentEnv('cc', env));
	// 81-B: use-lms.cmd が窓に設定する CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS は、cc で起こした claude に渡す。
	//   cc が CLAUDE で始まる変数を全部外すと、この 1 つも渡らず、LM Studio への接続の設定が欠ける
	assertEqual('環境 cc (81-B): CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS は渡す。ほかの CLAUDE は外す',
		{ PATH: 'p', CLAUDE_CODE_USE_POWERSHELL_TOOL: '1', CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS: '1' },
		agentEnv('cc', { PATH: 'p', CLAUDECODE: '1', CLAUDE_CODE_USE_POWERSHELL_TOOL: '1', CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS: '1' }));
	assertEqual('環境 cx: CLAUDE の変数はそのまま。KEEPER_ だけ外す', { PATH: 'p', CLAUDECODE: '1', claude_code_x: 'y', CLAUDE_CODE_USE_POWERSHELL_TOOL: '1', OTHER: 'o' }, agentEnv('cx', env));
	assertEqual('環境 ag: 同上', { PATH: 'p', CLAUDECODE: '1', claude_code_x: 'y', CLAUDE_CODE_USE_POWERSHELL_TOOL: '1', OTHER: 'o' }, agentEnv('ag', env));
	assertEqual('環境: 元の環境のオブジェクトは変えない', 'z', env.KEEPER_EXE);
	const kenv = keeperEnv('ag', { PATH: 'p' }, { exe: 'ag-trusted', first: 'A', again: 'B' });
	assertEqual('番人への入力: KEEPER_EXE ・ KEEPER_FIRST ・ KEEPER_AGAIN を足す', { PATH: 'p', KEEPER_EXE: 'ag-trusted', KEEPER_FIRST: 'A', KEEPER_AGAIN: 'B' }, kenv);

	assertEqual('start の行: タイトルは引用符で囲み、番人を cmd で動かす (全体は /s のためもう一組の引用符で囲む)', '/d /s /c "start "cc 20261101-foo" cmd /d /c "C:\\work\\src\\keeper.cmd""', startArgs('cc 20261101-foo', 'C:\\work\\src\\keeper.cmd'));
	assertEqual('start の行: 空白や日本語を含むタイトルも、引用符で囲まれる', '/d /s /c "start "ag 日本語 x" cmd /d /c "K""', startArgs('ag 日本語 x', 'K'));
}

fs.rmSync(work, { recursive: true, force: true });

console.log('');
if (fail === 0) {
	console.log('=== ' + pass + ' 件すべて成功 ===');
	process.exit(0);
} else {
	console.log('=== ' + fail + ' 件失敗（成功 ' + pass + ' 件）===');
	process.exit(1);
}
