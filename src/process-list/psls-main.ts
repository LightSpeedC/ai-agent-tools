/*
	psls — プロセス一覧をツリー表示する。

	Windows のプロセス列挙・情報取得を bun:ffi で直接行う（子プロセスを
	起動しない）。bun:ffi は Bun 専用のため、このツールは Bun 必須で
	Node では動かせない（node:tty のような代替経路が無いため）。

	計画: notes/10_plan/p260921-01-プロセス一覧.html
*/

import { parseArgs } from '../lib/args.ts';
import { enableWindowsConsoleVt } from '../lib/win-console.ts';

const ExitOk = 0;
const ExitBadArgs = 2;
const ExitNeedBun = 3;

const Usage =
	'プロセス一覧をツリー表示する\n'
	+ '\n'
	+ '  psls [オプション] [キーワード]\n'
	+ '\n'
	+ '  キーワードを渡すと、それを含む行だけに絞り込む（大小文字は区別しない）。\n'
	+ '  一致した行は太字にし、ツリーの形を保つため祖先も残す。\n'
	+ '  物理メモリ使用量は B・K・M・G のうち収まる単位で表示する。\n'
	+ '\n'
	+ '  -f, --full-path  exe 欄をフルパスで表示する（既定はファイル名のみ）\n'
	+ '  --no-trim        コマンド行を端末幅で切り詰めない\n'
	+ '  -h, --help       この説明を表示する\n';

/**
 * 表示幅を数える（ASCII・半角ｶﾀｶﾅは1桁、それ以外は2桁）。
 * 共通ルール「全角・半角混在のテキストを桁揃えするとき」に従い、
 * 手でスペースを数えずに計算する
 */
function displayWidth(s: string): number {
	let w = 0;
	for (const ch of s) {
		const c = ch.codePointAt(0) ?? 0;
		w += (c < 0x80 || (c >= 0xff61 && c <= 0xff9f)) ? 1 : 2;
	}
	return w;
}

/** target 桁まで右側を空白で埋める */
function padEndWidth(s: string, target: number): string {
	return s + ' '.repeat(Math.max(0, target - displayWidth(s)));
}

/** target 桁まで左側を空白で埋める */
function padStartWidth(s: string, target: number): string {
	return ' '.repeat(Math.max(0, target - displayWidth(s))) + s;
}

/** maxWidth 桁に収まるよう切り詰める。切り詰めたら末尾を "..." にする */
function truncateToWidth(s: string, maxWidth: number): string {
	if (displayWidth(s) <= maxWidth) { return s; }
	if (maxWidth <= 3) { return '.'.repeat(Math.max(0, maxWidth)); }
	let w = 0;
	let cut = '';
	for (const ch of s) {
		const cw = displayWidth(ch);
		if (w + cw > maxWidth - 3) { break; }
		cut += ch;
		w += cw;
	}
	return cut + '...';
}

/** exe のフルパスからファイル名だけを取り出す（\ ・ / どちらも区切りとして扱う） */
function basename(p: string): string {
	const idx = Math.max(p.lastIndexOf('\\'), p.lastIndexOf('/'));
	return idx >= 0 ? p.slice(idx + 1) : p;
}

/** exe のフルパスからファイル名を除いたディレクトリ部分を取り出す */
function dirname(p: string): string {
	const idx = Math.max(p.lastIndexOf('\\'), p.lastIndexOf('/'));
	return idx >= 0 ? p.slice(0, idx + 1) : '';
}

function out(s: string): void {
	process.stdout.write(s);
}

function fail(message: string): number {
	process.stderr.write(message + '\n\n' + Usage);
	return ExitBadArgs;
}

interface ProcessInfo {
	pid: number;
	ppid: number;
	/** Toolhelp32 が返す実行ファイル名（パス無し）。フルパスが取れないときの代わり */
	name: string;
	/** フルパス。取れなければ name と同じ */
	exe: string;
	/** 起動時刻。取れなければ null */
	creation: Date | null;
	/** コマンドライン全体。取れなければ null */
	cmdline: string | null;
	/** 物理メモリ使用量（ワーキングセット、バイト）。取れなければ null */
	mem: number | null;
}

// ---- Win32 API（bun:ffi） ----

