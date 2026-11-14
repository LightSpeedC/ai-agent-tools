/*
	ui-lock: 画面 ・ マウス ・ キー ・ 前面の窓を使う作業を、全プロジェクトで 1 つずつにする (課題 i261114-01)。

	ロックは名前付きミューテックス (既定 Local\ai-interactive-desktop、決定 251-A)。
	持ち主が死ねば OS が放棄 (WAIT_ABANDONED) として次へ渡すので、取り残しが無い。
	持ち主の記録は %LOCALAPPDATA%\ai-interactive-desktop\owner.json にも書く (status と待ちの表示に使う)。

	Windows API は bun では bun:ffi、node では koffi で呼ぶ (決定 255-A)。Rust 版は src/ui-lock-rs (256-A)。
	ミューテックスは取ったスレッドが持つ。主スレッドで取り、同じスレッドで放す。
	待つ間は WaitForSingleObject(…, 0) を 1 秒ごとに試す (主スレッドを塞がない)。

	run は子に UI_LOCK_HELD=<自分の pid> を渡す。包まれた中の run は、その pid が持ち主で
	しかも自分の祖先なら、取らずにそのまま流す (課題 i261114-02、決定 258-B)。

	hold は利用者の画面操作を守る口 (課題 i261114-03)。裏に持ち役 (__holder) を起こし、
	持ち役が --pid のプロセスが消えるか release を受けるまで持つ (259-A)。取れなければ待たずに 1 (260-A)。
	利用者が持つ間に待ちが --evict-user-after を超えたら、名前付きイベント
	<ロックの名前>-quit-<fm の pid> を立てて、fm に終わってもらう (261-A)。

	終了コード: 0 ・ 子の終了コード / 1 使用中 / 3 待ちの上限 / 4 実行の上限 / 5 引数の誤り
*/
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeAtomic } from '../lib/write-atomic.ts';

const EXIT_BUSY = 1;
const EXIT_WAIT_TIMEOUT = 3;
const EXIT_RUN_TIMEOUT = 4;
const EXIT_BAD_ARGS = 5;

const DEFAULT_TIMEOUT_SEC = 10 * 60; // 決定 252-B
const DEFAULT_WAIT_SEC = 60 * 60; // 決定 253-A (利用者の指定で 60 分)
const DEFAULT_EVICT_SEC = 10 * 60; // 依頼 #1955 (利用者が持つ間、10 分待ったら終了を知らせる)
const OWNER_PRINT_SEC = 60; // 待つ間、持ち主を出す間隔 (依頼 #1948)
const TOAST_SEC = 5 * 60; // 待つ間、トーストを出す間隔 (決定 254-A)
const HOLD_READY_SEC = 5; // hold が持ち役の返事を待つ長さ

const WAIT_OBJECT_0 = 0;
const WAIT_ABANDONED = 0x80;
const WAIT_TIMEOUT = 0x102;
const SYNCHRONIZE = 0x00100000;
const TH32CS_SNAPPROCESS = 0x2;
const PROCESSENTRY32W_SIZE = 568; // x64 の配置 (dwSize 0 ・ th32ProcessID 8 ・ th32ParentProcessID 32)

