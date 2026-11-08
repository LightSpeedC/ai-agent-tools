/*
	issue (課題管理ツール) の決定の記録のテスト: decide new ・ list ・ show と、check の decisions/ の検査。
	計画は p261108-01、仕様は notes/50_spec/課題ファイルの形と検査.html。

	期待値は、計画から先に手で書いた (実装の出力から作っていない)。
	本物のプロジェクトには触らない。tmp/ の下に、ケースごとの小さなプロジェクトを作る。
	日付は、環境変数 ISSUE_TEST_TODAY で固定する。
*/
import fs from 'node:fs';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..', '..');
const work = path.join(root, 'tmp', 'issue-decide-tests');
const main = path.join(root, 'src', 'issue', 'main.ts');

let pass = 0;
let fail = 0;
function check(name: string, ok: boolean, detail: string = ''): void {
	if (ok) { pass++; console.log('  ✅ [OK] ' + name); }
	else { fail++; console.log('  ❌ [NG] ' + name + (detail ? '  ' + detail : '')); }
}

// ---- 材料 ----

const ProjectIdText = 'schema: 1\nproject_id: 7b0c4e1a9f3d4a62b8d51c2e6f90a3b7\n';
const Items = 'notes/40_issues/items/';
const Decisions = 'notes/40_issues/decisions/';
const Today = '2026-11-08';

function issueText(id: string): string {
	return `---\nschema: 1\nid: ${id}\ntitle: 題\ngroup: g\ncreated: 2026-11-03\n---\n\n本文\n`;
}

function decisionText(over: Record<string, string | null> = {}, body: string = '\n## 案\n\n- A: 一つ目\n- B: 二つ目\n'): string {
	const base: Record<string, string | null> = {
		schema: '1', id: 'i261103-01-d1', title: '問い', parent: 'i261103-01', decided: '2026-11-08', chosen: 'A',
	};
	const all = { ...base, ...over };
	const lines = Object.keys(all).filter((k) => all[k] !== null).map((k) => k + ': ' + all[k]);
	return '---\n' + lines.join('\n') + '\n---\n' + body;
}

function mkProject(name: string, files: Record<string, string>): string {
	const dir = path.join(work, name);
	fs.rmSync(dir, { recursive: true, force: true });
	fs.mkdirSync(dir, { recursive: true });
	const all: Record<string, string> = { [Items + 'project-id.txt']: ProjectIdText, [Items + 'todo/i261103-01-題.md']: issueText('i261103-01'), ...files };
	for (const [rel, text] of Object.entries(all)) {
		const full = path.join(dir, rel);
		fs.mkdirSync(path.dirname(full), { recursive: true });
		fs.writeFileSync(full, text);
	}
	return dir;
}

type Result = { code: number; out: string; err: string };

function envOf(): Record<string, string> {
	return { ...process.env, ISSUE_TEST_TODAY: Today } as Record<string, string>;
}

function run(args: string[], cwd: string): Result {
	const r = spawnSync(process.execPath, [main, ...args], { cwd, env: envOf(), encoding: 'utf8', timeout: 60000 });
	return { code: r.status ?? -1, out: (r.stdout ?? '').trim(), err: (r.stderr ?? '').trim() };
}

function runAsync(args: string[], cwd: string): Promise<Result> {
	return new Promise((resolve) => {
		const child = spawn(process.execPath, [main, ...args], { cwd, env: envOf() });
		let out = '';
		let err = '';
		child.stdout.on('data', (d) => { out += String(d); });
		child.stderr.on('data', (d) => { err += String(d); });
		child.on('close', (code) => resolve({ code: code ?? -1, out: out.trim(), err: err.trim() }));
	});
}

function decide(dir: string, args: string[]): Result {
	return run(['decide', ...args, '--root', dir], dir);
}

function listDir(dir: string, rel: string): string[] {
	try { return fs.readdirSync(path.join(dir, rel)).sort(); } catch { return []; }
}

