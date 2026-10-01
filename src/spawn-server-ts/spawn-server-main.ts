/*
	spawn-server — HTTP で受けたコマンドを、新しい窓で独立したプロセスとして起動する。

	    spawn-server --port 8790

	    GET  /     コマンドを入れて Enter で起動する入力ページ
	    POST /run  {"command": "…", "cwd": "…", "title": "…"}
	      200 {"pid": 1234}  起動したものの pid
	      400 形が違う ・ 403 Host が違う ・ ほかのページからの依頼 ・ 500 起動できない

	起動は CreateProcessW で、新しい窓の cmd /c にコマンドを渡す（create-process.ts）。
	窓はコマンドが終われば閉じる。
	サーバーは終わりを待たず、出力も受け取らない。サーバーだけを止めても起動したものは残る
	（taskkill /T で止めると、サーバーの子として道連れになる）。

	呼ぶのは同じ PC からだけ。127.0.0.1 でだけ待ち受け、Host は 127.0.0.1:<port> か localhost:<port> に限る。
	ブラウザからの依頼は、自分の入力ページ（Origin が http://<Host>）からのものだけを通す。
	トークンは持たないので、同じ PC のほかのプロセスからの依頼は防げない（計画 p260930-01 第 3 章）。
*/
import http from 'node:http';
import fs from 'node:fs';
import { launch, launchMethod } from './create-process.ts';

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
	GET / で返す入力ページ。コマンドを入れて Enter で POST /run に送り、結果を下に積む。
	外部ファイル ・ CDN は使わない。出力は textContent で入れる（受けた文字列を HTML として読ませない）。
*/
const PAGE = `<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>spawn-server</title>
<style>
	:root{ --navy1:#12224d; --navy2:#2f5fbf; --ink:#1c2330; --ink-soft:#4a5568; --line:#d9dfe8; --code-bg:#f4f6fa; }
	*{ box-sizing:border-box; }
	body{ margin:0; background:#fff; color:var(--ink,#1c2330); font-family:"Segoe UI","Yu Gothic UI",Meiryo,sans-serif; font-size:15.5px; line-height:1.85; }
	.titlebar{ background:linear-gradient(135deg,var(--navy1,#12224d),var(--navy2,#2f5fbf)); color:#fff; padding:22px 30px; }
	.titlebar h1{ margin:0; font-size:1.5em; }
	.titlebar p{ margin:4px 0 0; font-size:.9em; color:#dce6fb; background:transparent; }
	.wrap{ max-width:1600px; margin:0 auto; padding:20px 30px; }
	label{ display:block; margin:10px 0 4px; color:var(--ink-soft,#4a5568); background:transparent; font-size:.92em; }
	input{ width:100%; padding:8px 10px; font-size:1em; font-family:Consolas,"Courier New",monospace;
		background:#fff; color:var(--ink,#1c2330); border:1px solid var(--line,#d9dfe8); border-radius:6px; }
	input:focus{ outline:2px solid var(--navy2,#2f5fbf); }
	#log{ list-style:none; padding:0; margin:20px 0 0; }
	#log li{ padding:8px 12px; margin:6px 0; border-radius:6px; font-family:Consolas,"Courier New",monospace; font-size:.93em;
		background:var(--code-bg,#f4f6fa); color:var(--ink,#1c2330); border-left:5px solid #45b56c; word-break:break-all; }
	#log li.ng{ border-left-color:#e05a5c; background:#fdf2f2; color:#6b1416; }
</style>
</head>
<body>
<div class="titlebar"><h1>spawn-server</h1><p>コマンドを入れて Enter。新しい窓で起動する。</p></div>
<div class="wrap">
	<form id="f">
		<label for="command">コマンド</label>
		<input id="command" autocomplete="off" autofocus required>
		<label for="cwd">カレントフォルダ（空にするとサーバーのカレントフォルダ）</label>
		<input id="cwd" autocomplete="off" value="__CWD__" placeholder="__CWD__">
	</form>
	<ul id="log"></ul>
</div>
<script>
	const f = document.getElementById('f');
	const command = document.getElementById('command');
	const cwd = document.getElementById('cwd');
	const log = document.getElementById('log');
	function add(text, ok) {
		const li = document.createElement('li');
		li.textContent = text;
		if (!ok) { li.className = 'ng'; }
		log.prepend(li);
	}
	f.addEventListener('submit', async (e) => {
		e.preventDefault();
		const body = { command: command.value };
		if (cwd.value.trim() !== '') { body.cwd = cwd.value.trim(); }
		// 送ったらすぐ欄を空にする。続けて Enter を押しても同じものを二重に送らない。
		// 送った文字列は下の履歴に残る
		command.value = '';
		try {
			const r = await fetch('/run', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
			const j = await r.json();
			if (r.ok) { add('pid ' + j.pid + '  ' + body.command, true); }
			else { add(r.status + ' ' + j.error + '  ' + body.command, false); }
		} catch (err) {
			add('送れません: ' + err + '  ' + body.command, false);
		}
		command.focus();
	});
	// 送信ボタンを置かないと、欄が 2 つの form は Enter で送られない。どちらの欄でも Enter で送る
	for (const el of [command, cwd]) {
		el.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); f.requestSubmit(); } });
	}
</script>
</body>
</html>
`;

// 属性値に入れるので " も変える。& を先に変えないと二重に変換される
function escapeHtml(s: string): string {
	return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function reply(res: http.ServerResponse, status: number, body: object): void {
	res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
	res.end(JSON.stringify(body));
}

async function handle(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
	// よそのドメインを 127.0.0.1 に向けて（DNS リバインディング）自分のページに見せかけるのを防ぐ。
	// 通すのは 127.0.0.1 と localhost の 2 つだけ
	const host = req.headers.host ?? '';
	if (host !== HOST + ':' + port && host !== 'localhost:' + port) { reply(res, 403, { error: 'http://' + HOST + ':' + port + '/ か http://localhost:' + port + '/ で開いてください' }); return; }
	// ブラウザからの依頼は、自分の入力ページ（開いたときと同じ Origin）からのものだけを通す
	if (req.headers.origin != null && req.headers.origin !== 'http://' + host) { reply(res, 403, { error: 'ほかのページからの依頼は受けません' }); return; }
	if (req.method === 'GET' && req.url === '/') {
		res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
		// カレントフォルダの欄の既定値とプレースホルダに、サーバーのカレントフォルダを入れる
		res.end(PAGE.replaceAll('__CWD__', escapeHtml(process.cwd())));
		return;
	}
	if (req.method !== 'POST' || req.url !== '/run') { reply(res, 404, { error: 'GET / と POST /run だけを受けます' }); return; }
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
		log('起動 pid=' + pid + ' (' + launchMethod() + ') cwd=' + cwd + ' ' + data.command);
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
server.listen(port, HOST, () => { log('待ち受け http://' + HOST + ':' + port + '/（入力ページ） ・ /run'); });