const USAGE = `ui-lock: 画面 ・ マウス ・ キーを使う作業を、全プロジェクトで 1 つずつにする

使い方:
  ui-lock run [--timeout <時間>] [--wait <時間>] [--also <名前>]… [--evict-user-after <時間>] -- <コマンド> [引数…]
      ロックを取ってコマンドを流し、終わったら放す。子には UI_LOCK_HELD=<ui-lock の pid> を渡す
      --timeout  実行の上限 (既定 10m)。過ぎたら子のプロセスごと止めて放す (終了コード 4)
      --wait     取れるまで待つ上限 (既定 60m)。過ぎたら終了コード 3
                 待つ間は 1 分ごとに持ち主を出し、5 分ごとに Windows のトーストで知らせる
      --also     一緒に取るロックの名前 (移行中の古い名前。例 Local\\fm-ui-tests)。何度でも書ける
      --evict-user-after
                 持ち主が利用者のとき、この長さ待ったら持ち主の fm へ終了を知らせる (既定 10m)
      包まれた中で呼ばれ、UI_LOCK_HELD の pid が持ち主で自分の祖先なら、取らずにそのまま流す
  ui-lock hold --kind user --pid <pid> [--also <名前>]…
      利用者の画面操作のためにロックを取る。<pid> のプロセスが消えるか release で放す
      取れれば 0。ほかが持っていれば待たずに 1
  ui-lock release [--pid <pid>]
      hold で取ったロックを放す
  ui-lock status
      今の持ち主を出す (空きなら 0、使用中なら 1)

時間は 30s ・ 10m ・ 1h の形。
終了コード: 子の終了コード / 1 使用中 / 3 待ちの上限 / 4 実行の上限 / 5 引数の誤り
`;

function lockName(): string { return process.env.UI_LOCK_NAME || 'Local\\ai-interactive-desktop'; }
function ownerDir(): string {
	return process.env.UI_LOCK_DIR || path.join(process.env.LOCALAPPDATA || '', 'ai-interactive-desktop');
}
function ownerPath(): string { return path.join(ownerDir(), 'owner.json'); }
function releaseEventName(): string { return lockName() + '-release'; }
function quitEventName(pid: number): string { return lockName() + '-quit-' + pid; }

class BadArgs extends Error {}

function parseDuration(s: string | undefined): number {
	const m = /^(\d+)(s|m|h)$/.exec(s ?? '');
	if (!m) throw new BadArgs('時間の形が違う: ' + s + ' (30s ・ 10m ・ 1h の形)');
	return Number(m[1]) * (m[2] === 's' ? 1 : m[2] === 'm' ? 60 : 3600);
}

function parsePid(s: string | undefined): number {
	if (!s || !/^\d+$/.test(s)) throw new BadArgs('--pid に数を書いてください: ' + (s ?? ''));
	return Number(s);
}

/** kind は command (run が取った) か user (hold が取った)。forPid は user のとき守る相手の pid */
interface Owner {
	kind?: 'command' | 'user';
	project: string;
	worktree: string;
	command: string;
	started: string;
	pid: number;
	forPid?: number;
	timeoutSec: number;
}

function nowText(): string {
	const d = new Date();
	const p = (n: number): string => String(n).padStart(2, '0');
	return d.getFullYear() + '/' + p(d.getMonth() + 1) + '/' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds());
}

function readOwner(): Owner | null {
	try { return JSON.parse(fs.readFileSync(ownerPath(), 'utf8')) as Owner; } catch { return null; }
}

function writeOwner(o: Owner): void {
	fs.mkdirSync(ownerDir(), { recursive: true });
	writeAtomic(ownerPath(), Buffer.from(JSON.stringify(o, null, '\t') + '\n', 'utf8'));
}

/** 自分が書いた記録だけを消す */
function removeOwnerIfMine(pid: number): void {
	const o = readOwner();
	if (o != null && o.pid === pid) { try { fs.rmSync(ownerPath()); } catch { /* 消せなくても放す */ } }
}

function ownerText(o: Owner | null): string {
	if (o == null) return '持ち主の記録がありません';
	if (o.kind === 'user') return '利用者が使用中: ' + o.project + ' (pid ' + o.forPid + ')  開始 ' + o.started;
	return o.project + ' (pid ' + o.pid + ') ' + o.command + '  開始 ' + o.started + '  上限 ' + Math.round(o.timeoutSec / 60) + ' 分';
}

function whereAmI(): { project: string; worktree: string } {
	const r = spawnSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' });
	const top = r.status === 0 ? r.stdout.trim() : process.cwd();
	return { project: path.basename(top), worktree: top };
}

