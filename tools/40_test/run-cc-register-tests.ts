/*
	cc-register のテスト。cc.cmd が起動の前に、プロジェクトのフォルダを ~/.claude.json の
	projects に足すための道具（src/cc-register/main.ts）。

	本物の ~/.claude.json は触らない。環境変数 CC_CLAUDE_JSON で、tmp/ の複製に向ける。
	bun でも node でも走る。

	決め（利用者の判断。2026-10-28）:
	  ・キーは W:/… の形（区切りは /）。信頼の確認を済みにした最小の項目を足す
	  ・登録済みなら何もしない（ファイルを書き直さない）
	  ・失敗（ファイルが無い・壊れている）は登録を飛ばして終了コード 0。飛ばしたことを 1 行出す
*/

import { spawnSync } from 'node:child_process';
import * as path from 'node:path';
import * as fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..', '..');
const tool = path.join(root, 'src', 'cc-register', 'main.ts');
const work = path.join(root, 'tmp', 'cc-register-test');
const jsonPath = path.join(work, 'claude.json');

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

function run(args: string[]): { code: number | null; out: string; err: string } {
	const env = { ...process.env, CC_CLAUDE_JSON: jsonPath };
	const r = spawnSync(process.execPath, [tool, ...args], { encoding: 'utf8', timeout: 30000, env });
	return { code: r.status, out: r.stdout ?? '', err: r.stderr ?? '' };
}

/** 登録済みの項目（ふだんの ~/.claude.json にある、信頼済みの最小の形） */
const existingEntry = {
	allowedTools: [],
	mcpContextUris: [],
	mcpServers: {},
	enabledMcpjsonServers: [],
	disabledMcpjsonServers: [],
	hasTrustDialogAccepted: true,
	hasClaudeMdExternalIncludesApproved: false,
	hasClaudeMdExternalIncludesWarningShown: false,
};

function writeJson(value: unknown): void {
	fs.writeFileSync(jsonPath, JSON.stringify(value, null, 2) + '\n');
}

function readJson(): any {
	return JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
}

function setup(): void {
	fs.rmSync(work, { recursive: true, force: true });
	fs.mkdirSync(work, { recursive: true });
}

setup();
try {
	console.log('=== cc-register のテスト ===');

	// 未登録なら足す
	writeJson({ other: { keep: [1, 2, 3] }, projects: { 'W:/a': existingEntry } });
	const r1 = run(['W:\\2026\\20261028-new']);
	assertEqual('未登録なら終了コード 0', 0, r1.code);
	const j1 = readJson();
	assertEqual('キーは W:/… の形（\\ を / にする）', true, 'W:/2026/20261028-new' in j1.projects);
	assertEqual('足した項目は、信頼済みの最小の形', existingEntry, j1.projects['W:/2026/20261028-new']);
	assertEqual('ほかのプロジェクトは変わらない', existingEntry, j1.projects['W:/a']);
	assertEqual('プロジェクト以外の項目も変わらない', { keep: [1, 2, 3] }, j1.other);
	assertEqual('登録したことを 1 行出す', true, r1.out.trim().split('\n').length === 1 && r1.out.includes('W:/2026/20261028-new'));

	// 2 回目は何もしない（冪等）
	const before = fs.readFileSync(jsonPath, 'utf8');
	const stat1 = fs.statSync(jsonPath).mtimeMs;
	const r2 = run(['W:\\2026\\20261028-new']);
	assertEqual('登録済みなら終了コード 0', 0, r2.code);
	assertEqual('登録済みならファイルを書き直さない（中身）', before, fs.readFileSync(jsonPath, 'utf8'));
	assertEqual('登録済みならファイルを書き直さない（更新日時）', stat1, fs.statSync(jsonPath).mtimeMs);
	assertEqual('登録済みなら何も出さない', '', r2.out.trim());

	// 末尾の区切り・/ 区切りの入力でも、同じキーになる
	const r3 = run(['W:/2026/20261028-new/']);
	assertEqual('末尾の / があっても同じキー（登録済みと判定）', '', r3.out.trim());
	assertEqual('末尾の / があってもキーが増えない', 2, Object.keys(readJson().projects).length);

	// 登録済みのキーの中身（信頼を断った人の選択）は書き換えない
	writeJson({ projects: { 'W:/x': { ...existingEntry, hasTrustDialogAccepted: false } } });
	run(['W:\\x']);
	assertEqual('登録済みの項目は、信頼が false でも書き換えない', false, readJson().projects['W:/x'].hasTrustDialogAccepted);

	// 失敗は飛ばす
	fs.writeFileSync(jsonPath, '{ broken');
	const r4 = run(['W:\\y']);
	assertEqual('壊れた JSON は終了コード 0', 0, r4.code);
	assertEqual('壊れた JSON は書き換えない', '{ broken', fs.readFileSync(jsonPath, 'utf8'));
	assertEqual('壊れた JSON は飛ばしたことを 1 行出す', true, r4.out.trim().split('\n').length === 1 && r4.out.includes('飛ばし'));

	fs.rmSync(jsonPath);
	const r5 = run(['W:\\y']);
	assertEqual('ファイルが無ければ終了コード 0', 0, r5.code);
	assertEqual('ファイルが無ければ作らない', false, fs.existsSync(jsonPath));
	assertEqual('ファイルが無ければ飛ばしたことを 1 行出す', true, r5.out.trim().split('\n').length === 1 && r5.out.includes('飛ばし'));

	writeJson({ other: 1 });
	run(['W:\\z']);
	assertEqual('projects が無ければ作って足す', true, 'W:/z' in (readJson().projects ?? {}));

	const r6 = run([]);
	assertEqual('引数が無ければ 2', 2, r6.code);
} finally {
	fs.rmSync(work, { recursive: true, force: true });
}

console.log('');
console.log(`合格 ${pass} / 不合格 ${fail}`);
process.exit(fail === 0 ? 0 : 1);
