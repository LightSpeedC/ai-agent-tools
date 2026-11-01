/*
	spawn-server のテスト。

	サーバーを子プロセスで立て、HTTP で依頼を投げる。起動させるのは、
	ファイルを 1 つ書いて終わる短いコマンドにする。窓は一瞬開いて閉じる。
	立てたサーバーと起動したものは、最後に必ず止める（残ると窓とメモリを食う）。
*/
import { spawn, spawnSync, execFileSync, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..', '..');
const tool = path.join(root, 'src', 'spawn-server-ts', 'spawn-server-main.ts');
const work = path.join(root, 'tmp', 'spawn-server-tests');
// ほかのテスト ・ 本番の待受けと重ならないよう、使っていなさそうな番号にする
const port = 18790 + (process.pid % 100);
const base = 'http://127.0.0.1:' + port;

let pass = 0;
let fail = 0;
function ok(name: string): void { pass++; console.log('  [OK] ' + name); }
function ng(name: string, detail: string): void { fail++; console.log('  [NG] ' + name + '  ' + detail); }
function assertEqual(name: string, expected: unknown, actual: unknown): void {
	if (expected === actual) { ok(name); } else { ng(name, '期待 ' + JSON.stringify(expected) + ' / 実際 ' + JSON.stringify(actual)); }
}
function assertTrue(name: string, value: boolean, detail: string): void { if (value) { ok(name); } else { ng(name, detail); } }

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function alive(pid: number): boolean {
	try { process.kill(pid, 0); return true; } catch { return false; }
}

function kill(pid: number, tree = true): void {
	try { execFileSync('taskkill', ['/PID', String(pid), ...(tree ? ['/T'] : []), '/F'], { stdio: 'ignore', timeout: 10000 }); } catch { /* 既に無い */ }
}

// SPAWN_SERVER_TEST_NO_FFI=1 なら、FFI を使わず Start-Process で起動する道を試す（サーバーに引き継がれる）
const noFfi = process.env.SPAWN_SERVER_TEST_NO_FFI === '1';
// サーバーの窓に出るログ。どの手段で起動したかを見る
let serverLog = '';

async function waitFor(cond: () => boolean, ms: number): Promise<boolean> {
	const end = Date.now() + ms;
	while (Date.now() < end) { if (cond()) { return true; } await sleep(100); }
	return cond();
}

/*
	見えている最上位の窓の持ち主 (pid) ・ 前面の窓の持ち主 ・ rootPid の子孫 (rootPid を含む) を、PowerShell で調べる。
	コンソールの窓の持ち主は、窓の本体 (conhost) ではなく、そのコンソールに付いたプロセス (cmd 等) として返る (実測)
*/
function inspectWindows(rootPid: number): { foreground: number; visible: number[]; tree: number[] } {
	const script = [
		"Add-Type -TypeDefinition @'",
		'using System; using System.Collections.Generic; using System.Runtime.InteropServices;',
		'public static class W {',
		'	delegate bool P(IntPtr h, IntPtr l);',
		'	[DllImport("user32.dll")] static extern bool EnumWindows(P p, IntPtr l);',
		'	[DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);',
		'	[DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);',
		'	[DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();',
		'	public static uint[] Visible() { var l = new List<uint>(); EnumWindows((h, x) => { if (IsWindowVisible(h)) { uint p; GetWindowThreadProcessId(h, out p); l.Add(p); } return true; }, IntPtr.Zero); return l.ToArray(); }',
		'	public static uint Foreground() { uint p; GetWindowThreadProcessId(GetForegroundWindow(), out p); return p; }',
		'}',
		"'@",
		'$all = Get-CimInstance Win32_Process',
		'$ids = @(' + rootPid + ')',
		'for ($i = 0; $i -lt $ids.Count; $i++) { foreach ($c in @($all | Where-Object { $_.ParentProcessId -eq $ids[$i] })) { $ids += $c.ProcessId } }',
		'@{ foreground = [int][W]::Foreground(); visible = @([W]::Visible() | ForEach-Object { [int]$_ }); tree = @($ids) } | ConvertTo-Json -Compress',
	].join('\n');
	const encoded = Buffer.from(script, 'utf16le').toString('base64');
	const out = execFileSync('powershell', ['-NoProfile', '-NonInteractive', '-EncodedCommand', encoded], { encoding: 'utf8', timeout: 30000 }).trim();
	return JSON.parse(out);
}

// サーバーは SPAWN_SERVER_TEST_HIDE=1 で立てる: 起動する窓を非表示にする (試験が、作業中の画面と
// フォーカスを奪わないため。共通ルール「窓が要る試験は、非表示で裏に回す」)。窓そのもの (conhost) は作られる
function startServer(): Promise<ChildProcess> {
	return new Promise((resolve, reject) => {
		const p = spawn(process.argv[0], [tool, '--port', String(port)], { stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, SPAWN_SERVER_TEST_MARK: 'mark-' + port, SPAWN_SERVER_TEST_HIDE: '1' } });
		let out = '';
		const timer = setTimeout(() => reject(new Error('サーバーが立ちません: ' + out)), 15000);
		p.stdout!.on('data', (d) => { out += d; serverLog += d; if (out.includes('待ち受け')) { clearTimeout(timer); resolve(p); } });
		p.stderr!.on('data', (d) => { out += d; });
		p.on('exit', () => { clearTimeout(timer); reject(new Error('サーバーが終わりました: ' + out)); });
	});
}