const TH32CS_SNAPPROCESS = 0x00000002;
const PROCESS_QUERY_LIMITED_INFORMATION = 0x1000;
const PROCESS_VM_READ = 0x0010;
const ProcessCommandLineInformation = 60;

/**
 * PROCESS_MEMORY_COUNTERS（x64）のオフセット。
 *   cb4 PageFaultCount4 PeakWorkingSetSize8 WorkingSetSize8 …（以下 SIZE_T が続く）
 */
const MemCountersSize = 72;
const MemOff = { cb: 0, workingSetSize: 16 };

/**
 * PROCESSENTRY32W（x64）のオフセット。ドキュメント化された構造体で
 * Windows 2000 以降変わっていないが、アラインメントは自分で計算する必要がある。
 *   dwSize4 cntUsage4 th32ProcessID4 [pad4] th32DefaultHeapID8
 *   th32ModuleID4 cntThreads4 th32ParentProcessID4 pcPriClassBase4 dwFlags4
 *   szExeFile[260]WCHAR
 */
const Off = { size: 0, pid: 8, defaultHeapId: 16, moduleId: 24, threads: 28, ppid: 32, priClassBase: 36, flags: 40, exeFile: 44 };
const MaxPath = 260;
const ProcessEntrySize = Math.ceil((Off.exeFile + MaxPath * 2) / 8) * 8;

/**
 * 自プロセスのトークンで SeDebugPrivilege を有効化する（既に管理者として実行している
 * ときだけ効く。一般ユーザーのトークンにはこの特権自体が無いため、静かに失敗するだけで
 * 副作用は無い）。有効化できると、DACL に関わらずほぼ任意のプロセスを開けるようになり、
 * PROCESS_VM_READ が必要なメモリ取得（GetProcessMemoryInfo）で他ユーザー・SYSTEM の
 * プロセスも対象にできる。Protected Process（Light）（Secure System・Registry 等）は
 * カーネルレベルの保護のため、これを有効にしても開けない
 */
function enableDebugPrivilege(
	advapi32: Record<string, (...a: unknown[]) => number>,
	k32: Record<string, (...a: unknown[]) => number>,
	ptrOf: (b: Uint8Array) => number
): void {
	const TOKEN_ADJUST_PRIVILEGES = 0x0020;
	const TOKEN_QUERY = 0x0008;
	const SE_PRIVILEGE_ENABLED = 0x00000002;
	const CurrentProcessPseudoHandle = -1;

	const tokenBuf = new Uint8Array(8);
	const okOpen = advapi32.OpenProcessToken(CurrentProcessPseudoHandle, TOKEN_ADJUST_PRIVILEGES | TOKEN_QUERY, ptrOf(tokenBuf));
	if (!okOpen) { return; }
	const hToken = Number(new DataView(tokenBuf.buffer).getBigUint64(0, true));

	try {
		// TOKEN_PRIVILEGES（1個分）: PrivilegeCount4 LUID.LowPart4 LUID.HighPart4 Attributes4
		const nameBuf = Buffer.from('SeDebugPrivilege\0', 'utf16le');
		const privBuf = new Uint8Array(16);
		const view = new DataView(privBuf.buffer);
		view.setUint32(0, 1, true);
		const okLookup = advapi32.LookupPrivilegeValueW(0, ptrOf(nameBuf), ptrOf(privBuf.subarray(4, 12)));
		if (!okLookup) { return; }
		view.setUint32(12, SE_PRIVILEGE_ENABLED, true);
		advapi32.AdjustTokenPrivileges(hToken, 0, ptrOf(privBuf), 16, 0, 0);
	} finally {
		k32.CloseHandle(hToken);
	}
}

