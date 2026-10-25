/*
	safe-push: 複数のセッション ・ PC ・ クラウドから書き換えられるリポジトリを、
	commit → pull --rebase → push の一続きで、壊さずに GitHub と同期する。計画は i261018-01。

		safe-push "<リポジトリ>" --all               変更をすべて載せる
		safe-push "<リポジトリ>" <パス> [<パス> …]    名指しのパスだけ載せる

	終了コード（2 は使わない。Stop フックが 2 を「続ける」と読むため）
		0 同期した ・ 載せるものも取り込むものも無かった ・ ロックが取れず飛ばした（出力で区別する）
		1 そのほかの失敗（commit の失敗 ・ git が時間切れ ・ 取り込みの失敗 ・ 一続き全体の上限）
		3 取り込みでぶつかった（ぶつかったファイル名を出す。人の対応が要る）
		4 push に失敗した（やり直さない。commit は手元に残り、次の回が送る）
		5 引数や置き場の誤り

	使わない操作: reset --hard ・ stash ・ checkout -- 。git の設定は書き換えない（読むだけ）。
	出力は 1 行。件数とファイル名だけで、中身もホスト名も出さない。
*/

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

const ExitOk = 0;
const ExitFailed = 1;
const ExitConflict = 3;
const ExitPushFailed = 4;
const ExitBadArgs = 5;

/**
 * 値は計画 i261018-01 の決める点 45 ・ 50 ・ 54。
 * テストだけが環境変数で縮める（本番は環境変数を読まないのと同じ既定）。
 */
function numberFrom(name: string, fallback: number): number {
	const n = Number(process.env[name]);
	return Number.isFinite(n) && n > 0 ? n : fallback;
}
/** ロックを取る回数。3 秒おきに 4 回（初回を含む）。約 9 秒 */
const LockAttempts = 4;
const LockIntervalMs = numberFrom('SAFE_PUSH_TEST_LOCK_INTERVAL_MS', 3000);
/** git の 1 回の打ち切り */
const CallMs = numberFrom('SAFE_PUSH_TEST_CALL_MS', 60 * 1000);
/** 一続き全体の上限（ロックを取ってから） */
const RunMs = numberFrom('SAFE_PUSH_TEST_RUN_MS', 3 * 60 * 1000);
/** ロックを古いとみなす長さ。持ち主は RunMs 以内に終わるので、これより古ければ持ち主は居ない */
const StaleMs = numberFrom('SAFE_PUSH_TEST_LOCK_STALE_MS', 5 * 60 * 1000);

class Fail extends Error {
	code: number;
	constructor(code: number, message: string) {
		super(message);
		this.code = code;
	}
}

// ---- 時刻（JST） ----

function jst(ms: number, full: boolean = false): string {
	const parts = new Intl.DateTimeFormat('ja-JP', {
		timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit',
		hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
	}).formatToParts(new Date(ms));
	const v = (t: string): string => parts.find((p) => p.type === t)?.value ?? '';
	const monthDay = v('month') + '/' + v('day');
	const hourMinute = v('hour') + ':' + v('minute');
	return full ? v('year') + '/' + monthDay + ' ' + hourMinute + ':' + v('second') : monthDay + ' ' + hourMinute;
}

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

// ---- 出力 ----

function emit(code: number, mark: string, text: string): void {
	const line = mark + jst(Date.now()) + ' ' + text;
	const stream = code === ExitOk ? process.stdout : process.stderr;
	stream.write(line + '\n', () => process.exit(code));
}

function usage(): void {
	console.log('複数の場所から書き換えられるリポジトリを、commit → pull --rebase → push の一続きで、壊さずに GitHub と同期します。');
	console.log('');
	console.log('  safe-push "<リポジトリ>" --all               変更をすべて載せる');
	console.log('  safe-push "<リポジトリ>" <パス> [<パス> …]    名指しのパスだけ載せる');
	console.log('');
	console.log('  -h, --help   この使い方を出す');
	console.log('');
	console.log('終了コード: 0 同期した ・ 飛ばした ／ 1 そのほかの失敗 ／ 3 取り込みでぶつかった ／ 4 push に失敗 ／ 5 引数や置き場の誤り');
	console.log('2 は使いません (Stop フックが「続ける」と読むため)。');
}

// ---- 引数 ----

type Args = { repo: string; all: boolean; paths: string[]; help: boolean };