async function post(body: unknown, headers: Record<string, string> = {}): Promise<{ status: number; json: any }> {
	const r = await fetch(base + '/run', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json', ...headers },
		body: typeof body === 'string' ? body : JSON.stringify(body),
	});
	return { status: r.status, json: await r.json() };
}

/*
	Host ・ Origin を自分で決めて投げる。fetch はこれらのヘッダーを自分で決めてしまうことがあるため、
	node:http で直に組む
*/
function raw(method: string, urlPath: string, headers: Record<string, string>, body = ''): Promise<{ status: number; text: string }> {
	return new Promise((resolve, reject) => {
		const req = http.request({ host: '127.0.0.1', port, method, path: urlPath, headers, setHost: false }, (res) => {
			let text = '';
			res.setEncoding('utf8');
			res.on('data', (d) => { text += d; });
			res.on('end', () => resolve({ status: res.statusCode ?? 0, text }));
		});
		req.on('error', reject);
		req.end(body);
	});
}

console.log('');
console.log('=== spawn-server のテスト（' + path.basename(process.argv[0]) + ' ・ ' + (noFfi ? 'Start-Process' : 'FFI') + '）===');

fs.rmSync(work, { recursive: true, force: true });
fs.mkdirSync(work, { recursive: true });

const spawned: number[] = [];
// 8 で起動する待ちの目印 (コマンド行に入れる。後始末で、木の外に残ったものを見つけて止める)
const sleeperMark = 'spawn-server-test-sleeper-' + process.pid;
let server: ChildProcess | null = null;
try {
	// 1. ポートが無ければ使い方を出して 2
	{
		const r = spawn(process.argv[0], [tool], { stdio: 'ignore' });
		const code = await new Promise((res) => r.on('exit', res));
		assertEqual('1 --port が無ければ 2', 2, code);
	}

	server = await startServer();

	// 2. 127.0.0.1 でだけ待ち受ける。ほかのアドレスから届かないこと
	{
		const other = Object.values(os.networkInterfaces()).flat().find((a) => a != null && a.family === 'IPv4' && !a.internal);
		if (other == null) { console.log('  [--] 2 ほかの IPv4 アドレスが無いので確かめない'); }
		else {
			let reached = true;
			try { await fetch('http://' + other.address + ':' + port + '/run', { method: 'POST', signal: AbortSignal.timeout(3000) }); } catch { reached = false; }
			assertTrue('2 127.0.0.1 以外では待ち受けない', !reached, '届いた');
		}
	}

	// 3. ほかのページからの依頼は断る。自分の入力ページ（同じ Origin）からは通す
	{
		const self = '127.0.0.1:' + port;
		const json = { 'Content-Type': 'application/json' };
		const r1 = await raw('POST', '/run', { ...json, Host: self, Origin: 'http://example.com' }, JSON.stringify({ command: 'cmd /c exit' }));
		assertEqual('3 ほかの Origin は 403', 403, r1.status);
		// Origin は開いたときの Host と揃っていなければならない（127.0.0.1 で開いて localhost を名乗るのは食い違い）
		const r2 = await raw('POST', '/run', { ...json, Host: self, Origin: 'http://localhost:' + port }, JSON.stringify({ command: 'cmd /c exit' }));
		assertEqual('3 Host と食い違う Origin は 403', 403, r2.status);
		// localhost で開いたページからは通す
		const lmark = path.join(work, 'localhost.txt');
		const rl = await raw('POST', '/run', { ...json, Host: 'localhost:' + port, Origin: 'http://localhost:' + port }, JSON.stringify({ command: 'cmd /c "echo ok> localhost.txt"', cwd: work }));
		assertEqual('3 localhost で開いたページからも起動できる', 200, rl.status);
		assertTrue('3 localhost から起動したものが動く', await waitFor(() => fs.existsSync(lmark), 10000), lmark + ' ができない');
		assertEqual('3 localhost で GET / が開ける', 200, (await raw('GET', '/', { Host: 'localhost:' + port })).status);
		// DNS リバインディング: よそのドメインを 127.0.0.1 に向けると、Host がそのドメインになる
		const r3 = await raw('GET', '/', { Host: 'evil.example:' + port });
		assertEqual('3 Host が違えば 403', 403, r3.status);
		const r4 = await raw('POST', '/run', { ...json, Host: 'evil.example:' + port, Origin: 'http://evil.example:' + port }, JSON.stringify({ command: 'cmd /c exit' }));
		assertEqual('3 Host と Origin がそろってよそなら 403', 403, r4.status);

		const mark = path.join(work, 'page.txt');
		const r5 = await raw('POST', '/run', { ...json, Host: self, Origin: 'http://' + self }, JSON.stringify({ command: 'cmd /c "echo ok> page.txt"', cwd: work }));
		assertEqual('3 自分の Origin からは起動できる', 200, r5.status);
		assertTrue('3 自分の Origin から起動したものが動く', await waitFor(() => fs.existsSync(mark), 10000), mark + ' ができない');
	}

	// 4. GET / で入力ページを返す
	{
		const r = await raw('GET', '/', { Host: '127.0.0.1:' + port });
		assertEqual('4 GET / は 200', 200, r.status);
		assertTrue('4 入力ページを返す', r.text.includes('<input id="command"') && r.text.includes("fetch('/run'"), r.text.slice(0, 200));
		// サーバーはテストのカレントフォルダで立てている
		assertTrue('4 カレントフォルダの既定値とプレースホルダがサーバーのもの', r.text.includes('value="' + process.cwd() + '" placeholder="' + process.cwd() + '"'), r.text.slice(r.text.indexOf('id="cwd"'), r.text.indexOf('id="cwd"') + 200));
		assertEqual('4 ほかの GET は 404', 404, (await raw('GET', '/x', { Host: '127.0.0.1:' + port })).status);
	}

	// 5. 形の違う依頼は 400
	assertEqual('5 command が無ければ 400', 400, (await post({})).status);
	assertEqual('5 JSON でなければ 400', 400, (await post('abc')).status);
	assertEqual('5 cwd がフォルダでなければ 400', 400, (await post({ command: 'cmd /c exit', cwd: path.join(work, 'nothing') })).status);
	{
		const r = await fetch(base + '/run', { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: '{}' });
		assertEqual('5 Content-Type が JSON でなければ 400', 400, r.status);
	}

	// 6. 起動して pid を返す。指定したカレントで動き、書いたファイルが残る
	{
		const mark = path.join(work, 'done.txt');
		const r = await post({ command: 'cmd /c "echo 日本語 > done.txt"', cwd: work, title: 'spawn-server テスト' });
		assertEqual('6 起動できれば 200', 200, r.status);
		assertTrue('6 pid を返す', Number.isInteger(r.json.pid), JSON.stringify(r.json));
		// 黙って代わりの道に落ちていないこと（FFI の周では bun:ffi か koffi で起動している）
		const expected = noFfi ? '(Start-Process)' : process.versions.bun != null ? '(bun:ffi)' : '(koffi)';
		assertTrue('6 起動の手段が ' + expected, serverLog.includes(expected), serverLog.split('\n').filter((l) => l.includes('起動')).join(' | '));
		assertTrue('6 指定したカレントフォルダで動く', await waitFor(() => fs.existsSync(mark), 10000), mark + ' ができない');
		await sleep(300);
		// cmd の echo は窓のコードページ（既定は 932）で書く。日本語が崩れずに渡ったかを見る
		const text = new TextDecoder('shift_jis').decode(fs.readFileSync(mark));
		assertTrue('6 コマンドの日本語がそのまま渡る', text.includes('日本語'), JSON.stringify(text));
	}

	// 7. 環境変数はサーバーのものを引き継ぐ（サーバーを立てるときに足した値が見える）
	{
		const mark = path.join(work, 'env.txt');
		const r = await post({ command: 'cmd /c "echo %SPAWN_SERVER_TEST_MARK%> env.txt"', cwd: work });
		assertEqual('7 起動できれば 200', 200, r.status);
		await waitFor(() => fs.existsSync(mark), 10000);
		await sleep(300);
		const text = fs.existsSync(mark) ? fs.readFileSync(mark, 'utf8').trim() : '';
		assertEqual('7 サーバーの環境変数を引き継ぐ', 'mark-' + port, text);

		// サーバーが起動のために足した値を持ち込まない（以前は SPAWN_COMMAND 等で渡していて漏れた）。
		// cmd は無い変数を %…% のまま残す
		const leak = path.join(work, 'leak.txt');
		await post({ command: 'cmd /c "echo %SPAWN_SERVER_LINE%%SPAWN_SERVER_CWD%> leak.txt"', cwd: work });
		await waitFor(() => fs.existsSync(leak), 10000);
		await sleep(300);
		const leaked = fs.existsSync(leak) ? fs.readFileSync(leak, 'utf8').trim() : '';
		assertEqual('7 作業用の環境変数を持ち込まない', '%SPAWN_SERVER_LINE%%SPAWN_SERVER_CWD%', leaked);
	}

	// 8. サーバーを止めても、起動したものは残る
	{
		const r = await post({ command: 'powershell -NoProfile -Command "Start-Sleep 30; # ' + sleeperMark + '"', cwd: work });
		const pid = r.json.pid as number;
		spawned.push(pid);
		assertTrue('8 起動したものが生きている', alive(pid), 'pid=' + pid);
		// 新しい窓が開いていれば、pid の下のどこかに conhost がいる。
		// detached だけで起動すると窓が作られず conhost もできない（実測）ので、それを見分ける
		await sleep(1000);
		const tree = execFileSync('powershell', ['-NoProfile', '-Command',
			'$all = Get-CimInstance Win32_Process; $ids = @(' + pid + '); $names = @(); '
			+ 'for ($i = 0; $i -lt $ids.Count; $i++) { foreach ($c in @($all | Where-Object { $_.ParentProcessId -eq $ids[$i] })) { $ids += $c.ProcessId; $names += $c.Name } }; $names -join ","'],
			{ encoding: 'utf8', timeout: 20000 }).trim();
		assertTrue('8 新しい窓で開く（conhost がいる）', /conhost\.exe/i.test(tree), tree);
		// SPAWN_SERVER_TEST_HIDE=1 のとき、窓は作られても、見えず、前面を奪わない
		// (指定が無ければ、新しい窓が見えて、前面を奪う。実測 2026-11-01)
		const seen = inspectWindows(pid);
		const visibleOwned = seen.visible.filter((p) => seen.tree.includes(p));
		assertEqual('8 起動した窓は見えない (非表示の指定が効く)', 0, visibleOwned.length);
		assertTrue('8 起動した窓が前面を奪わない', !seen.tree.includes(seen.foreground), '前面の窓の持ち主 pid=' + seen.foreground + ' が、起動した子孫の中にいる');
		// サーバーだけを止める（/T を付けない。Ctrl+C に近い）。/T を付けると、
		// CreateProcessW で起動したものはサーバーの子なので道連れになる（計画 p260930-01 第 4 章）
		kill(server.pid!, false);
		await waitFor(() => !alive(server!.pid!), 5000);
		server = null;
		await sleep(500);
		assertTrue('8 サーバーを止めても残る', alive(pid), 'pid=' + pid + ' が消えた');
	}
} catch (e) {
	ng('途中で止まった', e instanceof Error ? e.message : String(e));
} finally {
	if (server?.pid != null) { kill(server.pid); }
	for (const pid of spawned) { kill(pid); }
	// 8 で起動した待ち (Start-Sleep 30) は、返った pid の木の外に残ることがある (Start-Process の周)。
	// 作業フォルダをカレントにして 30 秒生きるので、目印でさがして止める。止めないと、後始末が EBUSY になる
	try {
		execFileSync('powershell', ['-NoProfile', '-Command',
			'Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like "*' + sleeperMark + '*" -and $_.ProcessId -ne $PID } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }'],
			{ stdio: 'ignore', timeout: 20000 });
	} catch { /* 無ければよい */ }
	// 止めた直後は、起動した窓の持ち主がフォルダを離しきっておらず EPERM になることがある。
	// 後始末の失敗で、集計の表示と終了コードが失われないよう、待ち直し、それでも消せなければ失敗として報告する
	try {
		fs.rmSync(work, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 });
	} catch (e) {
		ng('後始末 (作業フォルダを消せない)', e instanceof Error ? e.message : String(e));
	}
}

console.log('');
console.log(fail === 0 ? '=== ' + pass + ' 件すべて成功 ===' : '=== ' + fail + ' 件失敗（成功 ' + pass + ' 件）===');

// FFI が使えないときの道（Start-Process）も、同じテストで通す。2 周目は自分を起動し直して回す
let code = fail === 0 ? 0 : 1;
if (!noFfi) {
	const r = spawnSync(process.argv[0], [fileURLToPath(import.meta.url)], { stdio: 'inherit', env: { ...process.env, SPAWN_SERVER_TEST_NO_FFI: '1' } });
	if (r.status !== 0) { code = 1; }
}
process.exit(code);