async function loadWin32() {
	const { dlopen, FFIType, ptr } = await import('bun:ffi');
	const { symbols: k32 } = dlopen('kernel32.dll', {
		CreateToolhelp32Snapshot: { args: [FFIType.u32, FFIType.u32], returns: FFIType.ptr },
		Process32FirstW: { args: [FFIType.ptr, FFIType.ptr], returns: FFIType.i32 },
		Process32NextW: { args: [FFIType.ptr, FFIType.ptr], returns: FFIType.i32 },
		CloseHandle: { args: [FFIType.ptr], returns: FFIType.i32 },
		OpenProcess: { args: [FFIType.u32, FFIType.i32, FFIType.u32], returns: FFIType.ptr },
		QueryFullProcessImageNameW: { args: [FFIType.ptr, FFIType.u32, FFIType.ptr, FFIType.ptr], returns: FFIType.i32 },
		GetProcessTimes: { args: [FFIType.ptr, FFIType.ptr, FFIType.ptr, FFIType.ptr, FFIType.ptr], returns: FFIType.i32 },
		K32GetProcessMemoryInfo: { args: [FFIType.ptr, FFIType.ptr, FFIType.u32], returns: FFIType.i32 },
	});
	const { symbols: ntdll } = dlopen('ntdll.dll', {
		NtQueryInformationProcess: { args: [FFIType.ptr, FFIType.u32, FFIType.ptr, FFIType.u32, FFIType.ptr], returns: FFIType.i32 },
	});
	const { symbols: advapi32 } = dlopen('advapi32.dll', {
		OpenProcessToken: { args: [FFIType.ptr, FFIType.u32, FFIType.ptr], returns: FFIType.i32 },
		LookupPrivilegeValueW: { args: [FFIType.ptr, FFIType.ptr, FFIType.ptr], returns: FFIType.i32 },
		AdjustTokenPrivileges: { args: [FFIType.ptr, FFIType.i32, FFIType.ptr, FFIType.u32, FFIType.ptr, FFIType.ptr], returns: FFIType.i32 },
	});
	const ptrOf = (b: Uint8Array) => Number(ptr(b));
	try {
		enableDebugPrivilege(advapi32, k32, ptrOf);
	} catch {
		// 一般ユーザーでは SeDebugPrivilege 自体が無く、失敗して当然。
		// 今まで通り自分が開けるプロセスだけ取得する
	}
	return { k32, ntdll, ptr };
}

/** Toolhelp32 でプロセス一覧（pid・親pid・実行ファイル名）を取る */
function snapshotProcesses(k32: Record<string, (...a: unknown[]) => number>, ptrOf: (b: Uint8Array) => number): { pid: number; ppid: number; name: string }[] {
	const buf = new Uint8Array(ProcessEntrySize);
	const view = new DataView(buf.buffer);
	view.setUint32(Off.size, ProcessEntrySize, true);

	const hSnap = k32.CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0);
	if (!hSnap) { return []; }

	const list: { pid: number; ppid: number; name: string }[] = [];
	try {
		let ok = k32.Process32FirstW(hSnap, ptrOf(buf));
		while (ok) {
			const pid = view.getUint32(Off.pid, true);
			const ppid = view.getUint32(Off.ppid, true);
			let end = 0;
			while (end < MaxPath && view.getUint16(Off.exeFile + end * 2, true) !== 0) { end++; }
			const name = Buffer.from(buf.buffer, Off.exeFile, end * 2).toString('utf16le');
			list.push({ pid, ppid, name });
			view.setUint32(Off.size, ProcessEntrySize, true);
			ok = k32.Process32NextW(hSnap, ptrOf(buf));
		}
	} finally {
		k32.CloseHandle(hSnap);
	}
	return list;
}

/** FILETIME（100ns 間隔、1601-01-01 起点）8バイトを Date にする */
function filetimeToDate(buf: Uint8Array, byteOffset: number): Date {
	const dv = new DataView(buf.buffer, buf.byteOffset + byteOffset, 8);
	const low = dv.getUint32(0, true);
	const high = dv.getUint32(4, true);
	const filetime = BigInt(high) * 4294967296n + BigInt(low);
	const unixMs = Number(filetime / 10000n) - 11644473600000;
	return new Date(unixMs);
}