/* ---- Windows API (bun:ffi / koffi) ---- */

type H = unknown;
interface K32 {
	CreateMutexW: (a: null, owned: number, name: unknown) => H;
	CreateEventW: (a: null, manual: number, initial: number, name: unknown) => H;
	SetEvent: (h: H) => number;
	WaitForSingleObject: (h: H, ms: number) => number;
	ReleaseMutex: (h: H) => number;
	CloseHandle: (h: H) => number;
	OpenProcess: (access: number, inherit: number, pid: number) => H;
	CreateToolhelp32Snapshot: (flags: number, pid: number) => H;
	Process32FirstW: (h: H, entry: unknown) => number;
	Process32NextW: (h: H, entry: unknown) => number;
}

interface Api { k32: K32; buf: (b: Buffer) => unknown; wide: (s: string) => unknown }

let apiCache: Api | null = null;

async function loadApi(): Promise<Api> {
	if (apiCache) return apiCache;
	if (typeof (globalThis as { Bun?: unknown }).Bun === 'undefined') {
		// node では koffi で同じものを呼ぶ (決定 255-A)。Buffer はそのまま void * に渡せる
		const koffi = (await import('koffi' as string)).default;
		const lib = koffi.load('kernel32.dll');
		const k32 = {
			CreateMutexW: lib.func('void * __stdcall CreateMutexW(void *, int, void *)'),
			CreateEventW: lib.func('void * __stdcall CreateEventW(void *, int, int, void *)'),
			SetEvent: lib.func('int __stdcall SetEvent(void *)'),
			WaitForSingleObject: lib.func('uint32 __stdcall WaitForSingleObject(void *, uint32)'),
			ReleaseMutex: lib.func('int __stdcall ReleaseMutex(void *)'),
			CloseHandle: lib.func('int __stdcall CloseHandle(void *)'),
			OpenProcess: lib.func('void * __stdcall OpenProcess(uint32, int, uint32)'),
			CreateToolhelp32Snapshot: lib.func('void * __stdcall CreateToolhelp32Snapshot(uint32, uint32)'),
			Process32FirstW: lib.func('int __stdcall Process32FirstW(void *, void *)'),
			Process32NextW: lib.func('int __stdcall Process32NextW(void *, void *)'),
		};
		const buf = (b: Buffer): unknown => b;
		apiCache = { k32: k32 as unknown as K32, buf, wide: (s: string) => Buffer.from(s + '\0', 'utf16le') };
		return apiCache;
	}
	// 直に 'bun:ffi' と書くと node の型定義に無いため tsc が止まる。組み立ててから読む
	const { dlopen, FFIType, ptr } = await import('bun' + ':ffi');
	const P = FFIType.ptr;
	const { symbols } = dlopen('kernel32.dll', {
		CreateMutexW: { args: [P, FFIType.i32, P], returns: P },
		CreateEventW: { args: [P, FFIType.i32, FFIType.i32, P], returns: P },
		SetEvent: { args: [P], returns: FFIType.i32 },
		WaitForSingleObject: { args: [P, FFIType.u32], returns: FFIType.u32 },
		ReleaseMutex: { args: [P], returns: FFIType.i32 },
		CloseHandle: { args: [P], returns: FFIType.i32 },
		OpenProcess: { args: [FFIType.u32, FFIType.i32, FFIType.u32], returns: P },
		CreateToolhelp32Snapshot: { args: [FFIType.u32, FFIType.u32], returns: P },
		Process32FirstW: { args: [P, P], returns: FFIType.i32 },
		Process32NextW: { args: [P, P], returns: FFIType.i32 },
	});
	const keep: Buffer[] = [];
	const buf = (b: Buffer): unknown => { keep.push(b); return ptr(b); };
	apiCache = { k32: symbols as unknown as K32, buf, wide: (s: string) => buf(Buffer.from(s + '\0', 'utf16le')) };
	return apiCache;
}

