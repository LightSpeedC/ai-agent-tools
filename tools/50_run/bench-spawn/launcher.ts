/*
	spawn-server の起動部分だけを、案ごとに切り出したもの。サーバーの代わりに立てて比べる。
	    launcher.ts <A|B|C> <cwd> <command>
	起動したら「pid <番号> ms <時間>」を 1 行出し、そのまま生き続ける（サーバーの役。止めるのは呼び出し側）。
*/
import { spawn, execFile } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const [method, cwd, command] = process.argv.slice(2);
const title = 'bench-' + method;

function launchA(): Promise<number> {
	// PowerShell の Start-Process。渡すための環境変数は、起動する前に消す
	const script = '$c = $env:SPAWN_COMMAND; $t = $env:SPAWN_TITLE; $w = $env:SPAWN_CWD; '
		+ 'Remove-Item Env:SPAWN_COMMAND, Env:SPAWN_TITLE, Env:SPAWN_CWD; '
		+ '(Start-Process -FilePath cmd.exe -ArgumentList (\'/d /s /c "title \' + $t + \' & \' + $c + \'"\') -WorkingDirectory $w -PassThru).Id';
	return new Promise((resolve, reject) => {
		execFile('powershell', ['-NoProfile', '-NonInteractive', '-Command', script],
			{ encoding: 'utf8', windowsHide: true, env: { ...process.env, SPAWN_COMMAND: command, SPAWN_TITLE: title, SPAWN_CWD: cwd } },
			(err, out) => { if (err) { reject(err); } else { resolve(parseInt(out.trim(), 10)); } });
	});
}

function launchB(): Promise<number> {
	// node の中継を detached（窓なし）で立て、そこから cmd を起動する
	const p = spawn(process.execPath, [path.join(here, 'relay.ts'), cwd, title, command], { detached: true, stdio: 'ignore', windowsHide: false });
	p.unref();
	return new Promise((resolve, reject) => { p.once('spawn', () => resolve(p.pid!)); p.once('error', reject); });
}

function launchC(): Promise<number> {
	// 窓なしの cmd から start /wait。コマンドは遅延展開で窓の中の cmd に展開させ、3 段目の cmd に解釈させる
	const line = '"start "' + title + '" /wait cmd /d /v:on /s /c "cmd /d /s /c "!SPAWN_COMMAND!"""';
	const p = spawn('cmd.exe', ['/d', '/s', '/c', line], { cwd, detached: true, stdio: 'ignore', windowsVerbatimArguments: true, windowsHide: false, env: { ...process.env, SPAWN_COMMAND: command } });
	p.unref();
	return new Promise((resolve, reject) => { p.once('spawn', () => resolve(p.pid!)); p.once('error', reject); });
}

function launchD(): Promise<number> {
	// conhost.exe に cmd.exe を渡し、新しい窓を conhost に作らせる。BENCH_D で起動のしかたを変えて試す。
	// node ・ bun からは窓が開かない。node は標準入出力のハンドルを必ず渡すため、conhost は窓を作らず
	// そのハンドルへ VT シーケンスを流す側（疑似コンソール）で動き、stdio が ignore ならすぐ終わる（実測）
	const v = process.env.BENCH_D ?? 'detached';
	const p = spawn('conhost.exe', ['cmd.exe /d /s /c "title ' + title + ' & ' + command + '"'], {
		cwd, windowsVerbatimArguments: true, windowsHide: false,
		detached: v.includes('detached'), stdio: v.includes('inherit') ? 'inherit' : 'ignore',
	});
	p.unref();
	return new Promise((resolve, reject) => { p.once('spawn', () => resolve(p.pid!)); p.once('error', reject); });
}

