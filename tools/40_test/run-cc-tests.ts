/*
	cc.cmd のテスト。

	cc.cmd は W:\ の下にプロジェクトを作って claude.exe を起こす。試験では、
	  ・置き場を環境変数 CC_ROOT で tmp/ の下へ差し替える
	  ・~/.claude.json を環境変数 CC_CLAUDE_JSON で tmp/ の複製に向ける
	  ・claude.exe を、引数・カレント・CLAUDE で始まる環境変数を記録するだけの代役に差し替える
	  （PATH の先頭に置く。rustc で作る）
	本物の W:\ ・ 本物の ~/.claude.json ・ 本物の claude は触らない。

	決め（利用者の判断。2026-10-28）:
	  ・claude を起こす前に、CLAUDE で始まる環境変数を、CLAUDE_CODE_USE_POWERSHELL_TOOL 以外すべて消す
	  ・起こす前に、プロジェクトのフォルダを ~/.claude.json に登録する（新しいフォルダも、既存のフォルダも）
	  ・登録に失敗しても起動する（cc-register が飛ばす）
	  ・消すのは起動する側だけ。cc.cmd を動かした窓の環境変数は変えない
*/

import { spawnSync } from 'node:child_process';
import * as path from 'node:path';
import * as fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..', '..');
const cc = path.join(root, 'bin', 'cc.cmd');
const work = path.join(root, 'tmp', 'cc-test');
const projectsRoot = path.join(work, 'root') + path.sep;
const stubDir = path.join(work, 'stub');
const jsonPath = path.join(work, 'claude.json');
const outPath = path.join(work, 'stub-out.txt');

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

const stubSource = `
use std::io::Write;
fn main() {
	let out = std::env::var("CC_STUB_OUT").unwrap_or_default();
	if out.is_empty() { return; }
	let mut s = String::new();
	s.push_str(&format!("cwd={}\\n", std::env::current_dir().unwrap().display()));
	let args: Vec<String> = std::env::args().skip(1).collect();
	s.push_str(&format!("args={}\\n", args.join("\\u{1f}")));
	for (k, v) in std::env::vars() {
		if k.to_uppercase().starts_with("CLAUDE") { s.push_str(&format!("env:{}={}\\n", k, v)); }
	}
	let tmp = format!("{}.tmp", out);
	std::fs::File::create(&tmp).unwrap().write_all(s.as_bytes()).unwrap();
	std::fs::rename(&tmp, &out).unwrap();
}
`;

function setup(): void {
	fs.rmSync(work, { recursive: true, force: true });
	fs.mkdirSync(projectsRoot, { recursive: true });
	fs.mkdirSync(stubDir, { recursive: true });
	const src = path.join(work, 'claude-stub.rs');
	fs.writeFileSync(src, stubSource);
	const r = spawnSync('rustc', [src, '-o', path.join(stubDir, 'claude.exe')], { encoding: 'utf8' });
	if (r.status !== 0) {
		console.log('[NG] 代役の claude.exe を作れません: ' + (r.stderr ?? ''));
		process.exit(2);
	}
	fs.writeFileSync(jsonPath, JSON.stringify({ projects: {} }, null, 2));
}

function cleanup(): void {
	fs.rmSync(work, { recursive: true, force: true });
}

/** cc.cmd を動かし、代役の claude が書いた記録を返す（start は待たないので、出るまで待つ） */
function runCc(args: string[], after = ''): { code: number | null; out: string; stub: { cwd: string; args: string[]; env: Record<string, string> } | null } {
	fs.rmSync(outPath, { force: true });
	const env: Record<string, string | undefined> = {
		...process.env,
		CC_ROOT: projectsRoot,
		CC_CLAUDE_JSON: jsonPath,
		CC_STUB_OUT: outPath,
		PATH: stubDir + path.delimiter + (process.env.PATH ?? ''),
		CLAUDECODE: '1',
		CLAUDE_CODE_SESSION_ID: 'session-x',
		CLAUDE_CODE_MESSAGING_TOKEN: 'token-x',
		CLAUDE_CODE_USE_POWERSHELL_TOOL: '1',
		CLAUDE_OTHER: 'x',
	};
	// cmd /c は、行に引用符が複数あると先頭と末尾の引用符を外すので、全体をもう一組の引用符で囲む
	const inner = '"' + cc + '" ' + args.map((a) => '"' + a + '"').join(' ') + (after.length > 0 ? ' & ' + after : '');
	const line = '"' + inner + '"';
	const r = spawnSync('cmd.exe', ['/d', '/c', line], { encoding: 'utf8', timeout: 60000, env, cwd: work, windowsVerbatimArguments: true });
	const limit = Date.now() + 20000;
	while (!fs.existsSync(outPath) && Date.now() < limit) {
		spawnSync(process.execPath, ['-e', 'setTimeout(()=>{},200)']);
	}
	if (!fs.existsSync(outPath)) {
		// 原因を追えるよう、cc.cmd の出力を残す
		console.log('    cc.cmd の終了コード ' + r.status + ' / 標準出力: ' + JSON.stringify(r.stdout ?? '') + ' / 標準エラー: ' + JSON.stringify(r.stderr ?? ''));
		return { code: r.status, out: r.stdout ?? '', stub: null };
	}
	const lines = fs.readFileSync(outPath, 'utf8').split('\n').filter((l) => l.length > 0);
	const stub = { cwd: '', args: [] as string[], env: {} as Record<string, string> };
	for (const l of lines) {
		if (l.startsWith('cwd=')) { stub.cwd = l.slice(4); }
		else if (l.startsWith('args=')) { stub.args = l.slice(5).split('\u001f'); }
		else if (l.startsWith('env:')) { const i = l.indexOf('='); stub.env[l.slice(4, i)] = l.slice(i + 1); }
	}
	return { code: r.status, out: r.stdout ?? '', stub };
}

