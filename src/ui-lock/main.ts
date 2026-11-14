/*
	ui-lock: 画面 ・ マウス ・ キー ・ 前面の窓を使う作業を、全プロジェクトで 1 つずつにする (課題 i261114-01)。

	ロックは名前付きミューテックス (既定 Local\ai-interactive-desktop、決定 251-A)。
	持ち主が死ねば OS が放棄 (WAIT_ABANDONED) として次へ渡すので、取り残しが無い。
	持ち主の記録は %LOCALAPPDATA%\ai-interactive-desktop\owner.json にも書く (status と待ちの表示に使う)。

	ミューテックスは取ったスレッドが持つ。bun の主スレッドで取り、同じスレッドで放す。
	待つ間は WaitForSingleObject(…, 0) を 1 秒ごとに試す (主スレッドを塞がない)。

	終了コード: 0 ・ 子の終了コード / 1 status で使用中 / 2 bun が無い / 3 待ちの上限 / 4 実行の上限 / 5 引数の誤り
*/
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { writeAtomic } from '../lib/write-atomic.ts';

const EXIT_BUSY = 1;
const EXIT_NO_BUN = 2;
const EXIT_WAIT_TIMEOUT = 3;
const EXIT_RUN_TIMEOUT = 4;
const EXIT_BAD_ARGS = 5;

const DEFAULT_TIMEOUT_SEC = 10 * 60; // 決定 252-B
const DEFAULT_WAIT_SEC = 60 * 60; // 決定 253-A (利用者の指定で 60 分)
const OWNER_PRINT_SEC = 60; // 待つ間、持ち主を出す間隔 (依頼 #1948)
const TOAST_SEC = 5 * 60; // 待つ間、トーストを出す間隔 (決定 254-A)

const WAIT_OBJECT_0 = 0;
const WAIT_ABANDONED = 0x80;

const USAGE = `ui-lock: 画面 ・ マウス ・ キーを使う作業を、全プロジェクトで 1 つずつにする

使い方:
  ui-lock run [--timeout <時間>] [--wait <時間>] [--also <名前>]… -- <コマンド> [引数…]
      ロックを取ってコマンドを流し、終わったら放す
      --timeout  実行の上限 (既定 10m)。過ぎたら子のプロセスごと止めて放す (終了コード 4)
      --wait     取れるまで待つ上限 (既定 60m)。過ぎたら終了コード 3
                 待つ間は 1 分ごとに持ち主を出し、5 分ごとに Windows のトーストで知らせる
      --also     一緒に取るロックの名前 (移行中の古い名前。例 Local\\fm-ui-tests)。何度でも書ける
  ui-lock status
      今の持ち主を出す (空きなら 0、使用中なら 1)

時間は 30s ・ 10m ・ 1h の形。
終了コード: 子の終了コード / 1 使用中 (status) / 3 待ちの上限 / 4 実行の上限 / 5 引数の誤り
`;

function lockName(): string { return process.env.UI_LOCK_NAME || 'Local\\ai-interactive-desktop'; }
function ownerDir(): string {
	return process.env.UI_LOCK_DIR || path.join(process.env.LOCALAPPDATA || '', 'ai-interactive-desktop');
}
function ownerPath(): string { return path.join(ownerDir(), 'owner.json'); }

class BadArgs extends Error {}

function parseDuration(s: string | undefined): number {
	const m = /^(\d+)(s|m|h)$/.exec(s ?? '');
	if (!m) throw new BadArgs('時間の形が違う: ' + s + ' (30s ・ 10m ・ 1h の形)');
	return Number(m[1]) * (m[2] === 's' ? 1 : m[2] === 'm' ? 60 : 3600);
}

interface Owner { project: string; worktree: string; command: string; started: string; pid: number; timeoutSec: number }

function nowText(): string {
	const d = new Date();
	const p = (n: number): string => String(n).padStart(2, '0');
	return d.getFullYear() + '/' + p(d.getMonth() + 1) + '/' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds());
}

function readOwner(): Owner | null {
	try { return JSON.parse(fs.readFileSync(ownerPath(), 'utf8')) as Owner; } catch { return null; }
}

function ownerText(o: Owner | null): string {
	if (o == null) return '持ち主の記録がありません';
	return o.project + ' (pid ' + o.pid + ') ' + o.command + '  開始 ' + o.started + '  上限 ' + Math.round(o.timeoutSec / 60) + ' 分';
}

function whereAmI(): { project: string; worktree: string } {
	const r = spawnSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' });
	const top = r.status === 0 ? r.stdout.trim() : process.cwd();
	return { project: path.basename(top), worktree: top };
}

/* ---- ミューテックス (bun:ffi) ---- */