function parseArgs(argv: string[]): Args | string {
	const positional: string[] = [];
	let all = false;
	let help = false;
	let rest = false;
	for (const token of argv) {
		if (rest) { positional.push(token); continue; }
		if (token === '--') { rest = true; continue; }
		if (token === '-h' || token === '--help') { help = true; continue; }
		if (token === '--all') { all = true; continue; }
		if (token.startsWith('-')) { return '知らないオプションです: ' + token; }
		positional.push(token);
	}
	if (help) { return { repo: '', all, paths: [], help: true }; }
	if (positional.length === 0) { return 'リポジトリを最初の引数に渡してください。'; }
	const paths = positional.slice(1);
	if (all && paths.length > 0) { return '--all とパスは、どちらか一方だけを渡してください。'; }
	if (!all && paths.length === 0) { return '載せる対象がありません。--all か、パスを渡してください。'; }
	return { repo: positional[0], all, paths, help: false };
}

// ---- git ----

type GitResult = { code: number; out: string; err: string; timedOut?: 'call' | 'run' };

/** 動いている git を、子ごと止める */
function killTree(pid: number | undefined): void {
	if (pid == null) { return; }
	if (process.platform === 'win32') {
		spawn('taskkill', ['/pid', String(pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
		return;
	}
	try { process.kill(-pid, 'SIGKILL'); } catch { /* すでに終わっている */ }
}

/**
 * git を 1 回呼ぶ。1 回の打ち切り（CallMs）と、一続き全体の残り時間の、短いほうで止める。
 * 同期の API は使わない（同じプロセスの非同期処理を止めるため）。
 */
function git(cwd: string, args: string[], deadline: number | null = null): Promise<GitResult> {
	let limit = CallMs;
	let reason: 'call' | 'run' = 'call';
	if (deadline != null) {
		const remaining = deadline - Date.now();
		if (remaining <= 0) { return Promise.resolve({ code: -1, out: '', err: '', timedOut: 'run' }); }
		if (remaining < limit) { limit = remaining; reason = 'run'; }
	}
	return new Promise((resolve) => {
		let done = false;
		let out = '';
		let err = '';
		const finish = (r: GitResult): void => {
			if (done) { return; }
			done = true;
			clearTimeout(timer);
			resolve(r);
		};
		const child = spawn('git', args, {
			cwd,
			// 認証や編集の入力待ちで固まらないようにする。メッセージの言語も揃える（失敗の種類を文字で見分けるため）
			env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_EDITOR: 'true', GIT_SEQUENCE_EDITOR: 'true', LC_ALL: 'C' },
			stdio: ['ignore', 'pipe', 'pipe'],
			windowsHide: true,
			detached: process.platform !== 'win32',
		});
		child.stdout.setEncoding('utf8');
		child.stderr.setEncoding('utf8');
		child.stdout.on('data', (d: string) => { out += d; });
		child.stderr.on('data', (d: string) => { err += d; });
		const timer = setTimeout(() => {
			killTree(child.pid);
			child.stdout.destroy();
			child.stderr.destroy();
			finish({ code: -1, out, err, timedOut: reason });
		}, limit);
		child.on('error', (e) => finish({ code: -1, out, err: String(e) }));
		child.on('close', (code) => finish({ code: code ?? -1, out: out.trim(), err: err.trim() }));
	});
}

// ---- ロック ----

type LockBody = { host: string; pid: number; startedMs: number; started: string };

function hostName(): string {
	return process.env.SAFE_PUSH_TEST_HOSTNAME || os.hostname();
}

function alive(pid: number): boolean {
	try {
		process.kill(pid, 0);
		return true;
	} catch (e) {
		// EPERM は、あるが権限が無い（生きている）
		return (e as NodeJS.ErrnoException).code === 'EPERM';
	}
}

function readLock(lock: string): string | null {
	try { return fs.readFileSync(lock, 'utf8'); } catch { return null; }
}

function parseLock(raw: string): LockBody | null {
	try {
		const o = JSON.parse(raw) as Partial<LockBody>;
		if (typeof o.host === 'string' && typeof o.pid === 'number' && typeof o.startedMs === 'number') {
			return { host: o.host, pid: o.pid, startedMs: o.startedMs, started: String(o.started ?? '') };
		}
	} catch { /* 作っている途中や壊れた中身 */ }
	return null;
}

/** 「無いときだけ作る」。作れたら true */
function tryCreate(lock: string, body: LockBody): boolean {
	let fd: number;
	try {
		fd = fs.openSync(lock, 'wx');
	} catch (e) {
		if ((e as NodeJS.ErrnoException).code === 'EEXIST') { return false; }
		throw e;
	}
	try { fs.writeSync(fd, JSON.stringify(body)); }
	finally { fs.closeSync(fd); }
	return true;
}

/**
 * 残っているロックが古いか。古ければ、報告に書く説明を返す。
 *   ・同じホストで pid のプロセスが無い          → すぐ古い
 *   ・開始から StaleMs を過ぎている（ホストを問わず）→ 古い（持ち主は RunMs 以内に終わるので、居ない）
 *   ・別のホストの pid は確かめられないので、期限だけで判断する
 */
function staleNotice(lock: string, raw: string): string | null {
	const body = parseLock(raw);
	const now = Date.now();
	if (body == null) {
		// 作っている途中かもしれない。古くなるまでは待つ
		let mtime = now;
		try { mtime = fs.statSync(lock).mtimeMs; } catch { /* 消えた */ }
		return now - mtime > StaleMs ? '古いロックを取り除きました (中身を読めませんでした)' : null;
	}
	const same = body.host === hostName();
	if ((same && !alive(body.pid)) || now - body.startedMs > StaleMs) {
		return '古いロックを取り除きました (pid ' + body.pid + ' ・ 開始 ' + jst(body.startedMs) + ' ・ ' + (same ? '同じホスト' : '別のホスト') + ')';
	}
	return null;
}

type Locked = { release: () => void; notice: string };

/** 3 秒おきに 4 回（約 9 秒）取り直す。取れなければ null（飛ばす） */
async function acquire(lock: string): Promise<Locked | null> {
	const body: LockBody = { host: hostName(), pid: process.pid, startedMs: Date.now(), started: jst(Date.now(), true) };
	let notice = '';
	const release = (): void => {
		// 放すのは自分のロックだけ。古いと見なされて取り除かれ、別の呼び出しが取り直したものを消さない
		const raw = readLock(lock);
		const now = raw == null ? null : parseLock(raw);
		if (now != null && now.host === body.host && now.pid === body.pid && now.startedMs === body.startedMs) {
			try { fs.unlinkSync(lock); } catch { /* すでに無い */ }
		}
	};
	for (let attempt = 1; attempt <= LockAttempts; attempt++) {
		if (tryCreate(lock, body)) { return { release, notice }; }
		const raw = readLock(lock);
		if (raw == null) {
			// 読む間に消えた。すぐ取り直す
			if (tryCreate(lock, body)) { return { release, notice }; }
		}
		else {
			const why = staleNotice(lock, raw);
			// 取り除く直前に、中身が変わっていないことを見る（取り直されたロックを消さない）
			if (why != null && readLock(lock) === raw) {
				try { fs.unlinkSync(lock); notice = why; } catch { /* 別の呼び出しが先に取り除いた */ }
				if (tryCreate(lock, body)) { return { release, notice }; }
			}
		}
		if (attempt < LockAttempts) { await sleep(LockIntervalMs); }
	}
	return null;
}

// ---- 本体 ----

function samePath(a: string, b: string): boolean {
	const x = fs.realpathSync.native(a);
	const y = fs.realpathSync.native(b);
	return process.platform === 'win32' ? x.toLowerCase() === y.toLowerCase() : x === y;
}

async function must(cwd: string, args: string[], deadline: number | null, failure: Fail): Promise<GitResult> {
	const r = await git(cwd, args, deadline);
	if (r.timedOut != null) { throw timeoutFail(args[0], r.timedOut); }
	if (r.code !== 0) { throw failure; }
	return r;
}

function timeoutFail(sub: string, reason: 'call' | 'run'): Fail {
	return reason === 'run'
		? new Fail(ExitFailed, '一続きの上限を超えたため、止めました (git ' + sub + ')。commit は手元に残してあります')
		: new Fail(ExitFailed, 'git が時間切れになりました (git ' + sub + ')。commit は手元に残してあります');
}

type Context = { top: string; gitDir: string; remote: string; merge: string; all: boolean; paths: string[]; deadline: number };

async function rebaseInProgress(c: Context): Promise<boolean> {
	return fs.existsSync(path.join(c.gitDir, 'rebase-merge')) || fs.existsSync(path.join(c.gitDir, 'rebase-apply'));
}

/** ぶつかったら、ファイル名を控えて rebase を取り消し、止める。手元の commit は戻る */
async function conflictOut(c: Context): Promise<Fail> {
	const r = await git(c.top, ['diff', '--name-only', '--diff-filter=U'], c.deadline);
	const files = r.out.split('\n').map((s) => s.trim()).filter((s) => s.length > 0);
	await git(c.top, ['rebase', '--abort'], c.deadline);
	return new Fail(ExitConflict, '取り込みでぶつかりました: ' + (files.length > 0 ? files.join(' ・ ') : '(ファイル名は取れませんでした)') + ' (手元の commit と変更は残してあります)');
}

/** 取り込む。浅い clone で失敗したら、unshallow して、この回の中で 1 回だけやり直す */
async function pull(c: Context): Promise<void> {
	const pullFailure = new Fail(ExitFailed, '取り込みに失敗しました (commit は手元に残してあります)');
	let r = await git(c.top, ['pull', '--rebase'], c.deadline);
	if (r.timedOut != null) { throw timeoutFail('pull', r.timedOut); }
	if (r.code === 0) { return; }
	if (await rebaseInProgress(c)) { throw await conflictOut(c); }

	const shallow = await git(c.top, ['rev-parse', '--is-shallow-repository'], c.deadline);
	if (shallow.out !== 'true') { throw pullFailure; }
	await must(c.top, ['fetch', '--unshallow'], c.deadline, pullFailure);
	r = await git(c.top, ['pull', '--rebase'], c.deadline);
	if (r.timedOut != null) { throw timeoutFail('pull', r.timedOut); }
	if (r.code === 0) { return; }
	if (await rebaseInProgress(c)) { throw await conflictOut(c); }
	throw pullFailure;
}

/** 一続きの本体。ロックを持った状態で呼ぶ。成功したときの文を返す */
async function sync(c: Context): Promise<string> {
	const commitFailure = new Fail(ExitFailed, 'commit に失敗しました (変更は手元に残してあります)');

	// 載せる
	const pathspec = c.all ? [] : ['--', ...c.paths];
	await must(c.top, ['add', '-A', ...pathspec], c.deadline, commitFailure);
	const staged = await git(c.top, ['diff', '--cached', '--quiet', ...pathspec], c.deadline);
	if (staged.timedOut != null) { throw timeoutFail('diff', staged.timedOut); }
	if (staged.code > 1 || staged.code < 0) { throw commitFailure; }
	let committed = 0;
	if (staged.code === 1) {
		const message = 'safe-push ' + jst(Date.now(), true);
		await must(c.top, ['commit', '-m', message, ...pathspec], c.deadline, commitFailure);
		committed = 1;
	}

	// 取り込む。名指しで、追跡しているファイルの書きかけが残っているときは、取り込まない（決める点 43）
	const status = await must(c.top, ['status', '--porcelain', '--untracked-files=no'], c.deadline, new Fail(ExitFailed, 'git status に失敗しました'));
	const dirty = status.out.length > 0;
	const upstream = c.remote + '/' + c.merge.replace(/^refs\/heads\//, '');
	const before = (await git(c.top, ['rev-parse', upstream], c.deadline)).out;
	if (!dirty) { await pull(c); }
	const after = (await git(c.top, ['rev-parse', upstream], c.deadline)).out;
	let pulled = 0;
	if (before !== '' && after !== '' && before !== after) {
		const n = await git(c.top, ['rev-list', '--count', before + '..' + after], c.deadline);
		pulled = Number(n.out) || 0;
	}

	// 送る。拒否されても、やり直さない
	const ahead = Number((await git(c.top, ['rev-list', '--count', upstream + '..HEAD'], c.deadline)).out) || 0;
	if (ahead > 0) {
		const r = await git(c.top, ['push', c.remote, 'HEAD:' + c.merge], c.deadline);
		if (r.timedOut != null) { throw timeoutFail('push', r.timedOut); }
		if (r.code !== 0) {
			const rejected = /rejected|non-fast-forward|fetch first/.test(r.err);
			throw new Fail(ExitPushFailed, 'push に失敗しました: ' + (rejected ? '取り込み側が先に進んでいます' : '認証 ・ 回線などで送れませんでした') + ' (commit は手元に残してあります)');
		}
	}

	const parts: string[] = [];
	if (committed > 0) { parts.push('commit ' + committed); }
	if (pulled > 0) { parts.push('取り込み ' + pulled); }
	if (ahead > 0) { parts.push('push 済'); }
	let text = parts.length > 0 ? parts.join(' ・ ') : '変更なし';
	if (dirty) { text += '。書きかけが残っているため、取り込みは行いませんでした'; }
	return '同期しました (' + text + ')';
}

async function main(): Promise<void> {
	const parsed = parseArgs(process.argv.slice(2));
	if (typeof parsed === 'string') {
		emit(ExitBadArgs, '❌', parsed);
		return;
	}
	if (parsed.help) {
		usage();
		process.exit(ExitOk);
	}

	// ---- 置き場の確認（ロックの前） ----
	const repo = path.resolve(parsed.repo);
	if (!fs.existsSync(repo) || !fs.statSync(repo).isDirectory()) {
		emit(ExitBadArgs, '❌', 'リポジトリのフォルダがありません。');
		return;
	}
	const bad = (text: string): void => emit(ExitBadArgs, '❌', text);

	const topResult = await git(repo, ['rev-parse', '--show-toplevel']);
	if (topResult.code !== 0 || topResult.out === '') { bad('git の作業フォルダではありません。'); return; }
	const top = topResult.out;
	if (!samePath(top, repo)) { bad('リポジトリの最上位のフォルダを渡してください。'); return; }

	const branch = await git(top, ['symbolic-ref', '--short', '-q', 'HEAD']);
	if (branch.code !== 0 || branch.out === '') { bad('ブランチの先頭を指していません (detached HEAD)。'); return; }
	const remote = await git(top, ['config', '--get', 'branch.' + branch.out + '.remote']);
	const merge = await git(top, ['config', '--get', 'branch.' + branch.out + '.merge']);
	if (remote.code !== 0 || merge.code !== 0 || remote.out === '' || merge.out === '') { bad('ブランチに上流がありません。'); return; }

	for (const p of parsed.paths) {
		const abs = path.resolve(top, p);
		const rel = path.relative(top, abs);
		if (rel.startsWith('..') || path.isAbsolute(rel)) { bad('リポジトリの外のパスです: ' + p); return; }
		if (!fs.existsSync(abs)) {
			const tracked = await git(top, ['ls-files', '--error-unmatch', '--', p]);
			if (tracked.code !== 0) { bad('存在せず、追跡もしていないパスです: ' + p); return; }
		}
	}

	const gitDirResult = await git(top, ['rev-parse', '--absolute-git-dir']);
	if (gitDirResult.code !== 0 || gitDirResult.out === '') { bad('.git の場所を調べられませんでした。'); return; }
	const gitDir = gitDirResult.out;

	// ---- ロック ----
	const locked = await acquire(path.join(gitDir, 'safe-push.lock'));
	if (locked == null) {
		const waited = Math.round(((LockAttempts - 1) * LockIntervalMs) / 1000);
		emit(ExitOk, '⬜', '別の同期が動いているため、飛ばしました (約 ' + waited + ' 秒待ちました)');
		return;
	}
	const onSignal = (): void => { locked.release(); process.exit(ExitFailed); };
	process.on('SIGINT', onSignal);
	process.on('SIGTERM', onSignal);

	const context: Context = { top, gitDir, remote: remote.out, merge: merge.out, all: parsed.all, paths: parsed.paths, deadline: Date.now() + RunMs };
	let code = ExitOk;
	let mark = '✅';
	let text = '';
	try {
		const done = await sync(context);
		text = (locked.notice !== '' ? locked.notice + '。' : '') + done;
		if (locked.notice !== '') { mark = '⚠️'; }
	}
	catch (e) {
		code = e instanceof Fail ? e.code : ExitFailed;
		mark = '❌';
		text = e instanceof Fail ? e.message : '予期しない失敗: ' + (e instanceof Error ? e.message : String(e));
	}
	finally {
		// どの終わり方でも、自分のロックを放す
		locked.release();
	}
	emit(code, mark, text);
}

main().catch((e) => {
	emit(ExitFailed, '❌', '予期しない失敗: ' + (e instanceof Error ? e.message : String(e)));
});
