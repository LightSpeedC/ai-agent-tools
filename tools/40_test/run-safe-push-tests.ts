/*
	safe-push（複数の場所から書き換えられるリポジトリを、壊さずに GitHub と同期する）のテスト。
	計画は i261018-01。

	本物のリポジトリには触らない。tmp/ の下に、裸のリポジトリ（origin）と、
	その clone を 2 つ（a ・ b。別の PC の代わり）作る。

	人を表す値は tester1 ・ example.com のような仮の値にする（共通ルール「テストのルール」）。
	ホスト名は、出力のどこにも出さない決めなので、出ていないことも見る。

	時間のかかる動き（git の時間切れ ・ 全体の上限 ・ 同時に 2 本）は、
	push の前に動く pre-push フックで遅らせて作る。待ちの長さはテストだけが環境変数で縮める。
*/
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..', '..');
const work = path.join(root, 'tmp', 'safe-push-tests');
const main = path.join(root, 'src', 'safe-push', 'main.ts');

let pass = 0;
let fail = 0;
function check(name: string, ok: boolean, detail: string = ''): void {
	if (ok) { pass++; console.log('  ✅ [OK] ' + name); }
	else { fail++; console.log('  ❌ [NG] ' + name + (detail ? '  ' + detail : '')); }
}

function fwd(p: string): string {
	return p.split('\\').join('/');
}

// ---- 道具 ----

const IdentityEnv = {
	GIT_AUTHOR_NAME: 'Tester One', GIT_AUTHOR_EMAIL: 'tester1@example.com',
	GIT_COMMITTER_NAME: 'Tester One', GIT_COMMITTER_EMAIL: 'tester1@example.com',
	GIT_TERMINAL_PROMPT: '0',
};
const BaseEnv = { ...process.env, ...IdentityEnv } as Record<string, string>;
// ロックの取り直しの間隔を縮める（本番は 3 秒）。回数は本番と同じ 4 回
const Fast = { SAFE_PUSH_TEST_LOCK_INTERVAL_MS: '150' };

type Result = { code: number; out: string; err: string };

function git(cwd: string, ...args: string[]): Result {
	const r = spawnSync('git', args, { cwd, env: BaseEnv, encoding: 'utf8', timeout: 60000 });
	return { code: r.status ?? -1, out: (r.stdout ?? '').trim(), err: (r.stderr ?? '').trim() };
}

function run(args: string[], env: Record<string, string> = {}): Result {
	const r = spawnSync(process.execPath, [main, ...args], { cwd: work, env: { ...BaseEnv, ...Fast, ...env }, encoding: 'utf8', timeout: 60000 });
	return { code: r.status ?? -1, out: (r.stdout ?? '').trim(), err: (r.stderr ?? '').trim() };
}