function keyOf(dir: string): string {
	return dir.split('\\').join('/');
}

function main(): void {
	// 置き場を差し替えられない cc.cmd は、本物の W:\ にフォルダを作ってしまうので、試験を回さない
	if (!fs.readFileSync(cc, 'latin1').includes('CC_ROOT')) {
		console.log('[NG] cc.cmd が CC_ROOT に対応していません。本物の W:\\ に作らないよう、試験を回しません');
		process.exit(1);
	}
	setup();
	try {
		console.log('=== cc.cmd のテスト ===');

		const year = String(new Date().getFullYear());

		// 既存のプロジェクト（置き場の直下）
		const existing = path.join(projectsRoot, 'existing-proj');
		fs.mkdirSync(existing);
		const e1 = runCc(['existing'], 'set CLAUDECODE');
		if (e1.stub === null) {
			ng('既存: claude が起動された', '代役の記録が出ません');
		} else {
			assertEqual('既存: -c で続きから開く', ['-c', '-n'], e1.stub.args.slice(0, 2));
			assertEqual('既存: プロジェクトのフォルダで起動する', existing.toLowerCase(), e1.stub.cwd.toLowerCase());
			assertEqual('既存: CLAUDE_CODE_USE_POWERSHELL_TOOL は残る', '1', e1.stub.env['CLAUDE_CODE_USE_POWERSHELL_TOOL']);
			assertEqual('既存: ほかの CLAUDE で始まる環境変数は消える', ['CLAUDE_CODE_USE_POWERSHELL_TOOL'], Object.keys(e1.stub.env));
			assertEqual('既存: 呼び元の窓の環境変数は変わらない（cc のあとでも CLAUDECODE が残る）', true, e1.out.includes('CLAUDECODE=1'));
			assertEqual('既存: ~/.claude.json に登録される', true, keyOf(existing) in JSON.parse(fs.readFileSync(jsonPath, 'utf8')).projects);
		}

		// 新しいプロジェクト（年のフォルダの下に作る）
		const n1 = runCc(['brandnew']);
		if (n1.stub === null) {
			ng('新規: claude が起動された', '代役の記録が出ません');
		} else {
			assertEqual('新規: -c を付けずに開く', '-n', n1.stub.args[0]);
			assertEqual('新規: 年のフォルダの下に作ったフォルダで起動する', true,
				n1.stub.cwd.toLowerCase().startsWith(path.join(projectsRoot, year).toLowerCase() + path.sep) && n1.stub.cwd.endsWith('-brandnew'));
			assertEqual('新規: 作ったフォルダが実在する', true, fs.existsSync(n1.stub.cwd));
			assertEqual('新規: CLAUDE で始まる環境変数は USE_POWERSHELL_TOOL だけ', ['CLAUDE_CODE_USE_POWERSHELL_TOOL'], Object.keys(n1.stub.env));
			assertEqual('新規: ~/.claude.json に登録される', true, keyOf(n1.stub.cwd) in JSON.parse(fs.readFileSync(jsonPath, 'utf8')).projects);
		}

		// 登録に失敗しても起動する
		fs.writeFileSync(jsonPath, '{ broken');
		const b1 = runCc(['existing']);
		assertEqual('登録に失敗（JSON が壊れている）しても起動する', true, b1.stub !== null);
		assertEqual('登録に失敗しても壊れた JSON は書き換えない', '{ broken', fs.readFileSync(jsonPath, 'utf8'));
	} finally {
		cleanup();
	}

	console.log('');
	console.log(`合格 ${pass} / 不合格 ${fail}`);
	process.exit(fail === 0 ? 0 : 1);
}

main();