/** pid を開いて、フルパス・起動時刻・コマンドライン全体を取る（開けなければ null のまま） */
function queryProcessDetail(
	pid: number,
	k32: Record<string, (...a: unknown[]) => number>,
	ntdll: Record<string, (...a: unknown[]) => number>,
	ptrOf: (b: Uint8Array) => number
): { exe: string | null; creation: Date | null; cmdline: string | null; mem: number | null } {
	const h = k32.OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid);
	if (!h) { return { exe: null, creation: null, cmdline: null, mem: null }; }
	try {
		// フルパス
		let exe: string | null = null;
		const nameBuf = new Uint8Array(32768 * 2);
		const sizeBuf = new Uint8Array(4);
		new DataView(sizeBuf.buffer).setUint32(0, 32768, true);
		const ok1 = k32.QueryFullProcessImageNameW(h, 0, ptrOf(nameBuf), ptrOf(sizeBuf));
		if (ok1) {
			const len = new DataView(sizeBuf.buffer).getUint32(0, true);
			exe = Buffer.from(nameBuf.buffer, 0, len * 2).toString('utf16le');
		}

		// 起動時刻
		let creation: Date | null = null;
		const times = new Uint8Array(8 * 4);
		const ok2 = k32.GetProcessTimes(h, ptrOf(times.subarray(0, 8)), ptrOf(times.subarray(8, 16)), ptrOf(times.subarray(16, 24)), ptrOf(times.subarray(24, 32)));
		if (ok2) { creation = filetimeToDate(times, 0); }

		// コマンドライン全体（1回目でサイズを聞き、2回目で本体を取る）
		let cmdline: string | null = null;
		const retLen = new Uint8Array(4);
		ntdll.NtQueryInformationProcess(h, ProcessCommandLineInformation, 0, 0, ptrOf(retLen));
		const need = new DataView(retLen.buffer).getUint32(0, true);
		if (need > 0) {
			const cmdBuf = new Uint8Array(need);
			const status = ntdll.NtQueryInformationProcess(h, ProcessCommandLineInformation, ptrOf(cmdBuf), need, ptrOf(retLen));
			if (status === 0) {
				// UNICODE_STRING: Length(u16) MaximumLength(u16) [pad4] Buffer(ptr8)
				// Buffer はこの応答バッファ自身の16バイト目を指すので、そのまま読める
				const length = new DataView(cmdBuf.buffer).getUint16(0, true);
				const raw = Buffer.from(cmdBuf.buffer, 16, length).toString('utf16le');
				// 埋め込みの改行（複数行のスクリプトを引数に持つプロセス等）を
				// 空白に変える。1プロセス＝1行を保たないとツリー表示が崩れる
				cmdline = raw.replace(/[\r\n]+/g, ' ');
			}
		}

		// 物理メモリ使用量（ワーキングセット）。GetProcessMemoryInfo は PROCESS_VM_READ も
		// 要るため、上のハンドルとは別に開く（同じ OpenProcess に足すと、VM_READ が
		// 取れないプロセスでハンドル自体が取れなくなり、exe・起動時刻・コマンドライン
		// まで巻き添えで取れなくなる。実機で確認済みの退行）
		let mem: number | null = null;
		const hMem = k32.OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION | PROCESS_VM_READ, 0, pid);
		if (hMem) {
			try {
				const memBuf = new Uint8Array(MemCountersSize);
				new DataView(memBuf.buffer).setUint32(MemOff.cb, MemCountersSize, true);
				const ok3 = k32.K32GetProcessMemoryInfo(hMem, ptrOf(memBuf), MemCountersSize);
				if (ok3) { mem = Number(new DataView(memBuf.buffer).getBigUint64(MemOff.workingSetSize, true)); }
			} finally {
				k32.CloseHandle(hMem);
			}
		}

		return { exe, creation, cmdline, mem };
	} finally {
		k32.CloseHandle(h);
	}
}

/** JST の yyyy/mm/dd hh:mm:ss にする（GetProcessTimes は UTC で返る） */
function formatJst(date: Date): string {
	const jst = new Date(date.getTime() + 9 * 3600 * 1000);
	const p2 = (n: number) => String(n).padStart(2, '0');
	return jst.getUTCFullYear() + '/' + p2(jst.getUTCMonth() + 1) + '/' + p2(jst.getUTCDate())
		+ ' ' + p2(jst.getUTCHours()) + ':' + p2(jst.getUTCMinutes()) + ':' + p2(jst.getUTCSeconds());
}