function read(dir: string, rel: string): string {
	try { return fs.readFileSync(path.join(dir, rel), 'utf8'); } catch { return ''; }
}

function parseJson(text: string): any {
	try { return JSON.parse(text); } catch { return null; }
}

const Basic = ['new', '--parent', 'i261103-01', '--title', '進める順', '--option', '先に作る', '--option', '順に進める', '--chosen', 'A'];

async function mainTests(): Promise<void> {
	// ---- new ----
	console.log('--- decide new');
	{
		const dir = mkProject('new-basic', {});
		const r = decide(dir, Basic);
		const names = listDir(dir, Decisions);
		check('new は decisions/ に <親>-d1-<件名>.md を作る', r.code === 0 && names.length === 1 && names[0] === 'i261103-01-d1-進める順.md', JSON.stringify(names) + ' ' + r.out + r.err);
		const expected = '---\nschema: 1\nid: i261103-01-d1\ntitle: 進める順\nparent: i261103-01\ndecided: 2026-11-08\nchosen: A\n---\n\n## 案\n\n- A: 先に作る\n- B: 順に進める\n';
		const text = read(dir, Decisions + (names[0] ?? ''));
		check('new の中身は、キーの順と案の行が決まりどおり', text === expected, JSON.stringify(text));
		check('new の出力は相対パスと id', r.out.includes('notes/40_issues/decisions/i261103-01-d1-進める順.md') && r.out.includes('i261103-01-d1') && !r.out.includes(work), r.out);

		const r2 = decide(dir, ['new', '--parent', 'i261103-01', '--title', '二つ目', '--option', 'x', '--option', 'y', '--option', 'z', '--chosen', 'C', '--refs', 'p261108-01', '--replaces', 'i261103-01-d1', '--legacy', ':ai-agent-tools:171-A', '--json']);
		const j = parseJson(r2.out);
		check('同じ親の 2 つ目は d2。--json で id と file', r2.code === 0 && j !== null && j.id === 'i261103-01-d2' && j.file === 'notes/40_issues/decisions/i261103-01-d2-二つ目.md', r2.out + r2.err);
		const t2 = read(dir, Decisions + 'i261103-01-d2-二つ目.md');
		check('任意のキーは refs ・ replaces ・ legacy_ids の順', t2.includes('chosen: C\nrefs: p261108-01\nreplaces: i261103-01-d1\nlegacy_ids: :ai-agent-tools:171-A\n---'), JSON.stringify(t2));
		check('案は A ・ B ・ C と振る', t2.includes('- A: x\n- B: y\n- C: z\n'), JSON.stringify(t2));
	}
	{
		const dir = mkProject('new-gap', { [Decisions + 'i261103-01-d9-古い.md']: decisionText({ id: 'i261103-01-d9' }) });
		const r = decide(dir, Basic);
		check('連番は親の決定の最大 + 1 (d9 の次は d10)', r.code === 0 && listDir(dir, Decisions).includes('i261103-01-d10-進める順.md'), r.out + r.err);
	}
	{
		const dir = mkProject('new-parent-plan', {});
		const r = decide(dir, ['new', '--parent', 'p261108-01', '--title', '計画の決定', '--option', 'a', '--option', 'b', '--chosen', 'B']);
		check('親に計画の番号 (p) を使える', r.code === 0 && listDir(dir, Decisions).includes('p261108-01-d1-計画の決定.md'), r.out + r.err);
	}
	{
		const dir = mkProject('new-bad', {});
		const cases: [string, string[]][] = [
			['--chosen が案の字に無い', ['new', '--parent', 'i261103-01', '--title', 't', '--option', 'a', '--option', 'b', '--chosen', 'C']],
			['--option が無い', ['new', '--parent', 'i261103-01', '--title', 't', '--chosen', 'A']],
			['--parent の形が違う', ['new', '--parent', 'x261103-01', '--title', 't', '--option', 'a', '--chosen', 'A']],
			['--title が無い', ['new', '--parent', 'i261103-01', '--option', 'a', '--chosen', 'A']],
			['--chosen が無い', ['new', '--parent', 'i261103-01', '--title', 't', '--option', 'a']],
			['--legacy の形が違う', ['new', '--parent', 'i261103-01', '--title', 't', '--option', 'a', '--chosen', 'A', '--legacy', '171-A']],
		];
		for (const [name, args] of cases) {
			const r = decide(dir, args);
			check(name + ' は終了コード 5 で、何も作らない', r.code === 5 && listDir(dir, Decisions).length === 0, `code=${r.code} ` + r.err);
		}
	}
	{
		const dir = mkProject('new-concurrent', {});
		const results = await Promise.all([0, 1, 2, 3].map(() => runAsync(['decide', ...Basic, '--root', dir], dir)));
		const names = listDir(dir, Decisions);
		check('同時に 4 つ足しても、d1〜d4 が重ならずに並ぶ', results.every((r) => r.code === 0) && names.length === 4 && [1, 2, 3, 4].every((n) => names.includes(`i261103-01-d${n}-進める順.md`)), JSON.stringify(names));
	}

	// ---- list ・ show ----
	console.log('--- decide list ・ show');
	{
		const dir = mkProject('list', {
			[Decisions + 'i261103-01-d10-十.md']: decisionText({ id: 'i261103-01-d10', title: '十' }),
			[Decisions + 'i261103-01-d2-二.md']: decisionText({ id: 'i261103-01-d2', title: '二', chosen: 'B' }),
			[Decisions + 'p261108-01-d1-計画.md']: decisionText({ id: 'p261108-01-d1', parent: 'p261108-01', title: '計画' }),
		});
		const r = decide(dir, ['list', '--json']);
		const j = parseJson(r.out);
		const ids = Array.isArray(j) ? j.map((x: any) => x.id) : [];
		check('list は親の番号 → 連番の数の順 (d2 が d10 より前)', r.code === 0 && JSON.stringify(ids) === JSON.stringify(['i261103-01-d2', 'i261103-01-d10', 'p261108-01-d1']), r.out + r.err);
		const r2 = decide(dir, ['list', '--parent', 'p261108-01', '--json']);
		const j2 = parseJson(r2.out);
		check('list --parent で絞る', Array.isArray(j2) && j2.length === 1 && j2[0].id === 'p261108-01-d1', r2.out);
		const r3 = decide(dir, ['list']);
		check('list の文字の出力は、id ・ 選んだ案 ・ 問いと件数', r3.out.includes('i261103-01-d2') && r3.out.includes('二') && r3.out.includes('3 件'), r3.out);

		const s = decide(dir, ['show', 'i261103-01-d2', '--json']);
		const sj = parseJson(s.out);
		check('show --json はメタ情報と案の一覧', s.code === 0 && sj !== null && sj.id === 'i261103-01-d2' && sj.meta.chosen === 'B'
			&& JSON.stringify(sj.options) === JSON.stringify([{ key: 'A', text: '一つ目' }, { key: 'B', text: '二つ目' }]), s.out + s.err);
		const s2 = decide(dir, ['show', 'i261103-01-d7']);
		check('無い id の show は終了コード 1', s2.code === 1, `code=${s2.code} ` + s2.err);
		const s3 = decide(dir, ['show', 'i261103-01']);
		check('決定の id の形でない show は終了コード 5', s3.code === 5, `code=${s3.code}`);
	}

	// ---- check ----
	console.log('--- check の decisions/');
	{
		const dir = mkProject('check-ok', { [Decisions + 'i261103-01-d1-問い.md']: decisionText() });
		const r = run(['check', '--root', dir, '--json'], dir);
		const j = parseJson(r.out);
		check('正しい決定は、エラーも警告も無く、件数に数える', r.code === 0 && j !== null && j.findings.length === 0 && j.decisions === 1, r.out + r.err);
	}
	{
		const dir = mkProject('check-none', {});
		const r = run(['check', '--root', dir, '--json'], dir);
		const j = parseJson(r.out);
		check('decisions/ が無くても問題にしない (0 件)', r.code === 0 && j !== null && j.findings.length === 0 && j.decisions === 0, r.out + r.err);
	}
	type Bad = { name: string; files: Record<string, string>; level: 'error' | 'warning'; code: string };
	const bads: Bad[] = [
		{ name: 'ファイル名の形が違う', files: { [Decisions + 'i261103-01-問い.md']: decisionText() }, level: 'error', code: 'name' },
		{ name: '必須の chosen が無い', files: { [Decisions + 'i261103-01-d1-問い.md']: decisionText({ chosen: null }) }, level: 'error', code: 'key' },
		{ name: 'id が名前の先頭と違う', files: { [Decisions + 'i261103-01-d1-問い.md']: decisionText({ id: 'i261103-01-d2' }) }, level: 'error', code: 'value' },
		{ name: 'parent が id と食い違う', files: { [Decisions + 'i261103-01-d1-問い.md']: decisionText({ parent: 'i261103-02' }) }, level: 'error', code: 'value' },
		{ name: 'decided が実在しない日', files: { [Decisions + 'i261103-01-d1-問い.md']: decisionText({ decided: '2026-02-30' }) }, level: 'error', code: 'value' },
		{ name: 'chosen の案が本文に無い', files: { [Decisions + 'i261103-01-d1-問い.md']: decisionText({ chosen: 'C' }) }, level: 'error', code: 'chosen' },
		{ name: '同じ id のファイルが 2 つ', files: { [Decisions + 'i261103-01-d1-問い.md']: decisionText(), [Decisions + 'i261103-01-d1-別.md']: decisionText() }, level: 'error', code: 'duplicate' },
		{ name: 'BOM がある', files: { [Decisions + 'i261103-01-d1-問い.md']: '﻿' + decisionText() }, level: 'error', code: 'encoding' },
		{ name: '下のフォルダに置いた', files: { [Decisions + 'sub/i261103-01-d1-問い.md']: decisionText() }, level: 'error', code: 'place' },
		{ name: '親が見つからない', files: { [Decisions + 'i261103-09-d1-問い.md']: decisionText({ id: 'i261103-09-d1', parent: 'i261103-09' }) }, level: 'warning', code: 'refs' },
		{ name: 'replaces の先が見つからない', files: { [Decisions + 'i261103-01-d1-問い.md']: decisionText({ replaces: 'i261103-01-d5' }) }, level: 'warning', code: 'refs' },
		{ name: '知らないキー', files: { [Decisions + 'i261103-01-d1-問い.md']: decisionText({ state: '済' }) }, level: 'warning', code: 'unknown-key' },
	];
	for (const b of bads) {
		const dir = mkProject('check-' + b.code + '-' + bads.indexOf(b), b.files);
		const r = run(['check', '--root', dir, '--json'], dir);
		const j = parseJson(r.out);
		const hit = j !== null && j.findings.some((f: any) => f.level === b.level && f.code === b.code && String(f.file).startsWith('notes/40_issues/decisions/'));
		const codeOk = b.level === 'error' ? r.code === 1 : r.code === 0;
		check(`${b.name} は ${b.level === 'error' ? 'エラー' : '警告'} (${b.code})`, hit && codeOk, `code=${r.code} ` + r.out);
	}
	{
		const dir = mkProject('check-other-project', { [Decisions + 'i261103-01-d1-問い.md']: decisionText({ refs: ':ai-agent-manager:i260924-02', replaces: ':ai-agent-manager:i260924-02-d1' }) });
		const r = run(['check', '--root', dir, '--json'], dir);
		const j = parseJson(r.out);
		check('別プロジェクトの参照は検査しない', r.code === 0 && j !== null && j.findings.length === 0, r.out);
	}
}

await mainTests();
console.log('');
console.log(`=== issue (決定): ${pass} 件成功 ・ ${fail} 件失敗 ===`);
fs.rmSync(work, { recursive: true, force: true });
process.exit(fail === 0 ? 0 : 1);