interface K32 {
	CreateMutexW: (a: null, owned: number, name: unknown) => number | bigint;
	WaitForSingleObject: (h: number | bigint, ms: number) => number;
	ReleaseMutex: (h: number | bigint) => number;
	CloseHandle: (h: number | bigint) => number;
}

async function loadK32(): Promise<{ k32: K32; wide: (s: string) => unknown }> {
	// 直に 'bun:ffi' と書くと node の型定義に無いため tsc が止まる。組み立ててから読む
	const { dlopen, FFIType, ptr } = await import('bun' + ':ffi');
	const { symbols } = dlopen('kernel32.dll', {
		CreateMutexW: { args: [FFIType.ptr, FFIType.i32, FFIType.ptr], returns: FFIType.ptr },
		WaitForSingleObject: { args: [FFIType.ptr, FFIType.u32], returns: FFIType.u32 },
		ReleaseMutex: { args: [FFIType.ptr], returns: FFIType.i32 },
		CloseHandle: { args: [FFIType.ptr], returns: FFIType.i32 },
	});
	const keep: Buffer[] = [];
	const wide = (s: string): unknown => { const b = Buffer.from(s + '\0', 'utf16le'); keep.push(b); return ptr(b); };
	return { k32: symbols as unknown as K32, wide };
}

class Locks {
	private held: (number | bigint)[] = [];
	// node の型の取り除き (strip-types) は引数のプロパティを受け付けないので、手で持つ
	private k32: K32;
	private wide: (s: string) => unknown;
	private names: string[];
	constructor(k32: K32, wide: (s: string) => unknown, names: string[]) {
		this.k32 = k32;
		this.wide = wide;
		this.names = names;
	}

	/** 全部を取れたら true。1 つでも取れなければ、取った分を放して false (取り合いで固まらないため) */
	tryAll(): { ok: boolean; abandoned: boolean } {
		let abandoned = false;
		for (const name of this.names) {
			const h = this.k32.CreateMutexW(null, 0, this.wide(name));
			if (!h) throw new Error('CreateMutexW が失敗しました: ' + name);
			const r = this.k32.WaitForSingleObject(h, 0);
			if (r === WAIT_OBJECT_0 || r === WAIT_ABANDONED) {
				if (r === WAIT_ABANDONED) abandoned = true;
				this.held.push(h);
			} else {
				this.k32.CloseHandle(h);
				this.releaseAll();
				return { ok: false, abandoned: false };
			}
		}
		return { ok: true, abandoned };
	}

	releaseAll(): void {
		for (const h of this.held.reverse()) { this.k32.ReleaseMutex(h); this.k32.CloseHandle(h); }
		this.held = [];
	}
}

/* ---- トースト (決定 254-A) ---- */

function toast(title: string, body: string): void {
	if (process.env.UI_LOCK_NO_TOAST === '1') return;
	const esc = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/'/g, "''");
	const script = [
		"[Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] | Out-Null",
		"[Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom.XmlDocument, ContentType = WindowsRuntime] | Out-Null",
		"$x = New-Object Windows.Data.Xml.Dom.XmlDocument",
		"$x.LoadXml('<toast><visual><binding template=\"ToastGeneric\"><text>" + esc(title) + "</text><text>" + esc(body) + "</text></binding></visual></toast>')",
		"$id = '{1AC14E77-02E7-4E5D-B744-2EB1AE5198B7}\\WindowsPowerShell\\v1.0\\powershell.exe'",
		"[Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier($id).Show([Windows.UI.Notifications.ToastNotification]::new($x))",
	].join('; ');
	try {
		const c = spawn('powershell', ['-NoProfile', '-NonInteractive', '-Command', script], { stdio: 'ignore', detached: true, windowsHide: true });
		c.on('error', () => {});
		c.unref();
	} catch { /* 知らせられなくても待ちは続ける */ }
}

/* ---- 子のプロセス ---- */

