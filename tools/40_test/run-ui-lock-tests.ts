/*
	ui-lock のテスト (課題 i261114-01)。

	本物のロック (Local\ai-interactive-desktop) と持ち主の記録を汚さないよう、
	環境変数で名前と置き場を試験用に替える。
	    UI_LOCK_NAME      ロックの名前
	    UI_LOCK_DIR       owner.json の置き場
	    UI_LOCK_NO_TOAST  1 ならトーストを出さない
	TS 版は、走らせた処理系 (bun は bun:ffi、node は koffi) で同じ試験を流す。
	UI_LOCK_TEST_TARGET に Rust 版の exe を渡すと、exe を試す。そのときは TS 版とロックを
	取り合えることも見る (同じ名前のロックを、別の実装どうしで守れること)。
*/

import { spawn, spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..', '..');
const tool = path.join(root, 'src', 'ui-lock', 'main.ts');
const runner = process.argv[0];

let pass = 0;
let fail = 0;
function ok(name: string): void { pass++; console.log('  [OK] ' + name); }
function ng(name: string, detail: string): void { fail++; console.log('  [NG] ' + name + '  ' + detail); }
function eq(name: string, expected: unknown, actual: unknown): void {
	if (expected === actual) ok(name); else ng(name, '期待 ' + JSON.stringify(expected) + ' / 実際 ' + JSON.stringify(actual));
}
function yes(name: string, value: boolean, detail: string): void { if (value) ok(name); else ng(name, detail); }

const work = fs.mkdtempSync(path.join(os.tmpdir(), 'ui-lock-test-'));
const lockName = 'Local\\ui-lock-test-' + process.pid;
const env = { ...process.env, UI_LOCK_NAME: lockName, UI_LOCK_DIR: work, UI_LOCK_NO_TOAST: '1' };
const ownerFile = path.join(work, 'owner.json');

const target = process.env.UI_LOCK_TEST_TARGET || '';
/** 試す実装の起動の形。exe なら exe そのもの、無ければ走らせた処理系で TS 版 */
function cmdOf(args: string[]): [string, string[]] {
	return target ? [target, args] : [runner, [tool, ...args]];
}

function run(args: string[]): { code: number; out: string; err: string } {
	const [c, a] = cmdOf(args);
	const r = spawnSync(c, a, { encoding: 'utf8', env });
	return { code: r.status ?? -1, out: r.stdout ?? '', err: r.stderr ?? '' };
}

/** 子として流すコマンド: ms だけ眠ってから code で終わる */
function sleeper(ms: number, code = 0): string[] {
	return [runner, '-e', 'setTimeout(()=>process.exit(' + code + '),' + ms + ')'];
}

function waitFor(cond: () => boolean, ms: number): Promise<boolean> {
	const end = Date.now() + ms;
	return new Promise((resolve) => {
		const tick = (): void => {
			if (cond()) { resolve(true); return; }
			if (Date.now() > end) { resolve(false); return; }
			setTimeout(tick, 100);
		};
		tick();
	});
}

/** 背面で ui-lock を起こす。終わりの約束は起こした直後に作る (先に終わっても取りこぼさない) */
function startHolder(args: string[], e: NodeJS.ProcessEnv): { pid: number; done: Promise<void> } {
	const [cmd, a] = cmdOf(args);
	const c = spawn(cmd, a, { env: e, stdio: 'ignore' });
	const done = new Promise<void>((resolve) => { c.on('exit', () => resolve()); c.on('error', () => resolve()); });
	return { pid: c.pid ?? -1, done };
}

// 試験全体の上限。止まったまま残らないようにする
setTimeout(() => { console.log('  [NG] 試験全体が 90 秒を超えた'); process.exit(1); }, 90000).unref();

console.log('');
console.log('=== ui-lock のテスト (' + (target ? 'exe' : typeof Bun !== 'undefined' ? 'bun' : 'node') + ') ===');
console.log('');

{
	const r = run(['--help']);
	eq('--help は 0 で終わる', 0, r.code);
	yes('--help は使い方を出す', r.out.includes('ui-lock run'), r.out);
}

{
	{
		const r = run(['run']);
		eq('-- の無い run は引数の誤り (5)', 5, r.code);
		const r2 = run(['run', '--timeout', '10x', '--', ...sleeper(0)]);
		eq('時間の形の誤りは 5', 5, r2.code);
		const r3 = run(['nosuch']);
		eq('知らない下位コマンドは 5', 5, r3.code);
	}
	{
		const r = run(['status']);
		eq('空きの status は 0', 0, r.code);
		yes('空きの status は空きと出す', r.out.includes('空き'), r.out);
	}
	{
		const r = run(['run', '--', ...sleeper(0, 7)]);
		eq('子の終了コードをそのまま返す', 7, r.code);
		yes('終わったら owner.json を消す', !fs.existsSync(ownerFile), '残っている');
	}

	// 持ち主がいる間: status ・ 待ちの上限 ・ 追加の名前
	{
		const holder = startHolder(['run', '--timeout', '30s', '--', ...sleeper(6000)], env);
		const got = await waitFor(() => fs.existsSync(ownerFile), 5000);
		yes('取ったら owner.json を書く', got, '書かれない');
		if (got) {
			const owner = JSON.parse(fs.readFileSync(ownerFile, 'utf8'));
			eq('owner.json に pid', holder.pid, owner.pid);
			yes('owner.json に command', typeof owner.command === 'string' && owner.command.includes('setTimeout'), JSON.stringify(owner));
			yes('owner.json に project ・ worktree ・ started', !!owner.project && !!owner.worktree && !!owner.started, JSON.stringify(owner));
			const s = run(['status']);
			eq('使用中の status は 1', 1, s.code);
			yes('使用中の status は持ち主の pid を出す', s.out.includes(String(holder.pid)), s.out);
			const t0 = Date.now();
			const w = run(['run', '--wait', '2s', '--', ...sleeper(0)]);
			eq('待ちの上限を過ぎたら 3', 3, w.code);
			yes('待ちの上限は 2 秒ほど', Date.now() - t0 < 6000, String(Date.now() - t0));
			yes('取れないときは持ち主を出す', w.out.includes(String(holder.pid)), w.out);
		}
		await holder.done;
	}
	{
		// 追加の名前 (--also) だけが使われていても、取れずに待つ
		const other = lockName + '-old';
		const envOther = { ...env, UI_LOCK_NAME: other, UI_LOCK_DIR: path.join(work, 'other') };
		fs.mkdirSync(envOther.UI_LOCK_DIR, { recursive: true });
		const holder = startHolder(['run', '--', ...sleeper(5000)], envOther);
		await waitFor(() => fs.existsSync(path.join(envOther.UI_LOCK_DIR, 'owner.json')), 5000);
		const w = run(['run', '--also', other, '--wait', '2s', '--', ...sleeper(0)]);
		eq('--also の名前が使用中なら 3', 3, w.code);
		await holder.done;
		const w2 = run(['run', '--also', other, '--', ...sleeper(0)]);
		eq('--also の名前が空けば取れる', 0, w2.code);
	}
	{
		// 実行の上限: 子ごと止めて 4
		const t0 = Date.now();
		const r = run(['run', '--timeout', '2s', '--', ...sleeper(20000)]);
		eq('実行の上限を過ぎたら 4', 4, r.code);
		yes('上限の 2 秒ほどで止まる', Date.now() - t0 < 8000, String(Date.now() - t0));
		yes('止めたら owner.json を消す', !fs.existsSync(ownerFile), '残っている');
	}
	{
		// 放棄: 持ち主を強制終了しても、次が取れる
		const holder = startHolder(['run', '--', ...sleeper(20000)], env);
		await waitFor(() => fs.existsSync(ownerFile), 5000);
		spawnSync('taskkill', ['/PID', String(holder.pid), '/T', '/F']);
		await holder.done;
		const r = run(['run', '--wait', '5s', '--', ...sleeper(0)]);
		eq('放棄されたロックは次が取れる', 0, r.code);
		yes('放棄を知らせる', r.out.includes('放棄'), r.out);
	}
	if (target) {
		// 別の実装どうし: TS 版 (走らせた処理系) が持つ間、exe は取れない。逆も同じ
		const ts = spawn(runner, [tool, 'run', '--', ...sleeper(5000)], { env, stdio: 'ignore' });
		const tsDone = new Promise<void>((resolve) => ts.on('exit', () => resolve()));
		await waitFor(() => fs.existsSync(ownerFile), 5000);
		eq('TS 版が持つ間、exe は待ちの上限で 3', 3, run(['run', '--wait', '2s', '--', ...sleeper(0)]).code);
		await tsDone;
		const exe = startHolder(['run', '--', ...sleeper(5000)], env);
		await waitFor(() => fs.existsSync(ownerFile), 5000);
		const r = spawnSync(runner, [tool, 'run', '--wait', '2s', '--', ...sleeper(0)], { encoding: 'utf8', env });
		eq('exe が持つ間、TS 版は待ちの上限で 3', 3, r.status);
		await exe.done;
	}
}

fs.rmSync(work, { recursive: true, force: true });
console.log('');
console.log('合格 ' + pass + ' / 不合格 ' + fail);
process.exit(fail === 0 ? 0 : 1);
