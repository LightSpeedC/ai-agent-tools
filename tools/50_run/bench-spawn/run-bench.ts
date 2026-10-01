/*
	spawn-server の起動方法（A ・ B ・ C）を比べる。
	    node tools/50_run/bench-spawn/run-bench.ts
	見るもの: 起動にかかる時間 ・ コマンドの解釈（> と &）・ 日本語 ・ 環境変数の引き継ぎと漏れ ・
	出力が窓に出るか ・ 新しい窓（conhost）・ プロセスツリー ・ サーバー役を taskkill /T で止めたときに残るか。
	窓が何度か開いて閉じる。
*/
import { spawn, execFileSync, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..', '..', '..');
const work = path.join(root, 'tmp', 'bench-spawn');
const launcher = path.join(here, 'launcher.ts');
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function ps(script: string): string {
	return execFileSync('powershell', ['-NoProfile', '-Command', script], { encoding: 'utf8', timeout: 30000 }).trim();
}
function alive(pid: number): boolean { try { process.kill(pid, 0); return true; } catch { return false; } }
function kill(pid: number, tree: boolean): void {
	try { execFileSync('taskkill', ['/PID', String(pid), ...(tree ? ['/T'] : []), '/F'], { stdio: 'ignore' }); } catch { /* 既に無い */ }
}

// root の下を字下げして並べる
function tree(rootPid: number): string {
	return ps('$all = @(Get-CimInstance Win32_Process); function T($id, $d) { foreach ($c in @($all | Where-Object { $_.ParentProcessId -eq $id -and $_.ProcessId -ne $id })) { ("  " * $d) + $c.Name + " " + $c.ProcessId; T $c.ProcessId ($d + 1) } }; '
		+ '$r = $all | Where-Object { $_.ProcessId -eq ' + rootPid + ' }; if ($r) { $r.Name + " " + $r.ProcessId }; T ' + rootPid + ' 1');
}

function start(method: string, command: string): Promise<{ proc: ChildProcess; pid: number; ms: number }> {
	return new Promise((resolve, reject) => {
		const proc = spawn(process.execPath, [launcher, method, work, command], { stdio: ['ignore', 'pipe', 'inherit'], env: { ...process.env, BENCH_MARK: 'mark-ok' } });
		let out = '';
		proc.stdout!.on('data', (d) => {
			out += d;
			const m = /pid (\d+) ms (\d+)/.exec(out);
			if (m) { resolve({ proc, pid: Number(m[1]), ms: Number(m[2]) }); }
		});
		proc.on('exit', () => reject(new Error(method + ' の launcher が終わりました: ' + out)));
	});
}

fs.rmSync(work, { recursive: true, force: true });
fs.mkdirSync(work, { recursive: true });

// 引数で案を絞れる（node run-bench.ts D）
const methods = process.argv.length > 2 ? process.argv.slice(2) : ['A', 'B', 'C', 'D'];
for (const method of methods) {
	console.log('');
	console.log('=== 案 ' + method + ' ===');

	// 1. 起動にかかる時間（依頼を受けてから pid が返るまで）。5 回の中央値
	const times: number[] = [];
	for (let i = 0; i < 5; i++) {
		const r = await start(method, 'cmd /c exit');
		times.push(r.ms);
		r.proc.kill();
		await sleep(300);
	}
	times.sort((a, b) => a - b);
	console.log('起動の時間: 中央値 ' + times[2] + ' ms（' + times.join(' / ') + '）');

	// 2. 機能。> と & を含み、日本語 ・ 環境変数 ・ 出力先を書き出して、しばらく生きるコマンド
	const out = path.join(work, 'out-' + method + '.txt');
	// spawn-server は受けたものを cmd /c に渡すので、ここも cmd の書き方で書く（外側の cmd /c は付けない）
	const f = 'out-' + method + '.txt';
	const command = 'echo 日本語 %BENCH_MARK%>' + f + ' & echo [%SPAWN_COMMAND%]>>' + f
		+ ' & powershell -NoProfile -ExecutionPolicy Bypass -File ' + path.join(here, 'check-console.ps1') + ' ' + f
		+ ' & ping -n 10 127.0.0.1 >nul';
	const r = await start(method, command);
	await sleep(3000);
	console.log('プロセスツリー（サーバー役から）:');
	console.log(tree(r.proc.pid!).split('\n').map((l) => '  ' + l).join('\n'));
	const lines = fs.existsSync(out) ? new TextDecoder('shift_jis').decode(fs.readFileSync(out)).split(/\r?\n/).filter(Boolean) : [];
	console.log('返した pid の下:');
	console.log(tree(r.pid).split('\n').map((l) => '  ' + l).join('\n'));
	console.log('返した pid: ' + r.pid);
	console.log('書いたファイル: ' + JSON.stringify(lines));
	console.log('  > と & が窓の中で効く: ' + (lines.length >= 2 ? 'はい' : 'いいえ'));
	console.log('  日本語と環境変数を引き継ぐ: ' + (lines[0] === '日本語 mark-ok' ? 'はい' : 'いいえ'));
	console.log('  SPAWN_COMMAND を持ち込まない: ' + (lines[1] === '[%SPAWN_COMMAND%]' ? 'はい' : 'いいえ（' + lines[1] + '）'));
	console.log('  出力が窓に出る（リダイレクトされていない）: ' + (lines[2] === 'False' ? 'はい' : lines[2] === 'True' ? 'いいえ' : '不明'));

	// 3. サーバー役を taskkill /T で止めても残るか
	kill(r.proc.pid!, true);
	await sleep(1000);
	console.log('  サーバー役を taskkill /T で止めても残る: ' + (alive(r.pid) ? 'はい' : 'いいえ'));
	kill(r.pid, true);
	await sleep(500);

	// 4. /T を付けずに（サーバー役だけを）止めたとき。Ctrl+C ・ 窓を閉じるのに近い
	const r2 = await start(method, 'ping -n 10 127.0.0.1 >nul');
	await sleep(1500);
	kill(r2.proc.pid!, false);
	await sleep(1000);
	console.log('  サーバー役だけを止めたら残る: ' + (alive(r2.pid) ? 'はい' : 'いいえ'));
	kill(r2.pid, true);
	await sleep(500);
}

fs.rmSync(work, { recursive: true, force: true });