/** 名前付きイベントを立てる (無ければ作ってから立てる) */
function setEvent(api: Api, name: string): void {
	const h = api.k32.CreateEventW(null, 0, 0, api.wide(name));
	if (h) { api.k32.SetEvent(h); api.k32.CloseHandle(h); }
}

function isAlive(api: Api, pid: number): boolean {
	const h = api.k32.OpenProcess(SYNCHRONIZE, 0, pid);
	if (!h) return false;
	const r = api.k32.WaitForSingleObject(h, 0);
	api.k32.CloseHandle(h);
	return r === WAIT_TIMEOUT;
}

/** pid が自分の祖先か (プロセスの親子を、自分から上へたどる。決定 258-B) */
function isAncestor(api: Api, pid: number): boolean {
	const snap = api.k32.CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0);
	if (!snap || snap === -1 || snap === BigInt(-1)) return false;
	const parent = new Map<number, number>();
	const e = Buffer.alloc(PROCESSENTRY32W_SIZE);
	e.writeUInt32LE(PROCESSENTRY32W_SIZE, 0);
	const p = api.buf(e);
	let ok = api.k32.Process32FirstW(snap, p);
	while (ok) {
		parent.set(e.readUInt32LE(8), e.readUInt32LE(32));
		ok = api.k32.Process32NextW(snap, p);
	}
	api.k32.CloseHandle(snap);
	let cur = process.pid;
	for (let i = 0; i < 64; i++) {
		const up = parent.get(cur);
		if (up == null || up === 0 || up === cur) return false;
		if (up === pid) return true;
		cur = up;
	}
	return false;
}

class Locks {
	private held: H[] = [];
	// node の型の取り除き (strip-types) は引数のプロパティを受け付けないので、手で持つ
	private api: Api;
	private names: string[];
	constructor(api: Api, names: string[]) {
		this.api = api;
		this.names = names;
	}

	/** 全部を取れたら ok。1 つでも取れなければ、取った分を放して ok=false (取り合いで固まらないため) */
	tryAll(): { ok: boolean; abandoned: boolean } {
		const k = this.api.k32;
		let abandoned = false;
		for (const name of this.names) {
			const h = k.CreateMutexW(null, 0, this.api.wide(name));
			if (!h) throw new Error('CreateMutexW が失敗しました: ' + name);
			const r = k.WaitForSingleObject(h, 0);
			if (r === WAIT_OBJECT_0 || r === WAIT_ABANDONED) {
				if (r === WAIT_ABANDONED) abandoned = true;
				this.held.push(h);
			} else {
				k.CloseHandle(h);
				this.releaseAll();
				return { ok: false, abandoned: false };
			}
		}
		return { ok: true, abandoned };
	}