/** 経過時間を d日 hh:mm:ss（1日未満は日を省く）にする */
function formatElapsed(ms: number): string {
	let totalSec = Math.max(0, Math.floor(ms / 1000));
	const days = Math.floor(totalSec / 86400);
	totalSec %= 86400;
	const hh = Math.floor(totalSec / 3600);
	totalSec %= 3600;
	const mm = Math.floor(totalSec / 60);
	const ss = totalSec % 60;
	const p2 = (n: number) => String(n).padStart(2, '0');
	const hms = p2(hh) + ':' + p2(mm) + ':' + p2(ss);
	return days > 0 ? days + '日 ' + hms : hms;
}

/** バイト数を B・K・M・G のうち収まる単位1つ（小数第1位まで）にする。null は '-' */
function formatMem(bytes: number | null): string {
	if (bytes == null) { return '-'; }
	if (bytes < 1024) { return bytes + 'B'; }
	if (bytes < 1024 * 1024) { return (bytes / 1024).toFixed(1) + 'K'; }
	if (bytes < 1024 * 1024 * 1024) { return (bytes / (1024 * 1024)).toFixed(1) + 'M'; }
	return (bytes / (1024 * 1024 * 1024)).toFixed(1) + 'G';
}

/**
 * 表示・キーワード絞り込みに使う1行の文字列を組み立てる（桁揃え無し）。
 * branch はツリーの罫線＋インデント（exe とコマンド行の間に入る）
 */
function buildLine(p: ProcessInfo, now: number, branch: string, exeLabel: string): string {
	const timeStr = p.creation ? formatJst(p.creation) : '-';
	const elapsedStr = p.creation ? '(' + formatElapsed(now - p.creation.getTime()) + ')' : '(-)';
	const cmd = p.cmdline ?? '(-)';
	return String(p.pid) + '  ' + timeStr + ' ' + elapsedStr + '  ' + formatMem(p.mem) + '  ' + exeLabel + '  ' + branch + cmd;
}

/**
 * 親子関係を組み立てる。親 pid が居ない（親が先に終わっている等）・
 * 自分自身が親（pid 0 の [System Process] 等）は根として扱う
 */
function buildTree(list: ProcessInfo[]): { byPid: Map<number, ProcessInfo>; children: Map<number, number[]>; roots: number[] } {
	const byPid = new Map(list.map((p) => [p.pid, p]));
	const children = new Map<number, number[]>();
	const roots: number[] = [];
	for (const p of list) {
		if (p.pid === p.ppid || !byPid.has(p.ppid)) {
			roots.push(p.pid);
			continue;
		}
		const siblings = children.get(p.ppid);
		if (siblings) { siblings.push(p.pid); } else { children.set(p.ppid, [p.pid]); }
	}
	return { byPid, children, roots };
}

/** pid の祖先の pid を根に近い側から返す（循環・深さ超過は打ち切る） */
function ancestorsOf(pid: number, byPid: Map<number, ProcessInfo>): number[] {
	const result: number[] = [];
	const seen = new Set<number>([pid]);
	let cur = byPid.get(pid);
	for (let depth = 0; depth < 10000 && cur != null; depth++) {
		const parent = byPid.get(cur.ppid);
		if (parent == null || cur.pid === cur.ppid || seen.has(parent.pid)) { break; }
		result.unshift(parent.pid);
		seen.add(parent.pid);
		cur = parent;
	}
	return result;
}

/** キーワードに一致する pid と、表示すべき（一致 or 一致の祖先の）pid を求める */
function computeVisible(list: ProcessInfo[], byPid: Map<number, ProcessInfo>, keyword: string | null, now: number): { visible: Set<number>; matched: Set<number> } {
	if (keyword == null) { return { visible: new Set(list.map((p) => p.pid)), matched: new Set() }; }
	const kw = keyword.toLowerCase();
	const matched = new Set<number>();
	const visible = new Set<number>();
	for (const p of list) {
		if (!buildLine(p, now, '', p.exe).toLowerCase().includes(kw)) { continue; }
		matched.add(p.pid);
		visible.add(p.pid);
		for (const a of ancestorsOf(p.pid, byPid)) { visible.add(a); }
	}
	return { visible, matched };
}

