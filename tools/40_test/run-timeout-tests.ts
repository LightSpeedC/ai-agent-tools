/*
	試験の時間の上限（invoke-with-timeout.ps1）のテスト。

	共通ルール「試験には時間の上限を付ける」を、一括実行のランチャ（run-all-tests.ps1）が守るための部品。
	  ・1 本ごとに上限を付け、超えたら、子孫ごと止めて ⏱️ 時間切れとして次へ進む
	  ・正常に終わったあとも、試験が残したプロセスはランチャが止める（残ると次の試験と取り違える）
	  ・Start-Process -Wait を使わない（子孫の終了まで待ち、一括実行が止まる）

	止める相手は、このテストが起動する node の子（眠るだけ）。本物の試験には触らない。
*/
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..', '..');
const work = path.join(root, 'tmp', 'timeout-tests');
const helper = path.join(here, 'invoke-with-timeout.ps1');

let pass = 0;
let fail = 0;
function check(name: string, ok: boolean, detail: string = ''): void {
	if (ok) { pass++; console.log('  ✅ [OK] ' + name); }
	else { fail++; console.log('  ❌ [NG] ' + name + (detail ? '  ' + detail : '')); }
}

function alive(pid: number): boolean {
	try { process.kill(pid, 0); return true; }
	catch (e) { return (e as NodeJS.ErrnoException).code === 'EPERM'; }
}

function waitFor(cond: () => boolean, ms: number): boolean {
	const end = Date.now() + ms;
	while (Date.now() < end) {
		if (cond()) { return true; }
		spawnSync(process.execPath, ['-e', 'setTimeout(()=>{},100)']);
	}
	return cond();
}

type Run = { code: number; out: string; ms: number };

/** 試験の代わりの node のスクリプトを、上限付きで走らせる */
function invoke(script: string, timeoutSec: number): Run {
	const t0 = Date.now();
	const r = spawnSync('powershell', [
		'-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', helper,
		'-FilePath', process.execPath,
		'-ArgumentLine', script,
		'-TimeoutSec', String(timeoutSec),
		'-Name', 'テスト用',
	], { encoding: 'utf8', timeout: 120000 });
	return { code: r.status ?? -1, out: (r.stdout ?? '') + (r.stderr ?? ''), ms: Date.now() - t0 };
}

function write(name: string, body: string): string {
	const p = path.join(work, name);
	fs.writeFileSync(p, body, 'utf8');
	return p;
}

fs.rmSync(work, { recursive: true, force: true });
fs.mkdirSync(work, { recursive: true });

console.log('');
console.log('=== 試験の時間の上限のテスト ===');

// ---- 1. 上限内に終わるなら、終了コードをそのまま返す ----
console.log('\n[1 上限内に終わる]');
{
	const ok = invoke(write('ok.mjs', "console.log('試験の出力');\n"), 20);
	check('終了コード 0 をそのまま返す', ok.code === 0, JSON.stringify(ok));
	check('試験の出力が、そのまま出る', ok.out.includes('試験の出力'), ok.out);
	const ng = invoke(write('ng.mjs', 'process.exit(3);\n'), 20);
	check('失敗の終了コード（3）もそのまま返す', ng.code === 3, JSON.stringify(ng));
	check('時間切れの表示は出ない', !ok.out.includes('時間切れ') && !ng.out.includes('時間切れ'), ok.out + ng.out);
}

// ---- 2. 上限を超えたら、止めて 124 を返す ----
console.log('\n[2 上限を超える]');
{
	const r = invoke(write('slow.mjs', 'setTimeout(() => {}, 60000);\n'), 2);
	check('終了コード 124（時間切れ）を返す', r.code === 124, JSON.stringify(r));
	check('⏱️ と時間切れを出す', r.out.includes('⏱️') && r.out.includes('時間切れ'), r.out);
	check('上限のあとすぐ終わる（60 秒の眠りを待たない）', r.ms < 15000, r.ms + ' ミリ秒');
}

