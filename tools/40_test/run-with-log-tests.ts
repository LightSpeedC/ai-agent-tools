/*
	run-with-log.ps1 の試験 (i261119-01 の 276-A)。

	夜の全件の試験の出力を、画面とファイルの両方へ残す。落ちた理由を、後から読めるようにする。
	- 子の終了コードをそのまま返す
	- 子の出力 (標準出力 ・ 標準エラー) を、UTF-8 のまま、ログのファイルに残す
	- 画面にも同じ行を出す
	- KeepDays を過ぎた古い .log だけを消す

	bun でも node でも走る。
*/

import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..', '..');
const wrapper = path.join(here, 'run-with-log.ps1');
const work = path.join(root, 'tmp', 'run-with-log-test-' + process.pid);

let pass = 0;
let fail = 0;

function check(name: string, cond: boolean, detail: string): void {
	if (cond) { pass++; console.log('  [OK] ' + name); }
	else { fail++; console.log('  [NG] ' + name + '  ' + detail.slice(0, 200).replace(/\r?\n/g, ' / ')); }
}

fs.mkdirSync(work, { recursive: true });

// 子 (BOM 付き UTF-8 で書く。Windows PowerShell 5.1 が日本語を読めるように)
function writeChild(name: string, body: string): string {
	const p = path.join(work, name);
	fs.writeFileSync(p, '﻿' + body.replace(/\n/g, '\r\n'), 'utf8');
	return p;
}

function run(child: string, argLine: string, logDir: string, graceSec = 5): { code: number; out: string; sec: number } {
	const t0 = Date.now();
	const r = spawnSync('powershell', [
		'-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', wrapper,
		'-Script', child, '-ArgumentLine', argLine, '-LogDir', logDir, '-KeepDays', '30', '-GraceSec', String(graceSec),
	], { encoding: 'utf8', timeout: 120000 });
	return { code: r.status ?? -1, out: (r.stdout ?? '') + (r.stderr ?? ''), sec: (Date.now() - t0) / 1000 };
}

function readLog(logDir: string, prefix: string): string {
	const names = fs.readdirSync(logDir).filter((n) => n.startsWith(prefix) && n.endsWith('.log'));
	return names.length === 1 ? fs.readFileSync(path.join(logDir, names[0]), 'utf8') : '';
}

