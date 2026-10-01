/*
	新しい窓で cmd /c <command> を起動し、窓の中の cmd の pid を返す。

	CreateProcessW を FFI で直に呼ぶ（bun は bun:ffi、node は koffi）。
	  ・標準入出力のハンドルを渡さない（STARTF_USESTDHANDLES なし）。node の spawn は必ず渡すため、
	    新しい窓を作っても出力がそちらへ流れず、conhost も窓を作らない
	  ・CREATE_NEW_CONSOLE で新しい窓を作る
	  ・環境変数は渡さず（NULL）、サーバーのものをそのまま引き継がせる
	サーバーの子として残るので、サーバーを taskkill /T で止めると道連れになる。
	サーバーだけを止めたとき（Ctrl+C ・ /T なしの taskkill）は残る。

	FFI が使えないとき（node で koffi が入っていない等）は PowerShell の Start-Process に落ちる。
	機能は同じで、起動に 0.6 秒ほどかかる。比べた結果は計画 p260930-01 第 4 章。
*/
import { execFile } from 'node:child_process';

const CREATE_NEW_CONSOLE = 0x10;

function commandLine(command: string, title: string): string {
	return 'cmd.exe /d /s /c "title ' + title + ' & ' + command + '"';
}

/*
	bun:ffi には構造体の型が無いので、x64 の配置どおりにバイト列を組む。
	    STARTUPINFOW        104 バイト（cb は先頭 4 バイト。ほかは 0 のまま）
	    PROCESS_INFORMATION  24 バイト（hProcess 0 ・ hThread 8 ・ dwProcessId 16）
*/
async function viaBunFfi(line: string, cwd: string): Promise<number> {
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
	// CreateProcessW は lpCommandLine を書き換えることがあるので、書き込める領域で渡す
	const cmd = Buffer.from(line + '\0', 'utf16le');
	const dir = Buffer.from(cwd + '\0', 'utf16le');
	if (!k32.CreateProcessW(null, ptr(cmd), null, null, 0, CREATE_NEW_CONSOLE, null, ptr(dir), ptr(si), ptr(pi))) {
		throw new Error('CreateProcessW が失敗しました（' + k32.GetLastError() + '）');
	}
	const v = new DataView(pi.buffer);
	k32.CloseHandle(Number(v.getBigUint64(8, true)));
	k32.CloseHandle(Number(v.getBigUint64(0, true)));
	return v.getUint32(16, true);
}

// koffi の関数は 1 度だけ作る（同じ名前の構造体を 2 度定義するとエラーになる）
let koffiApi: { create: (...a: unknown[]) => number; close: (h: unknown) => number; lastError: () => number; sizeofSi: number } | null = null;

async function viaKoffi(line: string, cwd: string): Promise<number> {
	if (koffiApi == null) {
		// koffi は任意の依存。入っていなければ import が失敗し、呼び出し元が Start-Process に落とす
		const koffi = (await import('koffi' as string)).default;
		const k32 = koffi.load('kernel32.dll');
		const si = koffi.struct('STARTUPINFOW', {
			cb: 'uint32', lpReserved: 'void *', lpDesktop: 'void *', lpTitle: 'void *',
			dwX: 'uint32', dwY: 'uint32', dwXSize: 'uint32', dwYSize: 'uint32',
			dwXCountChars: 'uint32', dwYCountChars: 'uint32', dwFillAttribute: 'uint32', dwFlags: 'uint32',
			wShowWindow: 'uint16', cbReserved2: 'uint16', lpReserved2: 'void *',
			hStdInput: 'void *', hStdOutput: 'void *', hStdError: 'void *',
		});
		koffi.struct('PROCESS_INFORMATION', { hProcess: 'void *', hThread: 'void *', dwProcessId: 'uint32', dwThreadId: 'uint32' });
		koffiApi = {
			create: k32.func('int __stdcall CreateProcessW(const char16_t *app, char16_t *cmd, void *pa, void *ta, int inherit, uint32 flags, void *env, const char16_t *cwd, STARTUPINFOW *si, _Out_ PROCESS_INFORMATION *pi)'),
			close: k32.func('int __stdcall CloseHandle(void *h)'),
			lastError: k32.func('uint32 __stdcall GetLastError()'),
			sizeofSi: koffi.sizeof(si),
		};
	}
	const api = koffiApi!;
	const pi: { hProcess?: unknown; hThread?: unknown; dwProcessId?: number } = {};
	const cmd = Buffer.from(line + '\0', 'utf16le');
	if (!api.create(null, cmd, null, null, 0, CREATE_NEW_CONSOLE, null, cwd, { cb: api.sizeofSi }, pi)) {
		throw new Error('CreateProcessW が失敗しました（' + api.lastError() + '）');
	}
	api.close(pi.hThread);
	api.close(pi.hProcess);
	return pi.dwProcessId!;
}

/*
	FFI が使えないときの代わり。コマンド ・ カレントフォルダは環境変数で渡し（式に埋め込むと
	クォートの入れ子で壊れる）、起動する前に消す（起動したものへ持ち込まない）。
*/
function viaStartProcess(line: string, cwd: string): Promise<number> {
	const script = '$c = $env:SPAWN_LINE; $w = $env:SPAWN_CWD; Remove-Item Env:SPAWN_LINE, Env:SPAWN_CWD; '
		+ '$a = $c.Substring($c.IndexOf(" ") + 1); '
		+ '(Start-Process -FilePath cmd.exe -ArgumentList $a -WorkingDirectory $w -PassThru).Id';
	return new Promise((resolve, reject) => {
		execFile('powershell', ['-NoProfile', '-NonInteractive', '-Command', script],
			{ encoding: 'utf8', timeout: 15000, windowsHide: true, env: { ...process.env, SPAWN_LINE: line, SPAWN_CWD: cwd } },
			(err, out, errOut) => {
				if (err) { reject(new Error('起動できません: ' + (errOut.trim() || err.message))); return; }
				const pid = parseInt(out.trim(), 10);
				if (!Number.isInteger(pid)) { reject(new Error('pid が取れません: ' + out.trim())); return; }
				resolve(pid);
			});
	});
}

// 起動に使う手段。FFI が読めなければ以後ずっと Start-Process。
// SPAWN_SERVER_NO_FFI=1 で最初から Start-Process にする（代わりの道をテストで通すため）
let useFallback = process.env.SPAWN_SERVER_NO_FFI === '1';

export function launchMethod(): string {
	return useFallback ? 'Start-Process' : process.versions.bun != null ? 'bun:ffi' : 'koffi';
}

export async function launch(command: string, cwd: string, title: string): Promise<number> {
	const line = commandLine(command, title);
	if (!useFallback) {
		try {
			return await (process.versions.bun != null ? viaBunFfi : viaKoffi)(line, cwd);
		} catch (e) {
			// CreateProcessW 自体の失敗（カレントフォルダが無い等）は FFI が使えている。そのまま返す
			if (e instanceof Error && e.message.startsWith('CreateProcessW')) { throw e; }
			useFallback = true;
		}
	}
	return viaStartProcess(line, cwd);
}
