/*
	cc ・ cx ・ ag の入口 (src/agent-launch/main.ts) と、窓の番人 (src/agent-launch/keeper.cmd) のテスト。

	計画: notes/10_plan/i261101-02-ag-cmdと起動の共通部.html
	  ・名前を渡さないと [NG] で終わる (86-A)
	  ・新しいフォルダは新規、既存のフォルダは、そのエージェントの履歴があれば続き、無ければ新規
	  ・番人: エージェントが終わるたびに R (再起動) か Q (終了) を尋ね、R なら続きの引数で起動し直す (88 ・ 89 ・ 90-A)
	  ・cc は CLAUDE で始まる環境変数を子に渡さない。番人への入力 (KEEPER_*) はエージェントに渡さない

	試験では、置き場を CC_ROOT で、履歴の置き場 (ホーム) を AGENT_LAUNCH_TEST_HOME で tmp/ の下へ差し替え、
	起こす相手 (claude.exe ・ codex-trusted ・ ag-trusted) を、記録するだけの代役に差し替える (PATH の先頭に置く)。
	窓は、AGENT_LAUNCH_TEST_HIDE=1 で非表示にする (共通ルール「窓が要る試験は、非表示で裏に回す」)。
	本物の W:\ ・ 本物の履歴 ・ 本物のエージェントは触らない。
*/

import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..', '..');
const main = path.join(root, 'src', 'agent-launch', 'main.ts');
const keeper = path.join(root, 'src', 'agent-launch', 'keeper.cmd');
const work = path.join(root, 'tmp', 'agent-entry-test');
const projectsRoot = path.join(work, 'root') + path.sep;
const home = path.join(work, 'home');
const stubDir = path.join(work, 'stub');
const outPath = path.join(work, 'stub-out.txt');
const logPath = path.join(work, 'keeper-log.txt');

let pass = 0;
let fail = 0;

function ok(name: string): void {
	pass++;
	console.log('  [OK] ' + name);
}

function ng(name: string, detail: string): void {
	fail++;
	console.log('  [NG] ' + name + '  ' + detail);
}

function assertEqual(name: string, expected: unknown, actual: unknown): void {
	const e = JSON.stringify(expected);
	const a = JSON.stringify(actual);
	if (e === a) { ok(name); } else { ng(name, '期待 ' + e + ' / 実際 ' + a); }
}

// 代役。claude.exe は引数・カレント・環境変数 (CLAUDE ・ KEEPER ・ KP_ で始まるもの) を記録する。
// codex-trusted ・ ag-trusted (cmd) は、引数 (そのままの文字列) ・ カレント ・ 同じ環境変数の名前を記録する
const claudeStub = `
use std::io::Write;
fn main() {
	let out = std::env::var("AGENT_LAUNCH_TEST_OUT").unwrap_or_default();
	if out.is_empty() { return; }
	let mut s = String::new();
	s.push_str(&format!("cwd={}\\n", std::env::current_dir().unwrap().display()));
	let args: Vec<String> = std::env::args().skip(1).collect();
	s.push_str(&format!("args={}\\n", args.join("\\u{1f}")));
	for (k, _) in std::env::vars() {
		let u = k.to_uppercase();
		if u.starts_with("CLAUDE") || u.starts_with("KEEPER") || u.starts_with("KP_") { s.push_str(&format!("env:{}\\n", k)); }
	}
	let tmp = format!("{}.tmp", out);
	std::fs::File::create(&tmp).unwrap().write_all(s.as_bytes()).unwrap();
	std::fs::rename(&tmp, &out).unwrap();
}
`;

const cmdStub = [
	'@echo off',
	'> "%AGENT_LAUNCH_TEST_OUT%.tmp" echo cwd=%CD%',
	'>> "%AGENT_LAUNCH_TEST_OUT%.tmp" echo args=%*',
	'for /f "delims==" %%a in (\'set KEEPER 2^>nul\') do >> "%AGENT_LAUNCH_TEST_OUT%.tmp" echo env:%%a',
	'for /f "delims==" %%a in (\'set KP_ 2^>nul\') do >> "%AGENT_LAUNCH_TEST_OUT%.tmp" echo env:%%a',
	'move /y "%AGENT_LAUNCH_TEST_OUT%.tmp" "%AGENT_LAUNCH_TEST_OUT%" >nul',
	'exit /b 0',
	'',
].join('\r\n');