function quote(a: string): string {
	return /^[\w\-.:\\/=]+$/.test(a) ? a : '"' + a.replace(/"/g, '\\"') + '"';
}

function killTree(c: ChildProcess): void {
	if (c.pid == null) return;
	spawnSync('taskkill', ['/PID', String(c.pid), '/T', '/F'], { stdio: 'ignore' });
}

/* ---- 下位コマンド ---- */

async function status(): Promise<number> {
	const { k32, wide } = await loadK32();
	const locks = new Locks(k32, wide, [lockName()]);
	const r = locks.tryAll();
	if (r.ok) {
		locks.releaseAll();
		console.log('空き: ' + lockName());
		if (fs.existsSync(ownerPath())) console.log('  前の持ち主の記録が残っています (放棄): ' + ownerText(readOwner()));
		return 0;
	}
	console.log('使用中: ' + lockName());
	console.log('  ' + ownerText(readOwner()));
	return EXIT_BUSY;
}

async function run(args: string[]): Promise<number> {
	const sep = args.indexOf('--');
	if (sep < 0 || sep === args.length - 1) throw new BadArgs('-- の後にコマンドを書いてください');
	const opts = args.slice(0, sep);
	const cmd = args.slice(sep + 1);
	let timeoutSec = DEFAULT_TIMEOUT_SEC;
	let waitSec = DEFAULT_WAIT_SEC;
	const also: string[] = [];
	for (let i = 0; i < opts.length; i++) {
		const o = opts[i];
		if (o === '--timeout') timeoutSec = parseDuration(opts[++i]);
		else if (o === '--wait') waitSec = parseDuration(opts[++i]);
		else if (o === '--also') { const v = opts[++i]; if (!v) throw new BadArgs('--also に名前が要ります'); also.push(v); }
		else throw new BadArgs('知らないオプション: ' + o);
	}

	const { k32, wide } = await loadK32();
	const locks = new Locks(k32, wide, [lockName(), ...also]);
	const command = cmd.map(quote).join(' ');

	// 取れるまで待つ
	const t0 = Date.now();
	let lastPrint = -Infinity;
	let lastToast = Date.now();
	let got = locks.tryAll();
	while (!got.ok) {
		const now = Date.now();
		if (now - lastPrint >= OWNER_PRINT_SEC * 1000) {
			console.log('[待ち] ' + nowText() + ' 使用中: ' + ownerText(readOwner()));
			lastPrint = now;
		}
		if (now - lastToast >= TOAST_SEC * 1000) {
			const me = whereAmI();
			toast('ui-lock を待っています', me.project + ' が ' + Math.round((now - t0) / 60000) + ' 分待っています。持ち主: ' + ownerText(readOwner()));
			lastToast = now;
		}
		if (now - t0 >= waitSec * 1000) {
			console.log('[NG] 待ちの上限 (' + Math.round(waitSec / 60 * 10) / 10 + ' 分) を過ぎました。持ち主: ' + ownerText(readOwner()));
			return EXIT_WAIT_TIMEOUT;
		}
		await new Promise((r) => setTimeout(r, 1000));
		got = locks.tryAll();
	}
	// 取れたのに記録が残っていれば、前の持ち主は放さずに死んだ (WAIT_ABANDONED が返らない場合もこれで拾う)
	if (got.abandoned || fs.existsSync(ownerPath())) console.log('[!] 前の持ち主が放棄したロックを取りました: ' + ownerText(readOwner()));

	const me = whereAmI();
	const owner: Owner = { ...me, command, started: nowText(), pid: process.pid, timeoutSec };
	fs.mkdirSync(ownerDir(), { recursive: true });
	writeAtomic(ownerPath(), Buffer.from(JSON.stringify(owner, null, '\t') + '\n', 'utf8'));

	const cleanup = (): void => {
		const o = readOwner();
		if (o != null && o.pid === process.pid) { try { fs.rmSync(ownerPath()); } catch { /* 消せなくても放す */ } }
		locks.releaseAll();
	};

	return await new Promise<number>((resolve) => {
		const child = spawn(command, { stdio: 'inherit', shell: true, windowsHide: false });
		let timedOut = false;
		const timer = setTimeout(() => {
			timedOut = true;
			console.log('[NG] 実行の上限 (' + Math.round(timeoutSec / 60 * 10) / 10 + ' 分) を過ぎたので、子のプロセスごと止めます');
			killTree(child);
		}, timeoutSec * 1000);
		const onSignal = (): void => { killTree(child); };
		process.on('SIGINT', onSignal);
		process.on('SIGTERM', onSignal);
		child.on('error', (e) => { clearTimeout(timer); cleanup(); console.error('[NG] 起動できません: ' + e.message); resolve(127); });
		child.on('exit', (code) => {
			clearTimeout(timer);
			cleanup();
			resolve(timedOut ? EXIT_RUN_TIMEOUT : (code ?? 1));
		});
	});
}

async function main(argv: string[]): Promise<number> {
	if (argv.length === 0 || argv[0] === '--help' || argv[0] === '-h') { console.log(USAGE); return argv.length === 0 ? EXIT_BAD_ARGS : 0; }
	if (typeof (globalThis as { Bun?: unknown }).Bun === 'undefined') { console.error('[NG] bun が必要です (bun:ffi でロックを取るため)'); return EXIT_NO_BUN; }
	try {
		if (argv[0] === 'status') return await status();
		if (argv[0] === 'run') return await run(argv.slice(1));
		throw new BadArgs('知らない下位コマンド: ' + argv[0]);
	} catch (e) {
		if (e instanceof BadArgs) { console.error('[NG] ' + e.message); console.error(USAGE); return EXIT_BAD_ARGS; }
		throw e;
	}
}

process.exitCode = await main(process.argv.slice(2));