/** 表示対象を DFS で訪問し、pid とツリーの罫線（branch）を訪問順に並べる */
function visitOrder(
	children: Map<number, number[]>,
	roots: number[],
	visible: Set<number>
): { pid: number; branch: string }[] {
	const order: { pid: number; branch: string }[] = [];
	function visit(pid: number, prefix: string, branch: string): void {
		order.push({ pid, branch });
		const kids = (children.get(pid) ?? []).filter((c) => visible.has(c));
		kids.forEach((c, i) => {
			const isLast = i === kids.length - 1;
			const childBranch = isLast ? '└─ ' : '├─ ';
			const childPrefix = prefix + (isLast ? '  ' : '│ ');
			visit(c, childPrefix, prefix + childBranch);
		});
	}
	for (const r of roots) {
		if (visible.has(r)) { visit(r, '', ''); }
	}
	return order;
}

/**
 * exe 欄のラベルを pid ごとに決める。
 * fullPath なら常にフルパス。そうでなければファイル名のみにし、
 * 同じファイル名で違うフルパスが複数あれば、表示に出てくる順（visited の順）に
 * *1 ・*2 … を振る（絞り込みで消えた分の番号は詰まる）。
 * 戻り値の legend は、番号を振ったファイル名ごとの対応表（1行ずつ）
 */
function buildExeLabels(
	byPid: Map<number, ProcessInfo>,
	visited: { pid: number }[],
	fullPath: boolean
): { labels: Map<number, string>; legend: string[] } {
	const labels = new Map<number, string>();
	if (fullPath) {
		for (const v of visited) {
			const p = byPid.get(v.pid);
			if (p != null) { labels.set(v.pid, p.exe); }
		}
		return { labels, legend: [] };
	}

	// ファイル名ごとに、そのファイル名を持つ pid が出てくる順で並べる
	const byBasename = new Map<string, number[]>();
	for (const v of visited) {
		const p = byPid.get(v.pid);
		if (p == null) { continue; }
		const name = basename(p.exe);
		const pids = byBasename.get(name);
		if (pids) { pids.push(v.pid); } else { byBasename.set(name, [v.pid]); }
	}

	const legend: string[] = [];
	for (const [name, pids] of byBasename) {
		// このファイル名の中で、違うフルパスが出てくる順に番号を振る
		const pathToNo = new Map<string, number>();
		for (const pid of pids) {
			const exe = byPid.get(pid)?.exe ?? name;
			if (!pathToNo.has(exe)) { pathToNo.set(exe, pathToNo.size + 1); }
		}
		const multiple = pathToNo.size >= 2;
		for (const pid of pids) {
			const exe = byPid.get(pid)?.exe ?? name;
			labels.set(pid, multiple ? name + ' *' + pathToNo.get(exe) : name);
		}
		if (multiple) {
			// exe 名は先頭の name で分かっているので、*N 側はディレクトリだけにする
			const entries = [...pathToNo.entries()].map(([exe, no]) => '*' + no + ': ' + dirname(exe));
			legend.push(name + ': ' + entries.join(', '));
		}
	}
	return { labels, legend };
}

/** line の中でキーワードに一致した部分だけを明るい太字の緑にする */
function highlightKeyword(line: string, keyword: string): string {
	const lower = line.toLowerCase();
	const kw = keyword.toLowerCase();
	let result = '';
	let i = 0;
	let hit = false;
	while (i < line.length) {
		const found = lower.indexOf(kw, i);
		if (found < 0) { result += line.slice(i); break; }
		hit = true;
		result += line.slice(i, found) + '\x1b[1;32m' + line.slice(found, found + kw.length) + '\x1b[39m';
		i = found + kw.length;
	}
	return hit ? result : line;
}

/**
 * 訪問順・ラベルから、桁を揃えて切り詰めた表示行の配列を作る。
 * columns は端末幅（切り詰めに使う）。noTrim を渡すと切り詰めない
 */