// 番人の試験用の代役: 起動のたびに、引数と、KEEPER ・ KP_ の変数の名前を、ログへ足す。終了コードは AGENT_LAUNCH_TEST_EXIT
const keeperStub = [
	'@echo off',
	'>> "%AGENT_LAUNCH_TEST_LOG%" echo run args=%*',
	'for /f "delims==" %%a in (\'set KEEPER 2^>nul\') do >> "%AGENT_LAUNCH_TEST_LOG%" echo env:%%a',
	'for /f "delims==" %%a in (\'set KP_ 2^>nul\') do >> "%AGENT_LAUNCH_TEST_LOG%" echo env:%%a',
	'if defined AGENT_LAUNCH_TEST_EXIT exit /b %AGENT_LAUNCH_TEST_EXIT%',
	'exit /b 0',
	'',
].join('\r\n');

function setup(): void {
	fs.rmSync(work, { recursive: true, force: true });
	fs.mkdirSync(projectsRoot, { recursive: true });
	fs.mkdirSync(home, { recursive: true });
	fs.mkdirSync(stubDir, { recursive: true });
	const src = path.join(work, 'claude-stub.rs');
	fs.writeFileSync(src, claudeStub);
	const r = spawnSync('rustc', [src, '-o', path.join(stubDir, 'claude.exe')], { encoding: 'utf8' });
	if (r.status !== 0) {
		console.log('[NG] 代役の claude.exe を作れません: ' + (r.stderr ?? ''));
		process.exit(2);
	}
	fs.writeFileSync(path.join(stubDir, 'codex-trusted.cmd'), cmdStub);
	fs.writeFileSync(path.join(stubDir, 'ag-trusted.cmd'), cmdStub);
	fs.writeFileSync(path.join(stubDir, 'stub-agent.cmd'), keeperStub);
}

const sleepSync = (ms: number): void => { spawnSync(process.execPath, ['-e', 'setTimeout(()=>{},' + ms + ')']); };

interface Recorded { cwd: string; args: string; env: string[] }

function readRecord(): Recorded | null {
	if (!fs.existsSync(outPath)) { return null; }
	// cmd の echo は窓のコードページ (932) で書く。claude.exe の代役は UTF-8
	const bytes = fs.readFileSync(outPath);
	const text = new TextDecoder('utf-8').decode(bytes).includes('\ufffd') ? new TextDecoder('shift_jis').decode(bytes) : new TextDecoder('utf-8').decode(bytes);
	const rec: Recorded = { cwd: '', args: '', env: [] };
	for (const l of text.split(/\r?\n/)) {
		if (l.startsWith('cwd=')) { rec.cwd = l.slice(4); }
		else if (l.startsWith('args=')) { rec.args = l.slice(5); }
		else if (l.startsWith('env:')) { rec.env.push(l.slice(4)); }
	}
	return rec;
}

/** 入口を動かし、代役が書いた記録を返す (番人は別のプロセスで動くため、記録が出るまで待つ) */
function runMain(agent: string, name: string | null, extraEnv: Record<string, string> = {}, waitRecord = true): { code: number | null; out: string; rec: Recorded | null } {
	fs.rmSync(outPath, { force: true });
	const env: Record<string, string | undefined> = {
		...process.env,
		CC_ROOT: projectsRoot,
		AGENT_LAUNCH_TEST_HOME: home,
		AGENT_LAUNCH_TEST_HIDE: '1',
		AGENT_LAUNCH_TEST_OUT: outPath,
		CC_CLAUDE_JSON: path.join(work, 'claude.json'),
		PATH: stubDir + path.delimiter + (process.env.PATH ?? ''),
		CLAUDECODE: '1',
		CLAUDE_CODE_SESSION_ID: 'session-x',
		CLAUDE_CODE_USE_POWERSHELL_TOOL: '1',
		...extraEnv,
	};
	const r = spawnSync(process.execPath, [main, agent, ...(name == null ? [] : [name])], { encoding: 'utf8', timeout: 60000, env, cwd: work });
	if (waitRecord) {
		const limit = Date.now() + 20000;
		while (!fs.existsSync(outPath) && Date.now() < limit) { sleepSync(200); }
	}
	return { code: r.status, out: (r.stdout ?? '') + (r.stderr ?? ''), rec: readRecord() };
}