/*
	koffi で CreateProcessW を直に呼ぶ。標準入出力のハンドルを渡さず（STARTF_USESTDHANDLES なし）、
	CREATE_NEW_CONSOLE で新しい窓を作らせる。環境変数は渡さず（NULL）、呼んだプロセスのものを引き継がせる。
*/
async function launchE(): Promise<number> {
	// bun は bun:ffi、node は koffi（共通ルール「bun と node で FFI を使うとき」）
	if (process.versions.bun != null) { return launchEBun(); }
	const koffi = (await import('koffi')).default;
	const kernel32 = koffi.load('kernel32.dll');
	const STARTUPINFOW = koffi.struct('STARTUPINFOW', {
		cb: 'uint32', lpReserved: 'void *', lpDesktop: 'void *', lpTitle: 'void *',
		dwX: 'uint32', dwY: 'uint32', dwXSize: 'uint32', dwYSize: 'uint32',
		dwXCountChars: 'uint32', dwYCountChars: 'uint32', dwFillAttribute: 'uint32', dwFlags: 'uint32',
		wShowWindow: 'uint16', cbReserved2: 'uint16', lpReserved2: 'void *',
		hStdInput: 'void *', hStdOutput: 'void *', hStdError: 'void *',
	});
	const PROCESS_INFORMATION = koffi.struct('PROCESS_INFORMATION', {
		hProcess: 'void *', hThread: 'void *', dwProcessId: 'uint32', dwThreadId: 'uint32',
	});
	const CreateProcessW = kernel32.func('int __stdcall CreateProcessW(const char16_t *app, char16_t *cmd, void *pa, void *ta, int inherit, uint32 flags, void *env, const char16_t *cwd, STARTUPINFOW *si, _Out_ PROCESS_INFORMATION *pi)');
	const CloseHandle = kernel32.func('int __stdcall CloseHandle(void *h)');
	const GetLastError = kernel32.func('uint32 __stdcall GetLastError()');

	const CREATE_NEW_CONSOLE = 0x10;
	const si = { cb: koffi.sizeof(STARTUPINFOW) };
	const pi: Record<string, unknown> = {};
	// CreateProcessW は lpCommandLine を書き換えることがあるので、書き込める領域で渡す
	const line = 'cmd.exe /d /s /c "title ' + title + ' & ' + command + '"';
	const buf = Buffer.from(line + '\0', 'utf16le');
	const ok = CreateProcessW(null, buf, null, null, 0, CREATE_NEW_CONSOLE, null, cwd, si, pi);
	if (!ok) { throw new Error('CreateProcessW が失敗しました: ' + GetLastError()); }
	CloseHandle(pi.hThread);
	CloseHandle(pi.hProcess);
	return pi.dwProcessId as number;
}

/*
	案 E の bun 版。bun:ffi には構造体の型が無いので、x64 の配置どおりにバイト列を組む。
	    STARTUPINFOW        104 バイト（cb は先頭 4 バイト。ほかは 0 のまま）
	    PROCESS_INFORMATION  24 バイト（hProcess 0 ・ hThread 8 ・ dwProcessId 16）
*/
async function launchEBun(): Promise<number> {
	// 直に 'bun:ffi' と書くと node の型定義に無いため tsc が止まる。組み立ててから読む
	const { dlopen, FFIType, ptr } = await import('bun' + ':ffi');
	const { symbols: k32 } = dlopen('kernel32.dll', {
		CreateProcessW: { args: [FFIType.ptr, FFIType.ptr, FFIType.ptr, FFIType.ptr, FFIType.i32, FFIType.u32, FFIType.ptr, FFIType.ptr, FFIType.ptr, FFIType.ptr], returns: FFIType.i32 },
		CloseHandle: { args: [FFIType.ptr], returns: FFIType.i32 },
		GetLastError: { args: [], returns: FFIType.u32 },
	});
	const si = new Uint8Array(104);
	new DataView(si.buffer).setUint32(0, 104, true);
	const pi = new Uint8Array(24);
	const line = Buffer.from('cmd.exe /d /s /c "title ' + title + ' & ' + command + '"\0', 'utf16le');
	const dir = Buffer.from(cwd + '\0', 'utf16le');
	const CREATE_NEW_CONSOLE = 0x10;
	const ok = k32.CreateProcessW(null, ptr(line), null, null, 0, CREATE_NEW_CONSOLE, null, ptr(dir), ptr(si), ptr(pi));
	if (!ok) { throw new Error('CreateProcessW が失敗しました: ' + k32.GetLastError()); }
	const v = new DataView(pi.buffer);
	k32.CloseHandle(Number(v.getBigUint64(8, true)));
	k32.CloseHandle(Number(v.getBigUint64(0, true)));
	return v.getUint32(16, true);
}

const t0 = performance.now();
const pid = await (method === 'A' ? launchA() : method === 'B' ? launchB() : method === 'C' ? launchC() : method === 'D' ? launchD() : launchE());
console.log('pid ' + pid + ' ms ' + Math.round(performance.now() - t0));
setInterval(() => {}, 1 << 30);
