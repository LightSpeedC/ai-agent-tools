/*
	check-markdown の試験。GitHub へは送らない (対象の .md が無い置き場で流す)。

	- 234-A: トークンを引数で受けない。--token ・ -Token を渡したら終了コード 2 で、環境変数か gh を使うよう案内する
	- トークンの読み先 (環境変数 GITHUB_TOKEN ・ GH_TOKEN ・ gh auth token) を出す。値は出さない

	期待値は、決めた仕様から先に手で書いた (実装の出力から作っていない)。
	process.execPath で src/check-markdown/main.ts を動かすので、bun でも node でも流せる。
*/
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..', '..');
const main = path.join(root, 'src', 'check-markdown', 'main.ts');
const work = path.join(root, 'tmp', 'check-markdown-tests');

let pass = 0;
let fail = 0;
function check(name: string, ok: boolean, detail: string = ''): void {
	if (ok) { pass++; console.log('  ✅ [OK] ' + name); }
	else { fail++; console.log('  ❌ [NG] ' + name + (detail ? '  ' + detail : '')); }
}

type Result = { code: number; out: string; err: string };
function cm(args: string[], env: Record<string, string | undefined> = {}): Result {
	const e: Record<string, string | undefined> = { ...process.env, ...env };
	const r = spawnSync(process.execPath, [main, ...args], { cwd: work, encoding: 'utf8', timeout: 60000, env: e as NodeJS.ProcessEnv });
	return { code: r.status ?? -1, out: (r.stdout ?? '').trim(), err: (r.stderr ?? '').trim() };
}

fs.rmSync(work, { recursive: true, force: true });
fs.mkdirSync(work, { recursive: true });
const Secret = 'ghp_ThisIsNotARealToken0000';

console.log('\n[トークンの受け方 (234-A)]');
{
	const r = cm([work, '--token', Secret]);
	check('--token を渡したら終了コード 2', r.code === 2, r.out + r.err);
	check('--token を渡したら、GITHUB_TOKEN か gh を使うよう案内する', (r.out + r.err).includes('GITHUB_TOKEN') && (r.out + r.err).includes('gh auth'), r.out + r.err);
	check('--token の値を出力に出さない', !(r.out + r.err).includes(Secret), r.out + r.err);
	const old = cm([work, '-Token', Secret]);
	check('古い -Token も終了コード 2', old.code === 2 && !(old.out + old.err).includes(Secret), old.out + old.err);
	const t = cm([work, '-t', Secret]);
	check('-t も終了コード 2', t.code === 2, t.out + t.err);
	const h = cm(['--help']);
	check('使い方に --token を載せない', h.code === 0 && !h.out.includes('--token'), h.out);
	check('使い方に、トークンの読み先を書く', h.out.includes('GITHUB_TOKEN'), h.out);
}
{
	const r = cm([work], { GITHUB_TOKEN: Secret, GH_TOKEN: undefined });
	check('GITHUB_TOKEN があれば、読み先として名前を出す', r.code === 0 && r.out.includes('GITHUB_TOKEN'), r.out + r.err);
	check('GITHUB_TOKEN の値は出さない', !(r.out + r.err).includes(Secret), r.out + r.err);
}

console.log('\n[.gitignore で外した md は送らない (242-A)]');
{
	// 外した md だけを置く。送る対象が 0 件になれば、GitHub へは何も送らない
	const g = path.join(work, 'g');
	fs.mkdirSync(path.join(g, 'logs'), { recursive: true });
	fs.writeFileSync(path.join(g, '.gitignore'), 'logs/\n_*\n');
	fs.writeFileSync(path.join(g, 'logs', 'run.md'), '# x\n');
	fs.writeFileSync(path.join(g, '_memo.md'), '# y\n');
	spawnSync('git', ['init', '-q', g], { encoding: 'utf8' });
	// 材料は tmp の下にあるので、既定の除外 (tmp 等) で落ちないよう、当たらない除外を渡す
	const r = cm([g, '-r', '-e', 'NEVER_MATCHES_ANY_PATH']);
	check('.gitignore で外した md は対象にしない (0 件なら送らずに終わる)', r.code === 0 && r.out.includes('対象の .md がありません') && !r.out.includes('除外 '), r.out + r.err);
	check('外した件数を出す', r.out.includes('.gitignore で外した 2 件'), r.out + r.err);
}