function renderLines(
	byPid: Map<number, ProcessInfo>,
	visited: { pid: number; branch: string }[],
	exeLabels: Map<number, string>,
	matched: Set<number>,
	keyword: string | null,
	now: number,
	columns: number,
	noTrim: boolean
): string[] {
	const rows = visited.map((v) => {
		const p = byPid.get(v.pid);
		if (p == null) { return null; }
		const timeStr = p.creation ? formatJst(p.creation) : '-';
		const elapsedStr = p.creation ? '(' + formatElapsed(now - p.creation.getTime()) + ')' : '(-)';
		const memStr = formatMem(p.mem);
		const exeLabel = exeLabels.get(v.pid) ?? p.exe;
		const cmd = p.cmdline ?? '(-)';
		return { pid: v.pid, pidStr: String(p.pid), timeStr, elapsedStr, memStr, exeLabel, branch: v.branch, cmd };
	}).filter((r): r is NonNullable<typeof r> => r != null);

	const pidWidth = Math.max(0, ...rows.map((r) => displayWidth(r.pidStr)));
	const timeWidth = Math.max(0, ...rows.map((r) => displayWidth(r.timeStr)));
	const elapsedWidth = Math.max(0, ...rows.map((r) => displayWidth(r.elapsedStr)));
	const memWidth = Math.max(0, ...rows.map((r) => displayWidth(r.memStr)));
	const exeWidth = Math.max(0, ...rows.map((r) => displayWidth(r.exeLabel)));

	return rows.map((r) => {
		const prefix = padStartWidth(r.pidStr, pidWidth) + '  '
			+ padEndWidth(r.timeStr, timeWidth) + ' '
			+ padEndWidth(r.elapsedStr, elapsedWidth) + '  '
			+ padStartWidth(r.memStr, memWidth) + '  '
			+ padEndWidth(r.exeLabel, exeWidth) + '  '
			+ r.branch;
		const cmd = noTrim ? r.cmd : truncateToWidth(r.cmd, Math.max(0, columns - displayWidth(prefix)));
		const line = prefix + cmd;
		if (!matched.has(r.pid)) { return line; }
		const body = keyword != null ? highlightKeyword(line, keyword) : line;
		return '\x1b[1m' + body + '\x1b[0m';
	});
}

async function main(argv: string[]): Promise<number> {
	const parsed = parseArgs(argv, [
		{ name: 'keyword', kind: 'string', positional: true },
		{ name: 'full-path', kind: 'boolean', short: 'f' },
		{ name: 'no-trim', kind: 'boolean' },
	], {});
	if (parsed.help) { out(Usage); return ExitOk; }
	if (parsed.error != null) { return fail(parsed.error); }

	if (typeof Bun === 'undefined') {
		process.stderr.write('psls は Bun が必要です（bun:ffi でプロセス情報を取得するため）。\n');
		return ExitNeedBun;
	}

	// Windows コンソールの VT100 エスケープ解釈（太字・色付け用）を明示的に
	// 有効化する（Bun では既定で無効なことを実機で確認済み）。
	// 出力し終わったら元へ戻す
	const restoreConsole = await enableWindowsConsoleVt();

	const { k32, ntdll, ptr } = await loadWin32();
	const ptrOf = (b: Uint8Array) => Number(ptr(b));

	const snapshot = snapshotProcesses(k32, ptrOf);
	const list: ProcessInfo[] = snapshot.map(({ pid, ppid, name }) => {
		const detail = queryProcessDetail(pid, k32, ntdll, ptrOf);
		return { pid, ppid, name, exe: detail.exe ?? name, creation: detail.creation, cmdline: detail.cmdline, mem: detail.mem };
	});

	const { byPid, children, roots } = buildTree(list);
	const keyword = typeof parsed.values.keyword === 'string' ? parsed.values.keyword : null;
	const fullPath = parsed.values['full-path'] === true;
	const noTrim = parsed.values['no-trim'] === true;
	const now = Date.now();
	const { visible, matched } = computeVisible(list, byPid, keyword, now);
	const visited = visitOrder(children, roots, visible);
	const { labels, legend } = buildExeLabels(byPid, visited, fullPath);
	const columns = process.stdout.columns ?? 160;
	const lines = renderLines(byPid, visited, labels, matched, keyword, now, columns, noTrim);
	out(lines.join('\n') + (lines.length > 0 ? '\n' : ''));
	if (legend.length > 0) { out(legend.join('\n') + '\n'); }
	restoreConsole();
	return ExitOk;
}

main(process.argv.slice(2)).then((code) => { process.exit(code); });