try {
	console.log('');
	console.log('=== run-with-log の試験 ===');
	console.log('');

	const logDir = path.join(work, 'logs');
	fs.mkdirSync(logDir, { recursive: true });

	// 古い .log (40 日前) と、新しい .log (1 日前)、.log ではないもの (古い)
	const oldLog = path.join(logDir, 'old.log');
	const freshLog = path.join(logDir, 'fresh.log');
	const otherFile = path.join(logDir, 'old.txt');
	for (const f of [oldLog, freshLog, otherFile]) fs.writeFileSync(f, 'x');
	const day = 24 * 60 * 60 * 1000;
	fs.utimesSync(oldLog, new Date(Date.now() - 40 * day), new Date(Date.now() - 40 * day));
	fs.utimesSync(otherFile, new Date(Date.now() - 40 * day), new Date(Date.now() - 40 * day));
	fs.utimesSync(freshLog, new Date(Date.now() - 1 * day), new Date(Date.now() - 1 * day));

	// 失敗する子: 日本語の出力 ・ 標準エラー ・ 引数 ・ 終了コード 3
	const failing = writeChild('failing-child.ps1', [
		"Write-Host '日本語の行 ・ ①'",
		"[Console]::Error.WriteLine('標準エラーの行')",
		"Write-Host ('引数: ' + ($args -join ','))",
		// 孫 (bun の試験など) が、同じパイプへ UTF-8 で直接書く場面
		"$o = [Console]::OpenStandardOutput(); $b = [Text.Encoding]::UTF8.GetBytes(\"UTF-8 の行 ・ ②`r`n\"); $o.Write($b, 0, $b.Length); $o.Flush()",
		'exit 3',
	].join('\n'));
	let r = run(failing, 'a b', logDir);
	check('子の終了コード (3) をそのまま返す', r.code === 3, 'code=' + r.code + ' ' + r.out);
	check('画面にも、子の日本語の行を出す', r.out.includes('日本語の行 ・ ①'), r.out);

	const logs = fs.readdirSync(logDir).filter((n) => n.startsWith('failing-child_') && n.endsWith('.log'));
	check('ログのファイルが 1 本できる (名前は 子の名前_日時.log)', logs.length === 1, JSON.stringify(logs));
	const logText = logs.length === 1 ? fs.readFileSync(path.join(logDir, logs[0]), 'utf8') : '';
	check('ログに、子の日本語の行が、化けずに入る', logText.includes('日本語の行 ・ ①'), logText);
	check('ログに、UTF-8 で直接書かれた行も、化けずに入る (1 本の流れに 2 つの文字コードが混ざる)', logText.includes('UTF-8 の行 ・ ②'), logText);
	check('画面にも、UTF-8 で直接書かれた行を出す', r.out.includes('UTF-8 の行 ・ ②'), r.out);
	check('ログに、標準エラーの行が入る', logText.includes('標準エラーの行'), logText);
	check('ログに、引数が渡った行が入る', logText.includes('引数: a,b'), logText);
	check('ログに、終了コードが残る', /終了コード[:：]\s*3/.test(logText), logText);

	check('古い .log (40 日前) は消える', !fs.existsSync(oldLog), 'old.log が残っている');
	check('新しい .log (1 日前) は残る', fs.existsSync(freshLog), 'fresh.log が消えた');
	check('.log ではない古いファイルは消さない', fs.existsSync(otherFile), 'old.txt が消えた');

	// 成功する子
	const ok = writeChild('ok-child.ps1', "Write-Host '成功の行'\nexit 0");
	r = run(ok, '', logDir);
	check('成功する子は終了コード 0 を返す', r.code === 0, 'code=' + r.code + ' ' + r.out);
	const okLogs = fs.readdirSync(logDir).filter((n) => n.startsWith('ok-child_') && n.endsWith('.log'));
	const okText = okLogs.length === 1 ? fs.readFileSync(path.join(logDir, okLogs[0]), 'utf8') : '';
	check('成功した回のログにも、出力と終了コード 0 が残る', okText.includes('成功の行') && /終了コード[:：]\s*0/.test(okText), okText);

	// 標準出力と標準エラーは、届いた順にログへ入る (どの試験の最中に出たかが読める)
	const order = writeChild('order-child.ps1', [
		"Write-Host '順1 標準出力'",
		'Start-Sleep -Milliseconds 700',
		"[Console]::Error.WriteLine('順2 標準エラー')",
		'Start-Sleep -Milliseconds 700',
		"Write-Host '順3 標準出力'",
	].join('\n'));
	r = run(order, '', logDir);
	const orderText = readLog(logDir, 'order-child_');
	const i1 = orderText.indexOf('順1 標準出力');
	const i2 = orderText.indexOf('順2 標準エラー');
	const i3 = orderText.indexOf('順3 標準出力');
	check('標準エラーは、出た順にログの途中へ入る (最後にまとめない)', i1 >= 0 && i2 > i1 && i3 > i2, orderText);
	check('標準エラーの行頭に [標準エラー] が付く', orderText.includes('[標準エラー] 順2 標準エラー'), orderText);

	// 孫がパイプを持ったまま残っても、打ち切って終わる (終わらないと、夜の試験が止まったまま記録も書かれない)
	const grand = writeChild('grand-child.ps1', [
		"Write-Host '孫の前の行'",
		// 標準出力を受け継ぐ孫を、30 秒生かしたまま、子は終わる
		"Start-Process powershell -ArgumentList '-NoProfile','-Command','Start-Sleep 30' -NoNewWindow",
		"Write-Host '子は終わる'",
		'exit 4',
	].join('\n'));
	r = run(grand, '', logDir, 2);
	const grandText = readLog(logDir, 'grand-child_');
	// 孫は試験側の標準出力も受け継ぐので、spawnSync の所要時間では測れない。ログの 開始 と 終了コード の時刻の差で見る
	const stamp = (re: RegExp): number => {
		const m = re.exec(grandText);
		return m ? new Date(m[1].replace(' ', 'T')).getTime() : NaN;
	};
	const logSec = (stamp(/# 終了コード: \d+ \((\d{4}-\d\d-\d\d \d\d:\d\d:\d\d)\)/) - stamp(/# 開始 (\d{4}-\d\d-\d\d \d\d:\d\d:\d\d)/)) / 1000;
	check('孫が残っていても、打ち切って終わる (30 秒待たない)', logSec < 20, 'logSec=' + logSec + ' ' + grandText);
	check('孫が残っていても、子の終了コード (4) を返す', r.code === 4, 'code=' + r.code + ' ' + r.out);
	check('打ち切ったことがログに残る', grandText.includes('読みを打ち切ります'), grandText);
	check('打ち切る前の出力は、ログに残る', grandText.includes('孫の前の行') && grandText.includes('子は終わる'), grandText);
} finally {
	fs.rmSync(work, { recursive: true, force: true });
}

console.log('');
if (fail === 0) {
	console.log('=== ' + pass + ' 件すべて成功 ===');
	process.exit(0);
}
console.log('=== ' + fail + ' 件失敗 (成功 ' + pass + ' 件) ===');
process.exit(1);