// 送り先の差し替え (i261111-03、決定 265-A)。本物の GitHub の API へ送らずに、送る経路を通す。
// 差し替え先はローカルだけ許し、トークンは付けない (環境変数でトークンを外へ送れないように)
console.log('\n[送り先の差し替え CHECK_MARKDOWN_ENDPOINT (265-A)]');
{
	const Endpoint = 'CHECK_MARKDOWN_ENDPOINT';
	const m = path.join(work, 'm');
	fs.mkdirSync(m, { recursive: true });
	fs.writeFileSync(path.join(m, 'a.md'), '# 題\n\n本文 **強調** です\n');
	const base = [m, '-r', '-e', 'NEVER_MATCHES_ANY_PATH', '--delay-ms', '0'];

	// ローカルに立てる受け口。受けた要求を記録し、返す中身は応答の種類で変える
	type Seen = { method: string; url: string; headers: Record<string, string | string[] | undefined>; body: string };
	const seen: Seen[] = [];
	let mode: 'ok' | 'ng' | 'err' = 'ok';
	const server = http.createServer((req, res) => {
		const chunks: Buffer[] = [];
		req.on('data', (c: Buffer) => chunks.push(c));
		req.on('end', () => {
			seen.push({ method: req.method ?? '', url: req.url ?? '', headers: req.headers, body: Buffer.concat(chunks).toString('utf8') });
			if (mode === 'err') { res.statusCode = 500; res.end('x'); return; }
			res.setHeader('Content-Type', 'text/html; charset=utf-8');
			res.end(mode === 'ng' ? '<p>本文 **強調** です</p>' : '<p>本文 <strong>強調</strong> です</p>');
		});
	});
	await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
	const port = (server.address() as { port: number }).port;
	const url = `http://127.0.0.1:${port}/markdown`;

	const cmAsync = (args: string[], env: Record<string, string | undefined>): Promise<Result> => new Promise((resolve) => {
		const e: Record<string, string | undefined> = { ...process.env, ...env };
		const child = spawn(process.execPath, [main, ...args], { cwd: work, env: e as NodeJS.ProcessEnv });
		let out = '';
		let err = '';
		child.stdout.on('data', (d: Buffer) => { out += d.toString('utf8'); });
		child.stderr.on('data', (d: Buffer) => { err += d.toString('utf8'); });
		const timer = setTimeout(() => child.kill(), 60000);
		child.on('close', (code) => { clearTimeout(timer); resolve({ code: code ?? -1, out: out.trim(), err: err.trim() }); });
	});

	// 1. 問題なしの HTML を返す: OK。送った中身を見る。トークンは付けない
	{
		seen.length = 0;
		mode = 'ok';
		const r = await cmAsync(base, { [Endpoint]: url, GITHUB_TOKEN: Secret, GH_TOKEN: undefined });
		check('差し替え先が問題なしの HTML を返せば、終了 0 で OK と出る', r.code === 0 && r.out.includes('a.md') && r.out.includes('OK'), r.out + r.err);
		check('差し替え先へ、md の本文を POST で 1 回だけ送る', seen.length === 1 && seen[0].method === 'POST' && (JSON.parse(seen[0].body) as { text: string }).text.includes('本文 **強調** です'), JSON.stringify(seen));
		check('差し替え先へ送る形は、GitHub の API と同じ (mode が gfm)', seen.length === 1 && (JSON.parse(seen[0].body) as { mode: string }).mode === 'gfm', JSON.stringify(seen));
		check('差し替え先には、トークンを付けない (Authorization が無い)', seen.length === 1 && seen[0].headers['authorization'] === undefined, JSON.stringify(seen[0]?.headers));
		check('トークンの値を出力に出さない', !(r.out + r.err).includes(Secret), r.out + r.err);
		check('送り先を差し替えたことを、出力に書く', r.out.includes(Endpoint), r.out);
	}
	// 2. ** が残った HTML を返す: NG (終了 1)
	{
		seen.length = 0;
		mode = 'ng';
		const r = await cmAsync(base, { [Endpoint]: url });
		check('** が残った HTML が返れば、終了 1 で問題の箇所を出す', r.code === 1 && r.out.includes('1 箇所'), r.out + r.err);
	}
	// 3. HTTP エラーを返す: 検証できません (終了 2)
	{
		seen.length = 0;
		mode = 'err';
		const r = await cmAsync(base, { [Endpoint]: url });
		check('HTTP エラーが返れば、検証できませんと出て終了 2', r.code === 2 && r.out.includes('検証できません'), r.out + r.err);
	}
	server.close();

	// 4. ローカルでない送り先は断る (送らない)。形が違う値も断る
	for (const bad of ['https://api.github.com/markdown', 'https://example.com/markdown', 'http://127.0.0.1.example.com/markdown', 'http://localhost@example.com/markdown', 'ftp://127.0.0.1/markdown', 'markdown', '']) {
		if (bad === '') { continue; }
		const r = await cmAsync(base, { [Endpoint]: bad, GITHUB_TOKEN: Secret });
		check(`送り先が ${bad} (ローカルでない・形が違う) なら、終了 2 で断り、環境変数の名前を案内する`, r.code === 2 && (r.out + r.err).includes(Endpoint) && !(r.out + r.err).includes(Secret), r.out + r.err);
	}
	// 5. 未設定のときは、これまでどおり (送り先の差し替えを案内する行を出さない)
	{
		const g = path.join(work, 'none');
		fs.mkdirSync(g, { recursive: true });
		const r = await cmAsync([g], { [Endpoint]: undefined });
		check('未設定なら、差し替えの行を出さない (これまでどおり)', r.code === 0 && !r.out.includes(Endpoint), r.out + r.err);
	}
	const h = await cmAsync(['--help'], {});
	check('使い方に、送り先の差し替え (CHECK_MARKDOWN_ENDPOINT) を載せる', h.out.includes(Endpoint), h.out);
}

fs.rmSync(work, { recursive: true, force: true });
console.log(`\n=== check-markdown: ${pass} 件成功 ・ ${fail} 件失敗 ===`);
process.exit(fail === 0 ? 0 : 1);
