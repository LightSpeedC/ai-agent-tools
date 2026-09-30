/*
	spawn-server — HTTP で受けたコマンドを、新しい窓で独立したプロセスとして起動する。

	    spawn-server --port 8790

	    POST /run  {"command": "…", "cwd": "…", "title": "…"}
	      200 {"pid": 1234}  起動したものの pid
	      400 形が違う ・ 403 Origin 付き ・ 500 起動できない

	起動は PowerShell の Start-Process で、新しい窓の cmd /c にコマンドを渡す。
	窓はコマンドが終われば閉じる。
	サーバーは終わりを待たず、出力も受け取らない。サーバーを止めても起動したものは残る。

	呼ぶのは同じ PC からだけ。127.0.0.1 でだけ待ち受け、ブラウザからの依頼（Origin 付き）は断る。
	トークンは持たないので、同じ PC のほかのプロセスからの依頼は防げない（計画 p260930-01 第 3 章）。
*/
import http from 'node:http';
import fs from 'node:fs';
import { execFile } from 'node:child_process';

const HOST = '127.0.0.1';
const MAX_BODY = 64 * 1024;

function usage(): never {
	console.error('使い方: spawn-server --port <番号>');
	process.exit(2);
}

// JST の yyyy/mm/dd hh:mm:ss.ccc（実行環境のタイムゾーンに関係なく）
function now(): string {
	const d = new Date(Date.now() + 9 * 3600 * 1000);
	const p = (n: number, w = 2) => String(n).padStart(w, '0');
	return d.getUTCFullYear() + '/' + p(d.getUTCMonth() + 1) + '/' + p(d.getUTCDate()) + ' '
		+ p(d.getUTCHours()) + ':' + p(d.getUTCMinutes()) + ':' + p(d.getUTCSeconds()) + '.' + p(d.getUTCMilliseconds(), 3);
}

function log(msg: string): void {
	console.log(now() + ' ' + msg);
}

/*
	新しい窓で cmd /c <command> を起動し、その cmd の pid を返す。

	Start-Process -PassThru は起動した時点で pid が決まる。cmd の start だと、
	start が終わってから子を探すことになり、すぐ終わるコマンドを取りこぼした。
	返すのは窓の中の cmd の pid で、taskkill /T で止めれば中身ごと止まる。

	コマンド ・ タイトル ・ カレントは環境変数で渡す。PowerShell の式に埋め込むと
	クォートの入れ子を組むことになり、中身しだいで壊れる。
*/
function launch(command: string, cwd: string, title: string): Promise<number> {
	const script = '$ErrorActionPreference = "Stop"; '
		+ '$a = \'/d /s /c "title \' + $env:SPAWN_TITLE + \' & \' + $env:SPAWN_COMMAND + \'"\'; '
		+ '(Start-Process -FilePath cmd.exe -ArgumentList $a -WorkingDirectory $env:SPAWN_CWD -PassThru).Id';
	return new Promise((resolve, reject) => {
		execFile('powershell', ['-NoProfile', '-NonInteractive', '-Command', script],
			{ encoding: 'utf8', timeout: 15000, windowsHide: true, env: { ...process.env, SPAWN_COMMAND: command, SPAWN_TITLE: title, SPAWN_CWD: cwd } },
			(err, out, errOut) => {
				if (err) { reject(new Error('起動できません: ' + (errOut.trim() || err.message))); return; }
				const pid = parseInt(out.trim(), 10);
				if (!Number.isInteger(pid)) { reject(new Error('pid が取れません: ' + out.trim())); return; }
				resolve(pid);
			});
	});
}

function reply(res: http.ServerResponse, status: number, body: object): void {
	res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
	res.end(JSON.stringify(body));
}

async function handle(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
	// ブラウザからの依頼を断る。悪意あるページが localhost へ投げるのを防ぐ
	if (req.headers.origin != null) { reply(res, 403, { error: 'ブラウザからの依頼は受けません' }); return; }
	if (req.method !== 'POST' || req.url !== '/run') { reply(res, 404, { error: 'POST /run だけを受けます' }); return; }
	if (!/^application\/json\b/i.test(req.headers['content-type'] ?? '')) { reply(res, 400, { error: 'Content-Type は application/json にしてください' }); return; }

	let body = '';
	for await (const chunk of req) {
		body += chunk;
		if (body.length > MAX_BODY) { reply(res, 400, { error: '本文が大きすぎます' }); return; }
	}
	let data: { command?: unknown; cwd?: unknown; title?: unknown };
	try { data = JSON.parse(body); } catch { reply(res, 400, { error: '本文が JSON ではありません' }); return; }
	if (typeof data !== 'object' || data == null || typeof data.command !== 'string' || data.command.trim() === '') {
		reply(res, 400, { error: 'command（文字列）が要ります' }); return;
	}
	const cwd = data.cwd == null ? process.cwd() : data.cwd;
	if (typeof cwd !== 'string' || !fs.existsSync(cwd) || !fs.statSync(cwd).isDirectory()) { reply(res, 400, { error: 'cwd がフォルダではありません' }); return; }
	// 窓のタイトルは cmd の title に渡すので、cmd が区切りと読む記号を外す
	const title = (typeof data.title === 'string' && data.title !== '' ? data.title : data.command).replace(/["&|<>^%]/g, '');

	try {
		const pid = await launch(data.command, cwd, title);
		log('起動 pid=' + pid + ' cwd=' + cwd + ' ' + data.command);
		reply(res, 200, { pid });
	} catch (e) {
		const msg = e instanceof Error ? e.message : String(e);
		log('失敗 ' + msg + ' ' + data.command);
		reply(res, 500, { error: msg });
	}
}

const args = process.argv.slice(2);
const at = args.indexOf('--port');
const port = at >= 0 ? parseInt(args[at + 1] ?? '', 10) : NaN;
if (!Number.isInteger(port) || port < 1 || port > 65535) { usage(); }

process.title = 'spawn-server:' + port;
const server = http.createServer((req, res) => { handle(req, res).catch((e) => reply(res, 500, { error: String(e) })); });
server.on('error', (e) => { console.error('待ち受けできません: ' + e.message); process.exit(1); });
server.listen(port, HOST, () => { log('待ち受け http://' + HOST + ':' + port + '/run'); });