function makeHistory(agent: string, dirName: string): void {
	// 履歴を引くのは、試験の置き場 (tmp/ の下) の本当のパス。W:\2026\… の形ではない
	const winDir = path.join(projectsRoot, '2026', dirName);
	if (agent === 'cc') {
		const d = path.join(home, '.claude', 'projects', winDir.replace(/[^A-Za-z0-9]/g, '-'));
		fs.mkdirSync(d, { recursive: true });
		fs.writeFileSync(path.join(d, 'a.jsonl'), '{}\n');
	} else if (agent === 'ag') {
		const base = path.join(home, '.gemini', 'antigravity-cli');
		fs.mkdirSync(path.join(base, 'cache'), { recursive: true });
		fs.mkdirSync(path.join(base, 'conversations'), { recursive: true });
		const f = path.join(base, 'cache', 'last_conversations.json');
		const table = fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : {};
		table[winDir] = 'id-' + dirName;
		fs.writeFileSync(f, JSON.stringify(table));
		fs.writeFileSync(path.join(base, 'conversations', 'id-' + dirName + '.db'), 'x');
	}
}

function dirOf(dirName: string): string {
	const d = path.join(projectsRoot, '2026', dirName);
	fs.mkdirSync(d, { recursive: true });
	return d;
}

console.log('');
console.log('=== 入口と番人のテスト ===');
setup();
try {
	// ---- 番人 ----
	console.log('--- 番人 (keeper.cmd) ---');
	{
		const runKeeper = (input: string, extra: Record<string, string> = {}): { code: number | null; log: string[] } => {
			fs.rmSync(logPath, { force: true });
			const env: Record<string, string | undefined> = {
				...process.env,
				PATH: stubDir + path.delimiter + (process.env.PATH ?? ''),
				KEEPER_EXE: 'stub-agent',
				KEEPER_FIRST: '-n "first run"',
				KEEPER_AGAIN: '-c -n "again run"',
				AGENT_LAUNCH_TEST_LOG: logPath,
				...extra,
			};
			const r = spawnSync('cmd.exe', ['/d', '/c', keeper], { encoding: 'utf8', timeout: 30000, env, input, windowsHide: true });
			// 代役の cmd の echo は、窓のコードページ (932) で書く
			const text = fs.existsSync(logPath) ? new TextDecoder('shift_jis').decode(fs.readFileSync(logPath)) : '';
			return { code: r.status, log: text.split(/\r?\n/).filter((l) => l.length > 0) };
		};
		const runs = (log: string[]): string[] => log.filter((l) => l.startsWith('run ')).map((l) => l.slice(4));
		const k1 = runKeeper('Q');
		assertEqual('番人: Q なら、1 回だけ起動して終わる (最初の引数)', ['args=-n "first run"'], runs(k1.log));
		const k2 = runKeeper('RQ');
		assertEqual('番人: R なら、続きの引数で起動し直す。次に Q で終わる', ['args=-n "first run"', 'args=-c -n "again run"'], runs(k2.log));
		const k3 = runKeeper('RRQ');
		assertEqual('番人: R を重ねれば、何回でも再起動する (2 回目以降も続きの引数)', ['args=-n "first run"', 'args=-c -n "again run"', 'args=-c -n "again run"'], runs(k3.log));
		const k4 = runKeeper('');
		assertEqual('番人: 答えが読めないとき (入力が空) は、無限に回らず、終わる', 1, runs(k4.log).length);
		const k5 = runKeeper('r');
		assertEqual('番人: 小文字の r も再起動 (そのあと入力が尽きて終わる)', 2, runs(k5.log).length);
		const k6 = runKeeper('RQ', { AGENT_LAUNCH_TEST_EXIT: '3' });
		assertEqual('番人: 終了コードがどれでも (3)、終わったあとに尋ねる', 2, runs(k6.log).length);
		assertEqual('番人: エージェントに、番人への入力 (KEEPER_*) と作業用の変数 (KP_*) を渡さない', [], k3.log.filter((l) => l.startsWith('env:')));
		const k8 = runKeeper('RQ', { KEEPER_NOASK: '1' });
		assertEqual('番人: KEEPER_NOASK があれば、尋ねずに 1 回で終わる (非表示の試験用)。その変数もエージェントに渡さない', { runs: 1, env: [] }, { runs: runs(k8.log).length, env: k8.log.filter((l) => l.startsWith('env:')) });
		const k7 = runKeeper('Q', { KEEPER_FIRST: '-n "日本語 x"' });
		assertEqual('番人: 日本語を含む引数も、そのまま渡る', true, k7.log.some((l) => l.includes('args=-n "日本語 x"') || l.includes('args=-n "\u00c0')) );
	}

	// ---- 入口 ----
	console.log('--- 入口 (main.ts) ---');
	for (const agent of ['cc', 'cx', 'ag']) {
		const cont = agent === 'cx' ? 'resume' : '-c';
		const hasCont = (a: string): boolean => (agent === 'cx' ? /(^|[ \u001f])resume($|[ \u001f])/.test(a) : /(^|[ \u001f])-c($|[ \u001f])/.test(a));

		const noName = runMain(agent, null, {}, false);
		assertEqual(agent + ': 名前なしは終了コード 2 で、[NG] を出す', { code: 2, ng: true }, { code: noName.code, ng: noName.out.includes('[NG]') });
		assertEqual(agent + ': 名前なしでは、何も起こさない', null, readRecord());

		const created = runMain(agent, 'brandnew-' + agent);
		assertEqual(agent + ': 新しいフォルダでは、' + cont + ' を付けない', false, created.rec == null ? null : hasCont(created.rec.args));
		assertEqual(agent + ': 新しいフォルダは、年のフォルダの下に <yyyymmdd>-<名前> で作られ、そこで起動する', true,
			created.rec != null && created.rec.cwd.toLowerCase().includes(path.join(projectsRoot, String(new Date().getFullYear())).toLowerCase()) && created.rec.cwd.endsWith('-brandnew-' + agent));

		dirOf('existing-' + agent);
		const noHist = runMain(agent, 'existing-' + agent);
		assertEqual(agent + ': 既存のフォルダでも、そのエージェントの履歴が無ければ、' + cont + ' を付けない (別のエージェントが先に作った場合)', false, noHist.rec == null ? null : hasCont(noHist.rec.args));
		assertEqual(agent + ': 既存のフォルダを、そのまま使う', true, noHist.rec != null && noHist.rec.cwd.toLowerCase().endsWith('existing-' + agent));

		dirOf('withhist-' + agent);
		makeHistory(agent, 'withhist-' + agent);
		const withHist = runMain(agent, 'withhist-' + agent);
		if (agent === 'cx') {
			// cx の履歴は sqlite。ここでは作らず、履歴の判定は run-agent-launch-tests.ts で確かめる
			console.log('  [--] cx: 履歴ありの確認は、履歴の判定の試験 (run-agent-launch-tests.ts) で行う');
		} else {
			assertEqual(agent + ': 履歴があれば、' + cont + ' を付ける', true, withHist.rec == null ? null : hasCont(withHist.rec.args));
		}

		assertEqual(agent + ': エージェントに、KEEPER_* ・ KP_* の変数を渡さない', [], created.rec == null ? null : created.rec.env.filter((n) => /^(KEEPER|KP_)/i.test(n)));
		if (agent === 'cc') {
			assertEqual('cc: CLAUDE で始まる変数は、USE_POWERSHELL_TOOL だけが渡る', ['CLAUDE_CODE_USE_POWERSHELL_TOOL'], created.rec == null ? null : created.rec.env.filter((n) => /^CLAUDE/i.test(n)));
		}
	}

	// ---- bin の入口: 呼んだ窓の環境変数とカレントが変わらない (80-A) ----
	console.log('--- bin の入口 (cc.cmd ・ cx.cmd ・ ag.cmd) ---');
	for (const agent of ['cc', 'cx', 'ag']) {
		const bin = path.join(root, 'bin', agent + '.cmd');
		const text = fs.readFileSync(bin, 'latin1');
		if (!text.includes('agent-launch')) {
			ng(agent + '.cmd: 新しい入口 (agent-launch) になっていない', '本物の W:\\ に作らないよう、動かさない');
			continue;
		}
		fs.rmSync(outPath, { force: true });
		const env: Record<string, string | undefined> = {
			...process.env,
			CC_ROOT: projectsRoot,
			AGENT_LAUNCH_TEST_HOME: home,
			AGENT_LAUNCH_TEST_HIDE: '1',
			AGENT_LAUNCH_TEST_OUT: outPath,
			CC_CLAUDE_JSON: path.join(work, 'claude.json'),
			PATH: stubDir + path.delimiter + (process.env.PATH ?? ''),
		};
		// この試験を動かす窓に、古い cc.cmd が残した値 (YMD ・ Y 等) が、最初からあることがある。
		// 新しい入口が足さないことだけを見るため、最初から外しておく
		for (const key of Object.keys(env)) {
			if (['YMD', 'Y', 'XMD', 'HMSC', 'XHM'].includes(key.toUpperCase()) || /^(KEEPER_|KP_)/i.test(key)) { delete env[key]; }
		}
		// cmd /c は、行に引用符が複数あると先頭と末尾の引用符を外すので、全体をもう一組の引用符で囲む。
		// cd と set は、呼んだあとの窓のカレントと環境変数を見る
		const line = '"call "' + bin + '" "viabin-' + agent + '" & cd & set"';
		const r = spawnSync('cmd.exe', ['/d', '/c', line], { encoding: 'utf8', timeout: 60000, env, cwd: work, windowsVerbatimArguments: true });
		const limit = Date.now() + 20000;
		while (!fs.existsSync(outPath) && Date.now() < limit) { sleepSync(200); }
		const lines = (r.stdout ?? '').split(/\r?\n/);
		const names = lines.filter((l) => /^[A-Za-z_][A-Za-z0-9_]*=/.test(l)).map((l) => l.slice(0, l.indexOf('=')).toUpperCase());
		assertEqual(agent + '.cmd: 起動できる (代役の記録が出る)', true, fs.existsSync(outPath));
		assertEqual(agent + '.cmd: 呼んだあとの窓のカレントは変わらない', true, lines.some((l) => l.trim().toLowerCase() === work.toLowerCase()));
		assertEqual(agent + '.cmd: 作業用の環境変数 (YMD ・ Y ・ XMD ・ HMSC ・ XHM) を窓に残さない', [], ['YMD', 'Y', 'XMD', 'HMSC', 'XHM'].filter((n) => names.includes(n)));
		assertEqual(agent + '.cmd: 番人用の環境変数 (KEEPER_* ・ KP_*) を窓に残さない', [], names.filter((n) => n.startsWith('KEEPER_') || n.startsWith('KP_')));
	}

	// ---- 窓のタイトル ----
	console.log('--- 窓のタイトルは、start の行を作る関数の試験 (run-agent-launch-tests.ts) で確かめる。窓を見せる確認は、利用者の手元で ---');
} finally {
	// 非表示の番人が、まだ終わりきっていないことがある (そのフォルダを使っている間は消せない)。終わるのを待って、やり直す
	for (let i = 0; i < 30; i++) {
		try { fs.rmSync(work, { recursive: true, force: true }); break; } catch { sleepSync(500); }
	}
}

console.log('');
if (fail === 0) {
	console.log('=== ' + pass + ' 件すべて成功 ===');
	process.exit(0);
} else {
	console.log('=== ' + fail + ' 件失敗（成功 ' + pass + ' 件）===');
	process.exit(1);
}