// ---- 3. 時間切れのとき、子孫も止める ----
console.log('\n[3 時間切れで子孫も止める]');
{
	const pidFile = path.join(work, 'grandchild-1.pid').split('\\').join('/');
	const sleeper = write('sleeper.mjs', 'setTimeout(() => {}, 60000);\n').split('\\').join('/');
	const parent = write('parent.mjs', [
		"import fs from 'node:fs';",
		"import { spawn } from 'node:child_process';",
		`const c = spawn(process.execPath, ['${sleeper}'], { stdio: 'ignore' });`,
		`fs.writeFileSync('${pidFile}', String(c.pid));`,
		'setTimeout(() => {}, 60000);',
	].join('\n') + '\n');
	const r = invoke(parent, 3);
	const pid = Number(fs.existsSync(pidFile) ? fs.readFileSync(pidFile, 'utf8') : 0);
	check('終了コード 124', r.code === 124, JSON.stringify(r));
	check('孫のプロセスができていた（試験の前提）', pid > 0, 'pid が書かれていない');
	check('孫のプロセスも止まっている', pid > 0 && waitFor(() => !alive(pid), 5000), 'pid ' + pid + ' が残っている');
	if (pid > 0 && alive(pid)) { spawnSync('taskkill', ['/PID', String(pid), '/T', '/F']); }
}

// ---- 4. 正常に終わっても、残ったプロセスは止める ----
console.log('\n[4 正常終了のあとに残ったプロセス]');
{
	const pidFile = path.join(work, 'grandchild-2.pid').split('\\').join('/');
	const sleeper = write('sleeper2.mjs', 'setTimeout(() => {}, 60000);\n').split('\\').join('/');
	const parent = write('leaver.mjs', [
		"import fs from 'node:fs';",
		"import { spawn } from 'node:child_process';",
		`const c = spawn(process.execPath, ['${sleeper}'], { stdio: 'ignore', detached: true });`,
		`fs.writeFileSync('${pidFile}', String(c.pid));`,
		'c.unref();',
	].join('\n') + '\n');
	const r = invoke(parent, 20);
	const pid = Number(fs.existsSync(pidFile) ? fs.readFileSync(pidFile, 'utf8') : 0);
	check('終了コードは、試験の 0 のまま', r.code === 0, JSON.stringify(r));
	check('残したことを ⚠️ で知らせる', r.out.includes('⚠️') && r.out.includes('残した'), r.out);
	check('残ったプロセスが止まっている', pid > 0 && waitFor(() => !alive(pid), 5000), 'pid ' + pid + ' が残っている');
	if (pid > 0 && alive(pid)) { spawnSync('taskkill', ['/PID', String(pid), '/T', '/F']); }
}

// ---- 5. 一括実行のランチャが、これを使い、-Wait を使っていない ----
console.log('\n[5 ランチャの書き方]');
{
	const launcher = fs.readFileSync(path.join(here, 'run-all-tests.ps1'), 'utf8').replace(/<#[\s\S]*?#>/g, '').replace(/^\s*#.*$/gm, '');
	check('Start-Process -Wait を使わない', !/Start-Process[^\n]*-Wait/.test(launcher), '子孫の終了まで待ってしまう');
	check('上限付きの呼び出し（invoke-with-timeout.ps1）を使う', launcher.includes('invoke-with-timeout.ps1'), '');
	check('素の呼び出し（& $runner $path）が残っていない', !/&\s*\$runner\s+\$path/.test(launcher), '上限が付かない呼び出しが残っている');
}

fs.rmSync(work, { recursive: true, force: true });

console.log('');
if (fail === 0) {
	console.log('=== ' + pass + ' 件すべて成功 ===');
	process.exit(0);
}
console.log('=== ' + fail + ' 件失敗（成功 ' + pass + ' 件）===');
process.exit(1);
