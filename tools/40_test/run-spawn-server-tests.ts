/*
	spawn-server のテスト。

	サーバーを子プロセスで立て、HTTP で依頼を投げる。起動させるのは、
	ファイルを 1 つ書いて終わる短いコマンドにする。窓は一瞬開いて閉じる。
	立てたサーバーと起動したものは、最後に必ず止める（残ると窓とメモリを食う）。
*/
import { spawn, execFileSync, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
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

function kill(pid: number): void {
	try { execFileSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore', timeout: 10000 }); } catch { /* 既に無い */ }
}

async function waitFor(cond: () => boolean, ms: number): Promise<boolean> {
	const end = Date.now() + ms;
	while (Date.now() < end) { if (cond()) { return true; } await sleep(100); }
	return cond();
}

function startServer(): Promise<ChildProcess> {
	return new Promise((resolve, reject) => {
		const p = spawn(process.argv[0], [tool, '--port', String(port)], { stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, SPAWN_TEST_MARK: 'mark-' + port } });
		let out = '';
		const timer = setTimeout(() => reject(new Error('サーバーが立ちません: ' + out)), 15000);
		p.stdout!.on('data', (d) => { out += d; if (out.includes('待ち受け')) { clearTimeout(timer); resolve(p); } });
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

console.log('');
console.log('=== spawn-server のテスト（' + path.basename(process.argv[0]) + '）===');

fs.rmSync(work, { recursive: true, force: true });
fs.mkdirSync(work, { recursive: true });

const spawned: number[] = [];
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

	// 3. ブラウザからの依頼（Origin 付き）は断る
	{
		const r = await post({ command: 'cmd /c exit' }, { Origin: 'http://example.com' });
		assertEqual('3 Origin 付きは 403', 403, r.status);
	}

	// 4. 形の違う依頼は 400
	assertEqual('4 command が無ければ 400', 400, (await post({})).status);
	assertEqual('4 JSON でなければ 400', 400, (await post('abc')).status);
	assertEqual('4 cwd がフォルダでなければ 400', 400, (await post({ command: 'cmd /c exit', cwd: path.join(work, 'nothing') })).status);
	{
		const r = await fetch(base + '/run', { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: '{}' });
		assertEqual('4 Content-Type が JSON でなければ 400', 400, r.status);
	}

	// 5. 起動して pid を返す。指定したカレントで動き、書いたファイルが残る
	{
		const mark = path.join(work, 'done.txt');
		const r = await post({ command: 'cmd /c "echo 日本語 > done.txt"', cwd: work, title: 'spawn-server テスト' });
		assertEqual('5 起動できれば 200', 200, r.status);
		assertTrue('5 pid を返す', Number.isInteger(r.json.pid), JSON.stringify(r.json));
		assertTrue('5 指定したカレントで動く', await waitFor(() => fs.existsSync(mark), 10000), mark + ' ができない');
		await sleep(300);
		// cmd の echo は窓のコードページ（既定は 932）で書く。日本語が崩れずに渡ったかを見る
		const text = new TextDecoder('shift_jis').decode(fs.readFileSync(mark));
		assertTrue('5 コマンドの日本語がそのまま渡る', text.includes('日本語'), JSON.stringify(text));
	}

	// 7. 環境変数はサーバーのものを引き継ぐ（サーバーを立てるときに足した値が見える）
	{
		const mark = path.join(work, 'env.txt');
		const r = await post({ command: 'cmd /c "echo %SPAWN_TEST_MARK%> env.txt"', cwd: work });
		assertEqual('7 起動できれば 200', 200, r.status);
		await waitFor(() => fs.existsSync(mark), 10000);
		await sleep(300);
		const text = fs.existsSync(mark) ? fs.readFileSync(mark, 'utf8').trim() : '';
		assertEqual('7 サーバーの環境変数を引き継ぐ', 'mark-' + port, text);
	}

	// 6. サーバーを止めても、起動したものは残る
	{
		const r = await post({ command: 'powershell -NoProfile -Command "Start-Sleep 30"', cwd: work });
		const pid = r.json.pid as number;
		spawned.push(pid);
		assertTrue('6 起動したものが生きている', alive(pid), 'pid=' + pid);
		kill(server.pid!);
		await waitFor(() => !alive(server!.pid!), 5000);
		server = null;
		await sleep(500);
		assertTrue('6 サーバーを止めても残る', alive(pid), 'pid=' + pid + ' が消えた');
	}
} catch (e) {
	ng('途中で止まった', e instanceof Error ? e.message : String(e));
} finally {
	if (server?.pid != null) { kill(server.pid); }
	for (const pid of spawned) { kill(pid); }
	fs.rmSync(work, { recursive: true, force: true });
}

console.log('');
console.log(fail === 0 ? '=== ' + pass + ' 件すべて成功 ===' : '=== ' + fail + ' 件失敗（成功 ' + pass + ' 件）===');
process.exit(fail === 0 ? 0 : 1);