	releaseAll(): void {
		for (const h of this.held.reverse()) { this.api.k32.ReleaseMutex(h); this.api.k32.CloseHandle(h); }
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

/** 子を流して終了コードを返す。上限を過ぎたら子ごと止めて 4 */
function runChild(command: string, timeoutSec: number, env: NodeJS.ProcessEnv, cleanup: () => void): Promise<number> {
	return new Promise<number>((resolve) => {
		const child = spawn(command, { stdio: 'inherit', shell: true, windowsHide: false, env });
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

/* ---- 下位コマンド ---- */

async function status(): Promise<number> {
	const api = await loadApi();
	const locks = new Locks(api, [lockName()]);
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
	let evictSec = DEFAULT_EVICT_SEC;
	const also: string[] = [];
	for (let i = 0; i < opts.length; i++) {
		const o = opts[i];
		if (o === '--timeout') timeoutSec = parseDuration(opts[++i]);
		else if (o === '--wait') waitSec = parseDuration(opts[++i]);
		else if (o === '--evict-user-after') evictSec = parseDuration(opts[++i]);
		else if (o === '--also') { const v = opts[++i]; if (!v) throw new BadArgs('--also に名前が要ります'); also.push(v); }
		else throw new BadArgs('知らないオプション: ' + o);
	}

	const api = await loadApi();
	const command = cmd.map(quote).join(' ');

	// 包まれた中: 持ち主が祖先なら、取らずにそのまま流す (決定 258-B)
	const held = Number(process.env.UI_LOCK_HELD || '');
	if (held > 0) {
		const o = readOwner();
		if (o != null && o.pid === held && isAncestor(api, held)) {
			return runChild(command, timeoutSec, process.env, () => {});
		}
	}

	const locks = new Locks(api, [lockName(), ...also]);

	// 取れるまで待つ
	const t0 = Date.now();
	let lastPrint = -Infinity;
	let lastToast = Date.now();
	const evicted = new Set<number>();
	let got = locks.tryAll();
	while (!got.ok) {
		const now = Date.now();
		const o = readOwner();
		if (now - lastPrint >= OWNER_PRINT_SEC * 1000) {
			console.log('[待ち] ' + nowText() + ' 使用中: ' + ownerText(o));
			lastPrint = now;
		}
		if (now - lastToast >= TOAST_SEC * 1000) {
			const me = whereAmI();
			const who = o?.kind === 'user' ? '利用者が使用中です' : '持ち主: ' + ownerText(o);
			toast('ui-lock を待っています', me.project + ' が ' + Math.round((now - t0) / 60000) + ' 分待っています。' + who);
			lastToast = now;
		}
		if (o?.kind === 'user' && o.forPid != null && !evicted.has(o.forPid) && now - t0 >= evictSec * 1000) {
			setEvent(api, quitEventName(o.forPid));
			evicted.add(o.forPid);
			console.log('[!] 利用者の画面 (pid ' + o.forPid + ') へ終了を知らせました');
		}
		if (now - t0 >= waitSec * 1000) {
			console.log('[NG] 待ちの上限 (' + Math.round(waitSec / 60 * 10) / 10 + ' 分) を過ぎました。' + ownerText(o));
			return EXIT_WAIT_TIMEOUT;
		}
		await new Promise((r) => setTimeout(r, 1000));
		got = locks.tryAll();
	}
	// 取れたのに記録が残っていれば、前の持ち主は放さずに死んだ (WAIT_ABANDONED が返らない場合もこれで拾う)
	const prev = readOwner();
	if (got.abandoned || (prev != null && prev.kind !== 'user')) console.log('[!] 前の持ち主が放棄したロックを取りました: ' + ownerText(prev));

	writeOwner({ kind: 'command', ...whereAmI(), command, started: nowText(), pid: process.pid, timeoutSec });
	const cleanup = (): void => { removeOwnerIfMine(process.pid); locks.releaseAll(); };
	return runChild(command, timeoutSec, { ...process.env, UI_LOCK_HELD: String(process.pid) }, cleanup);
}

function parseHoldArgs(args: string[]): { forPid: number; also: string[] } {
	let forPid = 0;
	let kind = '';
	const also: string[] = [];
	for (let i = 0; i < args.length; i++) {
		const o = args[i];
		if (o === '--pid') forPid = parsePid(args[++i]);
		else if (o === '--kind') kind = args[++i] ?? '';
		else if (o === '--also') { const v = args[++i]; if (!v) throw new BadArgs('--also に名前が要ります'); also.push(v); }
		else throw new BadArgs('知らないオプション: ' + o);
	}
	if (kind !== 'user') throw new BadArgs('--kind user を書いてください');
	if (!forPid) throw new BadArgs('--pid を書いてください');
	return { forPid, also };
}

async function hold(args: string[]): Promise<number> {
	const { forPid } = parseHoldArgs(args);
	const api = await loadApi();
	const cur = readOwner();
	if (cur?.kind === 'user' && cur.forPid === forPid && isAlive(api, cur.pid)) {
		console.log('持っています: ' + ownerText(cur));
		return 0;
	}
	// 持ち役を裏で起こし、取れたか (owner.json に自分の pid) か、取れずに終わったかを待つ
	const self = fileURLToPath(import.meta.url);
	const holder = spawn(process.execPath, [self, '__holder', ...args], { detached: true, stdio: 'ignore', windowsHide: true });
	let exited: number | null = null;
	holder.on('exit', (c) => { exited = c ?? 1; });
	holder.unref();
	const end = Date.now() + HOLD_READY_SEC * 1000;
	while (Date.now() < end) {
		const o = readOwner();
		if (o != null && o.pid === holder.pid) { console.log('取りました: ' + ownerText(o)); return 0; }
		if (exited != null) break;
		await new Promise((r) => setTimeout(r, 50));
	}
	console.log('使用中: ' + ownerText(readOwner()));
	if (exited == null) killTree(holder);
	return EXIT_BUSY;
}

/** 裏の持ち役。取れなければすぐ 1 で終わる。取れたら --pid が消えるか release を受けるまで持つ */
async function holder(args: string[]): Promise<number> {
	const { forPid, also } = parseHoldArgs(args);
	const api = await loadApi();
	const locks = new Locks(api, [lockName(), ...also]);
	if (!locks.tryAll().ok) return EXIT_BUSY;
	// 前の release の立ちっぱなしを読み捨てる (自動で戻るイベント)
	const ev = api.k32.CreateEventW(null, 0, 0, api.wide(releaseEventName()));
	api.k32.WaitForSingleObject(ev, 0);
	writeOwner({ kind: 'user', ...whereAmI(), command: 'hold', started: nowText(), pid: process.pid, forPid, timeoutSec: 0 });
	for (;;) {
		await new Promise((r) => setTimeout(r, 300));
		if (api.k32.WaitForSingleObject(ev, 0) === WAIT_OBJECT_0) break;
		if (!isAlive(api, forPid)) break;
	}
	removeOwnerIfMine(process.pid);
	locks.releaseAll();
	api.k32.CloseHandle(ev);
	return 0;
}

async function release(args: string[]): Promise<number> {
	let forPid = 0;
	for (let i = 0; i < args.length; i++) {
		if (args[i] === '--pid') forPid = parsePid(args[++i]);
		else throw new BadArgs('知らないオプション: ' + args[i]);
	}
	const api = await loadApi();
	const o = readOwner();
	if (o == null || o.kind !== 'user') { console.log('利用者の hold はありません'); return 0; }
	if (forPid && o.forPid !== forPid) { console.log('ほかの pid の hold です: ' + ownerText(o)); return EXIT_BUSY; }
	setEvent(api, releaseEventName());
	const end = Date.now() + HOLD_READY_SEC * 1000;
	while (Date.now() < end) {
		const n = readOwner();
		if (n == null || n.pid !== o.pid) { console.log('放しました'); return 0; }
		await new Promise((r) => setTimeout(r, 50));
	}
	console.log('[NG] 持ち役が放しません: ' + ownerText(o));
	return EXIT_BUSY;
}

async function main(argv: string[]): Promise<number> {
	if (argv.length === 0 || argv[0] === '--help' || argv[0] === '-h') { console.log(USAGE); return argv.length === 0 ? EXIT_BAD_ARGS : 0; }
	try {
		if (argv[0] === 'status') return await status();
		if (argv[0] === 'run') return await run(argv.slice(1));
		if (argv[0] === 'hold') return await hold(argv.slice(1));
		if (argv[0] === 'release') return await release(argv.slice(1));
		if (argv[0] === '__holder') return await holder(argv.slice(1));
		throw new BadArgs('知らない下位コマンド: ' + argv[0]);
	} catch (e) {
		if (e instanceof BadArgs) { console.error('[NG] ' + e.message); console.error(USAGE); return EXIT_BAD_ARGS; }
		throw e;
	}
}

process.exitCode = await main(process.argv.slice(2));
