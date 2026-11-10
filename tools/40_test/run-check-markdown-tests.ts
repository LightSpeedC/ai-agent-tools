/*
	check-markdown の試験。GitHub へは送らない (対象の .md が無い置き場で流す)。

	- 234-A: トークンを引数で受けない。--token ・ -Token を渡したら終了コード 2 で、環境変数か gh を使うよう案内する
	- トークンの読み先 (環境変数 GITHUB_TOKEN ・ GH_TOKEN ・ gh auth token) を出す。値は出さない

	期待値は、決めた仕様から先に手で書いた (実装の出力から作っていない)。
	process.execPath で src/check-markdown/main.ts を動かすので、bun でも node でも流せる。
*/
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
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

fs.rmSync(work, { recursive: true, force: true });
console.log(`\n=== check-markdown: ${pass} 件成功 ・ ${fail} 件失敗 ===`);
process.exit(fail === 0 ? 0 : 1);