function runAsync(args: string[], env: Record<string, string> = {}): Promise<Result> {
	return new Promise((resolve) => {
		const c = spawn(process.execPath, [main, ...args], { cwd: work, env: { ...BaseEnv, ...Fast, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
		let out = '';
		let err = '';
		c.stdout.setEncoding('utf8');
		c.stderr.setEncoding('utf8');
		c.stdout.on('data', (d: string) => { out += d; });
		c.stderr.on('data', (d: string) => { err += d; });
		c.on('close', (code) => resolve({ code: code ?? -1, out: out.trim(), err: err.trim() }));
	});
}

type Env = { dir: string; origin: string; a: string; b: string };

/** 裸のリポジトリと、clone 2 つ。最初の commit は a から送る */
function fresh(name: string): Env {
	const dir = path.join(work, name);
	fs.mkdirSync(dir, { recursive: true });
	const origin = fwd(path.join(dir, 'origin.git'));
	git(dir, 'init', '--bare', '-b', 'develop', origin);
	git(dir, 'clone', '-c', 'core.autocrlf=false', origin, 'a');
	const a = fwd(path.join(dir, 'a'));
	for (const f of ['x.txt', 'y.txt', 'z.txt']) { fs.writeFileSync(path.join(a, f), f + ' の最初の内容\n'); }
	fs.writeFileSync(path.join(a, 'README.txt'), '共通の 1 行目\n2 行目\n');
	git(a, 'add', '-A');
	git(a, 'commit', '-m', '最初');
	git(a, 'push', '-u', 'origin', 'develop');
	// 改行の変換は、clone の時点で切る。あとから切ると、b の全ファイルが CRLF で「変更あり」になる
	git(dir, 'clone', '-c', 'core.autocrlf=false', origin, 'b');
	const b = fwd(path.join(dir, 'b'));
	return { dir, origin, a, b };
}

function write(repo: string, file: string, body: string): void {
	fs.writeFileSync(path.join(repo, file), body);
}
function read(repo: string, file: string): string {
	return fs.readFileSync(path.join(repo, file), 'utf8');
}

/** b から、別の PC が先に push した状態を作る */
function bPushes(e: Env, file: string, body: string): void {
	write(e.b, file, body);
	git(e.b, 'add', '-A');
	git(e.b, 'commit', '-m', 'b の変更 ' + file);
	git(e.b, 'push');
}

function originShow(e: Env, file: string): string {
	return git(e.dir, '--git-dir', e.origin, 'show', 'develop:' + file).out;
}

function hook(repo: string, name: string, script: string): void {
	const p = path.join(repo, '.git', 'hooks', name);
	fs.writeFileSync(p, '#!/bin/sh\n' + script + '\n');
	fs.chmodSync(p, 0o755);
}

function lockPath(repo: string): string {
	return path.join(repo, '.git', 'safe-push.lock');
}
function writeLock(repo: string, host: string, pid: number, startedMs: number): void {
	fs.writeFileSync(lockPath(repo), JSON.stringify({ host, pid, startedMs, started: 'テスト' }));
}

function sha(p: string): string {
	return crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
}

function jstLabel(offsetMs: number): string {
	const parts = new Intl.DateTimeFormat('ja-JP', { timeZone: 'Asia/Tokyo', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
		.formatToParts(new Date(Date.now() + offsetMs));
	const v = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
	return v('month') + '/' + v('day') + ' ' + v('hour') + ':' + v('minute');
}

const Host = os.hostname();

// ---- 準備 ----
fs.rmSync(work, { recursive: true, force: true });
fs.mkdirSync(work, { recursive: true });

console.log('=== safe-push のテスト ===');

// ---- 1 ----
console.log('\n[1 変更も取り込むものも無い]');
{
	const e = fresh('t01');
	const r = run([e.a, '--all']);
	check('何もせず終了コード 0', r.code === 0, JSON.stringify(r));
	check('出力は 1 行で「変更なし」', r.out.split('\n').length === 1 && r.out.includes('変更なし'), r.out);
	check('ロックが残らない', !fs.existsSync(lockPath(e.a)));
}

// ---- 2 / 17 ----
console.log('\n[2 --all ・ 引数の組み合わせ ・ 17 commit のメッセージ]');
{
	const e = fresh('t02');
	write(e.a, 'x.txt', 'x を変えた\n');
	const before = git(e.a, 'rev-parse', 'HEAD').out;
	const bad1 = run([e.a]);
	const bad2 = run([e.a, '--all', 'x.txt']);
	check('パスも --all も無ければ終了コード 5', bad1.code === 5, JSON.stringify(bad1));
	check('--all とパスの両方を渡しても終了コード 5', bad2.code === 5, JSON.stringify(bad2));
	check('止めたときは何も載せない', git(e.a, 'rev-parse', 'HEAD').out === before && git(e.a, 'status', '--porcelain').out.includes('x.txt'));
	const r = run([e.a, '--all']);
	check('--all で終了コード 0', r.code === 0, JSON.stringify(r));
	check('a の変更が裸のリポジトリに載る', originShow(e, 'x.txt') === 'x を変えた', originShow(e, 'x.txt'));
	const subject = git(e.dir, '--git-dir', e.origin, 'log', '-1', '--format=%s', 'develop').out;
	check('commit のメッセージは safe-push yyyy/mm/dd hh:mm:ss（JST）', /^safe-push \d{4}\/\d\d\/\d\d \d\d:\d\d:\d\d$/.test(subject), subject);
}

// ---- 3 ----
console.log('\n[3 名指し]');
{
	const e = fresh('t03');
	write(e.a, 'x.txt', 'x を変えた\n');
	write(e.a, 'y.txt', 'y を変えた（書きかけ）\n');
	const r = run([e.a, 'x.txt']);
	check('終了コード 0', r.code === 0, JSON.stringify(r));
	check('指したパスだけが載る', originShow(e, 'x.txt') === 'x を変えた' && originShow(e, 'y.txt') === 'y.txt の最初の内容');
	// git() は出力の前後の空白を削る。先頭の行の「 M」の空白も落ちるので、「M y.txt」で見る
	check('ほかの変更は未 commit のまま残る', git(e.a, 'status', '--porcelain').out.includes('M y.txt'));
	check('書きかけの中身も同じ', read(e.a, 'y.txt') === 'y を変えた（書きかけ）\n');
}

// ---- 4 ----
console.log('\n[4 取り込んでから送る]');
{
	const e = fresh('t04');
	bPushes(e, 'z.txt', 'b が z を変えた\n');
	write(e.a, 'x.txt', 'a が x を変えた\n');
	const r = run([e.a, '--all']);
	check('終了コード 0', r.code === 0, JSON.stringify(r));
	check('両方の変更が裸のリポジトリにある', originShow(e, 'x.txt') === 'a が x を変えた' && originShow(e, 'z.txt') === 'b が z を変えた');
	check('履歴は一直線（マージの commit が無い）', git(e.a, 'rev-list', '--merges', '--count', 'HEAD').out === '0');
	check('a の作業フォルダにも b の変更が入る', read(e.a, 'z.txt') === 'b が z を変えた\n');
}

// ---- 5 / 15 ----
console.log('\n[5 名指しで書きかけが残る（取り込まずに push だけ試す）・ 15 push は やり直さない]');
{
	const e = fresh('t05a');
	write(e.a, 'x.txt', 'x を変えた\n');
	write(e.a, 'y.txt', '書きかけ\n');
	const r = run([e.a, 'x.txt']);
	check('別の clone が先に push していなければ通る（終了コード 0）', r.code === 0, JSON.stringify(r));
	check('取り込まなかったことを出力に書く', r.out.includes('取り込みは行いませんでした'), r.out);
	check('書きかけは残る', git(e.a, 'status', '--porcelain').out.includes('M y.txt'));
}
{
	const e = fresh('t05b');
	bPushes(e, 'z.txt', 'b が z を変えた\n');
	const counter = fwd(path.join(e.dir, 'push-count.txt'));
	hook(e.a, 'pre-push', 'echo x >> "' + counter + '"');
	write(e.a, 'x.txt', 'x を変えた\n');
	write(e.a, 'y.txt', '書きかけ\n');
	const r = run([e.a, 'x.txt']);
	check('別の clone が先に push していたら、終了コード 4', r.code === 4, JSON.stringify(r));
	check('push は 1 回だけ（やり直さない）', fs.existsSync(counter) && fs.readFileSync(counter, 'utf8').trim().split('\n').length === 1);
	check('a の commit は手元に残る', git(e.a, 'log', '-1', '--format=%s').out.startsWith('safe-push '));
	check('裸のリポジトリは変わらない', originShow(e, 'x.txt') === 'x.txt の最初の内容');
	check('書きかけは消えない', read(e.a, 'y.txt') === '書きかけ\n');
	check('エラーは標準エラーに出る', r.err.includes('push に失敗'), r.err);
}

// ---- 6 ----
console.log('\n[6 同じ箇所でぶつかる]');
{
	const e = fresh('t06');
	bPushes(e, 'README.txt', 'b が 1 行目を変えた\n2 行目\n');
	write(e.a, 'README.txt', 'a が 1 行目を変えた\n2 行目\n');
	const r = run([e.a, '--all']);
	check('終了コード 3', r.code === 3, JSON.stringify(r));
	check('ぶつかったファイル名を出す', r.err.includes('README.txt'), r.err);
	check('rebase の途中の状態が残らない', !fs.existsSync(path.join(e.a, '.git', 'rebase-merge')) && !fs.existsSync(path.join(e.a, '.git', 'rebase-apply')));
	check('a の commit は消えず、中身も a のまま', git(e.a, 'log', '-1', '--format=%s').out.startsWith('safe-push ') && read(e.a, 'README.txt') === 'a が 1 行目を変えた\n2 行目\n');
	check('ロックが残らない', !fs.existsSync(lockPath(e.a)));
}

// ---- 7 ----
console.log('\n[7 追跡していない新しいファイルだけが残る]');
{
	const e = fresh('t07');
	bPushes(e, 'z.txt', 'b が z を変えた\n');
	write(e.a, 'u.txt', '新しいファイル\n');
	write(e.a, 'x.txt', 'x を変えた\n');
	const r = run([e.a, 'x.txt']);
	check('ふつうに取り込んで同期できる（終了コード 0）', r.code === 0, JSON.stringify(r));
	check('b の変更も a の変更も裸のリポジトリにある', originShow(e, 'x.txt') === 'x を変えた' && originShow(e, 'z.txt') === 'b が z を変えた');
	check('新しいファイルは追跡されないまま残る', git(e.a, 'status', '--porcelain').out.includes('?? u.txt'));
}

// ---- 8 ----
console.log('\n[8 同じ clone で 2 本を同時に呼ぶ]');
await (async () => {
	const e = fresh('t08');
	write(e.a, 'f1.txt', '1\n');
	write(e.a, 'f2.txt', '2\n');
	const log = fwd(path.join(e.dir, 'hook-log.txt'));
	hook(e.a, 'pre-push', 'echo start >> "' + log + '"\nsleep 1\necho end >> "' + log + '"');
	// 待ちの間隔を長くして、2 本目が 1 本目の終わりまで待てるようにする
	const env = { SAFE_PUSH_TEST_LOCK_INTERVAL_MS: '1500' };
	const [r1, r2] = await Promise.all([runAsync([e.a, 'f1.txt'], env), runAsync([e.a, 'f2.txt'], env)]);
	check('どちらも終了コード 0', r1.code === 0 && r2.code === 0, JSON.stringify([r1, r2]));
	const seq = fs.existsSync(log) ? fs.readFileSync(log, 'utf8').trim().split('\n').join(',') : '';
	check('一続きが重ならない（start, end が交互）', seq === 'start,end,start,end', seq);
	check('どちらの変更も裸のリポジトリにある', originShow(e, 'f1.txt') === '1' && originShow(e, 'f2.txt') === '2');
	check('ロックが残らない', !fs.existsSync(lockPath(e.a)));
})();

// ---- 9 ----
console.log('\n[9 ロックが取れない]');
{
	const e = fresh('t09');
	write(e.a, 'x.txt', 'x を変えた\n');
	writeLock(e.a, Host, process.pid, Date.now());
	const lockBefore = fs.readFileSync(lockPath(e.a), 'utf8');
	const t0 = Date.now();
	const r = run([e.a, '--all']);
	const ms = Date.now() - t0;
	check('待ちを使い切って、飛ばして終了コード 0', r.code === 0 && r.out.includes('飛ばしました'), JSON.stringify(r));
	check('3 秒おきの 3 回ぶんの待ちを取る（テストでは 150 ミリ秒 × 3）', ms >= 400, ms + ' ミリ秒');
	check('ロックを壊さない', fs.existsSync(lockPath(e.a)) && fs.readFileSync(lockPath(e.a), 'utf8') === lockBefore);
	check('何も載せない', git(e.a, 'status', '--porcelain').out.includes('x.txt'));
}

// ---- 10 ----
console.log('\n[10 残ったロック]');
{
	const dead = spawnSync(process.execPath, ['-e', '0']).pid ?? 0;
	const e1 = fresh('t10a');
	write(e1.a, 'x.txt', 'x を変えた\n');
	writeLock(e1.a, Host, dead, Date.now());
	const r1 = run([e1.a, '--all']);
	check('同じホストで pid が無いロックは、期限を待たず取り除いて進む', r1.code === 0 && originShow(e1, 'x.txt') === 'x を変えた', JSON.stringify(r1));
	check('取り除いたことを報告する（ホスト名は出さない）', r1.out.includes('古いロック') && !r1.out.includes(Host), r1.out);
	check('終わったらロックが無い', !fs.existsSync(lockPath(e1.a)));

	const e2 = fresh('t10b');
	write(e2.a, 'x.txt', 'x を変えた\n');
	writeLock(e2.a, 'other-host-1', 1, Date.now());
	const r2 = run([e2.a, '--all']);
	check('別のホストのロックは、期限内なら取り除かない（飛ばして 0）', r2.code === 0 && r2.out.includes('飛ばしました') && fs.existsSync(lockPath(e2.a)), JSON.stringify(r2));

	const e3 = fresh('t10c');
	write(e3.a, 'x.txt', 'x を変えた\n');
	writeLock(e3.a, 'other-host-1', 1, Date.now() - 6 * 60 * 1000);
	const r3 = run([e3.a, '--all']);
	check('別のホストのロックは、5 分を過ぎたら取り除く', r3.code === 0 && originShow(e3, 'x.txt') === 'x を変えた' && r3.out.includes('古いロック'), JSON.stringify(r3));

	const e4 = fresh('t10d');
	write(e4.a, 'x.txt', 'x を変えた\n');
	writeLock(e4.a, Host, process.pid, Date.now() - 6 * 60 * 1000);
	const r4 = run([e4.a, '--all']);
	check('同じホストで pid が生きていても、5 分を過ぎたら取り除く', r4.code === 0 && originShow(e4, 'x.txt') === 'x を変えた' && r4.out.includes('古いロック'), JSON.stringify(r4));

	const e5 = fresh('t10e');
	write(e5.a, 'x.txt', 'x を変えた\n');
	const other = '{"host":"other-host-2","pid":1,"startedMs":' + Date.now() + ',"started":"テスト"}';
	hook(e5.a, 'pre-push', 'printf \'%s\' \'' + other + '\' > "$(git rev-parse --absolute-git-dir)/safe-push.lock"');
	const r5 = run([e5.a, '--all']);
	check('放すのは自分のロックだけ（持ち主が変わっていたら消さない）', r5.code === 0 && fs.existsSync(lockPath(e5.a)) && fs.readFileSync(lockPath(e5.a), 'utf8') === other, JSON.stringify(r5));
}

// ---- 11 / 18 ----
console.log('\n[11 git の時間切れ ・ 18 一続き全体の上限]');
{
	const e = fresh('t11');
	hook(e.a, 'pre-push', 'sleep 5');
	write(e.a, 'x.txt', 'x を変えた\n');
	const t0 = Date.now();
	const r = run([e.a, '--all'], { SAFE_PUSH_TEST_CALL_MS: '1000' });
	check('git が時間切れになったら、終了コード 1', r.code === 1 && r.err.includes('時間切れ'), JSON.stringify(r));
	check('待ちすぎない（5 秒のフックを待たずに終わる）', Date.now() - t0 < 4500, (Date.now() - t0) + ' ミリ秒');
	check('ロックが残らない', !fs.existsSync(lockPath(e.a)));
	check('commit は手元に残る', git(e.a, 'log', '-1', '--format=%s').out.startsWith('safe-push '));
}
{
	const e = fresh('t18');
	hook(e.a, 'pre-push', 'sleep 5');
	write(e.a, 'x.txt', 'x を変えた\n');
	const t0 = Date.now();
	const r = run([e.a, '--all'], { SAFE_PUSH_TEST_RUN_MS: '1500' });
	check('一続き全体が上限を超えたら、終了コード 1', r.code === 1 && r.err.includes('上限'), JSON.stringify(r));
	check('上限で打ち切る（5 秒のフックを待たずに終わる）', Date.now() - t0 < 4500, (Date.now() - t0) + ' ミリ秒');
	check('ロックが残らない', !fs.existsSync(lockPath(e.a)));
}

// ---- 12 ----
console.log('\n[12 使わない操作]');
{
	const e = fresh('t12');
	bPushes(e, 'z.txt', 'b が z を変えた\n');
	write(e.a, 'x.txt', 'x を変えた\n');
	const cfg = path.join(e.a, '.git', 'config');
	const before = sha(cfg);
	const r = run([e.a, '--all']);
	check('終了コード 0', r.code === 0, JSON.stringify(r));
	check('.git/config が変わらない', sha(cfg) === before);
	check('stash が空', git(e.a, 'stash', 'list').out === '');
	// 説明のコメントには、使わない操作の名前が出てくる。コメントを除いたコードだけを見る
	const src = fs.readFileSync(main, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
	const forbidden = [/'stash'/, /--hard/, /'checkout'/, /'reset'/, /'clean'/];
	const hits = forbidden.filter((re) => re.test(src)).map(String);
	check('ソースに reset --hard ・ stash ・ checkout -- を呼ぶ記述が無い', hits.length === 0, hits.join(' '));
	const cfgCalls = src.match(/'config'[^\n]*/g) ?? [];
	check('git config は読むだけ（--get）', cfgCalls.every((l) => l.includes('--get')), cfgCalls.join(' | '));
}

// ---- 13 ----
console.log('\n[13 引数や置き場の誤り]');
{
	const e = fresh('t13');
	const plain = path.join(work, 'plain-dir');
	fs.mkdirSync(plain, { recursive: true });
	const noUp = path.join(work, 'no-upstream');
	fs.mkdirSync(noUp, { recursive: true });
	git(noUp, 'init', '-b', 'develop');
	write(noUp, 'a.txt', 'a\n');
	git(noUp, 'add', '-A');
	git(noUp, 'commit', '-m', 'init');
	const detached = fresh('t13d');
	git(detached.a, 'checkout', '--detach');
	// 最上位でないフォルダ（親のリポジトリの中）を渡しても、親を同期してしまわないこと
	const sub = path.join(e.a, 'sub-dir');
	fs.mkdirSync(sub, { recursive: true });
	const cases: [string, string[]][] = [
		['引数なし', []],
		['リポジトリが無い', [path.join(work, 'missing-dir'), '--all']],
		['git の作業フォルダでない', [plain, '--all']],
		['リポジトリの最上位でないフォルダ', [sub, '--all']],
		['上流が無いブランチ', [noUp, '--all']],
		['ブランチの先頭を指していない（detached）', [detached.a, '--all']],
		['リポジトリの外のパス', [e.a, '../outside.txt']],
		['存在せず、追跡もしていないパス', [e.a, 'nope.txt']],
		['知らないオプション', [e.a, '--all', '--message', 'x']],
	];
	const codes: number[] = [];
	for (const [name, args] of cases) {
		const r = run(args);
		codes.push(r.code);
		check(name + ' → 終了コード 5', r.code === 5, JSON.stringify(r));
	}
	// Stop フックは 2 を「続ける」と読む。どの誤りでも 2 を返さないこと
	check('どの場合も 2 を返さない', codes.every((code) => code !== 2), codes.join(','));
}

// ---- 14 ----
console.log('\n[14 出力]');
{
	const e = fresh('t14');
	write(e.a, 'x.txt', 'x を変えた\n');
	const r = run([e.a, '--all']);
	const lines = r.out.split('\n');
	check('成功の出力は 1 行', lines.length === 1, r.out);
	const label = /^✅(\d\d\/\d\d \d\d:\d\d) /.exec(r.out);
	check('先頭に ✅ と JST の月/日 時:分', label != null && (label[1] === jstLabel(0) || label[1] === jstLabel(-60000)), r.out + ' / 期待 ' + jstLabel(0));
	check('ホスト名を含まない', !r.out.includes(Host) && !r.err.includes(Host));
	const e2 = fresh('t14b');
	bPushes(e2, 'README.txt', 'b が変えた\n2 行目\n');
	write(e2.a, 'README.txt', 'a が変えた\n2 行目\n');
	const r2 = run([e2.a, '--all']);
	check('失敗の出力も 1 行で、先頭に ❌', r2.err.split('\n').length === 1 && r2.err.startsWith('❌'), r2.err);
}

// ---- 16 / 19 ----
console.log('\n[16 浅い clone ・ 19 取り込みが 2 回失敗する]');
{
	const e = fresh('t16');
	const shallow = fwd(path.join(e.dir, 's'));
	git(e.dir, 'clone', '-c', 'core.autocrlf=false', '--depth', '1', 'file:///' + e.origin, 's');
	bPushes(e, 'z.txt', 'b が z を変えた\n');
	// 1 回目の rebase だけ、フックで失敗させる（git 自身の失敗として起こす）
	hook(shallow, 'pre-rebase', 'm="$(git rev-parse --absolute-git-dir)/pre-rebase-ran"\nif [ ! -e "$m" ]; then : > "$m"; exit 1; fi\nexit 0');
	write(shallow, 'x.txt', 'x を変えた\n');
	const was = git(shallow, 'rev-parse', '--is-shallow-repository').out;
	const r = run([shallow, '--all']);
	check('はじめは浅い clone', was === 'true', was);
	check('1 回目の取り込みが失敗しても、unshallow して 1 回やり直して通る（終了コード 0）', r.code === 0, JSON.stringify(r));
	check('浅い clone でなくなる', git(shallow, 'rev-parse', '--is-shallow-repository').out === 'false');
	check('両方の変更が裸のリポジトリにある', originShow(e, 'x.txt') === 'x を変えた' && originShow(e, 'z.txt') === 'b が z を変えた');
}
{
	const e = fresh('t19');
	const shallow = fwd(path.join(e.dir, 's'));
	git(e.dir, 'clone', '-c', 'core.autocrlf=false', '--depth', '1', 'file:///' + e.origin, 's');
	bPushes(e, 'z.txt', 'b が z を変えた\n');
	hook(shallow, 'pre-rebase', 'exit 1');
	write(shallow, 'x.txt', 'x を変えた\n');
	const r = run([shallow, '--all']);
	check('2 回目も失敗したら、終了コード 1 でエラーにする', r.code === 1 && r.err.includes('取り込み'), JSON.stringify(r));
	check('やり直しは 1 回だけ（unshallow のあと止まる）', git(shallow, 'rev-parse', '--is-shallow-repository').out === 'false');
	check('commit は手元に残り、ロックは残らない', git(shallow, 'log', '-1', '--format=%s').out.startsWith('safe-push ') && !fs.existsSync(lockPath(shallow)));
}

// ---- commit が失敗する ----
console.log('\n[commit が失敗する]');
{
	const e = fresh('t20');
	hook(e.a, 'pre-commit', 'exit 1');
	write(e.a, 'x.txt', 'x を変えた\n');
	const r = run([e.a, '--all']);
	check('commit が失敗したら、終了コード 1', r.code === 1 && r.err.includes('commit'), JSON.stringify(r));
	check('push しない（裸のリポジトリは変わらない）', originShow(e, 'x.txt') === 'x.txt の最初の内容');
	check('変更は手元に残り、ロックは残らない', read(e.a, 'x.txt') === 'x を変えた\n' && !fs.existsSync(lockPath(e.a)));
}

// ---- 結果 ----
console.log('\n=== 結果 ===');
if (fail === 0) {
	fs.rmSync(work, { recursive: true, force: true });
	console.log('=== ' + pass + ' 件すべて成功 ===');
	process.exit(0);
}
console.log('  成功 ' + pass + ' 件 ・ 失敗 ' + fail + ' 件（材料は tmp/safe-push-tests に残してあります）');
process.exit(1);
