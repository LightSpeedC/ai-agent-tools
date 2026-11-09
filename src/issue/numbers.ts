/*
	番号の予約の共有 (計画 p261109-01)。
	課題 ・ 決定 ・ 選択肢の番号の予約を、ホームの下の 1 か所 (~/.ai-agent-tools/numbers/<キー>/) に置く (202-A)。
	同じ PC の同じユーザなら、worktree でも別の clone でも番号が重ならない。

	- キーは、GitHub のリモートがあれば github_<所有者>_<名前> (203-A)、無ければ uuid_<project_uuid> (207-A)
	- 予約は mkdir で取り、書き終えても残す。予約するついでに、3 日より前の予約を消す。系列ごとの最大の 1 つは残す (205-A)
	- project-uuid.txt (schema 2) を読む。古い project-id.txt (schema 1) も読む (207-A ・ 208-A)

	このファイルは check.ts を import しない (check.ts から使うため)。
*/
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const ItemsDirRel = ['notes', '40_issues', 'items'];
const DecisionsDirRel = ['notes', '40_issues', 'decisions'];
export const UuidFileName = 'project-uuid.txt';
export const OldIdFileName = 'project-id.txt';
/** 予約を残す長さ (205-A) */
const KeepMs = 3 * 24 * 3600 * 1000;

// ---- project-uuid.txt ----

export type ProjectFile = { kind: 'uuid' | 'old'; uuid: string | null; projectId: string | null };

/** project-uuid.txt を読む。無ければ古い project-id.txt を読む。どちらも無ければ null */
export function readProjectFile(root: string): ProjectFile | null {
	const dir = path.join(root, ...ItemsDirRel);
	const get = (text: string, key: string): string | null => new RegExp(`^${key}:[ \\t]*(\\S+)[ \\t]*$`, 'm').exec(text.replace(/\r/g, ''))?.[1] ?? null;
	try {
		const text = fs.readFileSync(path.join(dir, UuidFileName), 'utf8');
		return { kind: 'uuid', uuid: get(text, 'project_uuid'), projectId: get(text, 'project_id') };
	} catch {
		// 無ければ古いほうを見る
	}
	try {
		const text = fs.readFileSync(path.join(dir, OldIdFileName), 'utf8');
		return { kind: 'old', uuid: get(text, 'project_id'), projectId: null };
	} catch {
		return null;
	}
}

export function uuidFileText(uuid: string, projectId: string): string {
	return `schema: 2\nproject_uuid: ${uuid}\nproject_id: ${projectId}\n`;
}

// ---- git ----

function gitOut(root: string, args: string[]): string | null {
	const r = spawnSync('git', ['-C', root, ...args], { encoding: 'utf8', timeout: 15000 });
	if (r.error !== undefined || r.status !== 0) return null;
	return (r.stdout ?? '').trim();
}

function samePath(a: string, b: string): boolean {
	const norm = (p: string): string => {
		let real = p;
		try { real = fs.realpathSync.native(p); } catch { /* 無ければそのまま */ }
		return path.resolve(real).toLowerCase();
	};
	return norm(a) === norm(b);
}

/** root が git の作業フォルダの根なら、その git の共通ディレクトリ (worktree でも元の .git)。違えば null */
function commonGitDir(root: string): string | null {
	const top = gitOut(root, ['rev-parse', '--show-toplevel']);
	if (top === null || !samePath(top, root)) return null;
	const common = gitOut(root, ['rev-parse', '--git-common-dir']);
	return common === null ? null : path.resolve(root, common);
}

/** プロジェクトの id (208-A): 元の作業フォルダの名前。worktree から呼んでも、worktree のフォルダ名にしない */
export function mainFolderName(root: string): string {
	const common = commonGitDir(root);
	if (common !== null && path.basename(common).toLowerCase() === '.git') return path.basename(path.dirname(common));
	return path.basename(path.resolve(root));
}

/** GitHub のリモート (origin) の 所有者 と 名前。無ければ null (203-A) */
export function githubRepoOf(root: string): { owner: string; name: string } | null {
	if (commonGitDir(root) === null) return null;
	const url = gitOut(root, ['remote', 'get-url', 'origin']);
	if (url === null) return null;
	const m = /github\.com[/:]([^/\s]+)\/([^/\s]+?)(?:\.git)?\/?$/i.exec(url);
	return m === null ? null : { owner: m[1], name: m[2] };
}

// ---- 予約の場所 ----

/** 予約の置き場の根。環境変数で差し替えられる。試験 (ISSUE_TEST_TODAY がある) で指定が無ければ、プロジェクトの _numbers/ (本物のホームを汚さない) */
function numbersRoot(root: string): string {
	const env = process.env.AI_AGENT_TOOLS_NUMBERS_DIR;
	if (env !== undefined && env !== '') return path.resolve(env);
	if (process.env.ISSUE_TEST_TODAY !== undefined) return path.join(root, '_numbers');
	return path.join(os.homedir(), '.ai-agent-tools', 'numbers');
}

/**
 * プロジェクトの予約の置き場 (<根>/<キー>/) を返し、無ければ作る。
 * GitHub のリモートも project_uuid も無ければ、キーを決められないので null
 */
export function numbersBaseOf(root: string): string | null {
	const repo = githubRepoOf(root);
	const file = readProjectFile(root);
	const projectId = file?.projectId ?? mainFolderName(root);
	let key: string;
	if (repo !== null) key = `github_${repo.owner}_${repo.name}`;
	else if (file?.uuid) key = `uuid_${file.uuid}`;
	else return null;
	const base = path.join(numbersRoot(root), key);
	fs.mkdirSync(path.join(base, 'ids'), { recursive: true });
	fs.mkdirSync(path.join(base, 'choices'), { recursive: true });
	const keyFile = path.join(base, 'key.json');
	if (!fs.existsSync(keyFile)) {
		const info = { schema: 1, key, repo: repo === null ? null : `${repo.owner}/${repo.name}`, project_uuid: file?.uuid ?? null, project_id: projectId };
		try { fs.writeFileSync(keyFile, JSON.stringify(info, null, '\t') + '\n', { flag: 'wx' }); } catch { /* 同時に作られた */ }
	}
	return base;
}

/** 予約を取る (mkdir は既にあれば失敗するので排他になる)。取れたら info.json を置く */
export function reserve(base: string, kind: 'ids' | 'choices', name: string, info: Record<string, unknown>): boolean {
	const dir = path.join(base, kind, name);
	try {
		fs.mkdirSync(dir);
	} catch (e) {
		if ((e as NodeJS.ErrnoException).code === 'EEXIST') return false;
		throw e;
	}
	const body = { id: name, reserved: new Date().toISOString(), from: process.cwd(), ...info };
	fs.writeFileSync(path.join(dir, 'info.json'), JSON.stringify(body, null, '\t') + '\n');
	return true;
}

function names(base: string, kind: 'ids' | 'choices'): string[] {
	try { return fs.readdirSync(path.join(base, kind)); } catch { return []; }
}

/** 予約にある名前のうち、pattern の 1 番目の組を数にして最大を返す (toNumber で数にする)。無ければ 0 */
export function maxReserved(base: string, kind: 'ids' | 'choices', pattern: RegExp, toNumber: (s: string) => number): number {
	let max = 0;
	for (const n of names(base, kind)) {
		const m = pattern.exec(n);
		if (m !== null) max = Math.max(max, toNumber(m[1]));
	}
	return max;
}

const DatedPattern = /^([ipr]\d{6})-([0-9a-zA-Z]{2})$/;
const DecisionPattern = /^(.+)-d(\d+)$/;
const Digits = '0123456789abcdefghijkLmnopqrstuvwxyz';
const nnValue = (nn: string): number => Digits.indexOf(nn[0]) * 36 + Digits.indexOf(nn[1]);

/**
 * 3 日より前の予約を消す (205-A)。系列ごとの最大の 1 つは残す。
 * ただし日付の番号は、今日より前の日の系列なら最大も消す (その日の番号を新しく取ることはもう無い)
 */
export function prune(base: string, today: string, now: number = Date.now()): void {
	const today6 = today.slice(2, 4) + today.slice(5, 7) + today.slice(8, 10);
	const isOld = (p: string): boolean => {
		try { return now - fs.statSync(p).mtimeMs > KeepMs; } catch { return false; }
	};
	const remove = (p: string): void => { fs.rmSync(p, { recursive: true, force: true }); };

	// ids: 系列ごとに分ける
	const series = new Map<string, { name: string; value: number; date6: string | null }[]>();
	for (const n of names(base, 'ids')) {
		const d = DatedPattern.exec(n);
		const c = d === null ? DecisionPattern.exec(n) : null;
		let key: string;
		let value: number;
		let date6: string | null = null;
		if (d !== null) { key = d[1]; value = nnValue(d[2]); date6 = d[1].slice(1); }
		else if (c !== null) { key = c[1] + '-d'; value = Number(c[2]); }
		else continue;
		series.set(key, [...(series.get(key) ?? []), { name: n, value, date6 }]);
	}
	for (const list of series.values()) {
		const max = Math.max(...list.map((x) => x.value));
		for (const x of list) {
			const p = path.join(base, 'ids', x.name);
			if (!isOld(p)) continue;
			const pastDay = x.date6 !== null && x.date6 < today6;
			if (pastDay || x.value !== max) remove(p);
		}
	}

	// choices: 1 つの系列
	const choices = names(base, 'choices').filter((n) => /^\d+$/.test(n));
	if (choices.length > 0) {
		const max = Math.max(...choices.map(Number));
		for (const n of choices) {
			const p = path.join(base, 'choices', n);
			if (Number(n) !== max && isOld(p)) remove(p);
		}
	}
}

// ---- 選択肢の番号 (201-A) ----

/** 手元の決定の legacy_ids から、自分のプロジェクトの選択肢の番号の最大を拾う (:<id>:150-A ・ :<id>:p261001-01/7-B ・ :<id>:206) */
function maxLegacyChoice(root: string, projectId: string): number {
	const dir = path.join(root, ...DecisionsDirRel);
	let files: string[];
	try { files = fs.readdirSync(dir).filter((n) => n.endsWith('.md')); } catch { return 0; }
	let max = 0;
	for (const f of files) {
		let text: string;
		try { text = fs.readFileSync(path.join(dir, f), 'utf8'); } catch { continue; }
		const line = /^legacy_ids:[ \t]*(.*)$/m.exec(text.replace(/\r/g, ''));
		if (line === null) continue;
		for (const item of line[1].split(',').map((s) => s.trim())) {
			const m = /^:([^:]+):(?:[^,\s/]+\/)?(\d+)(?:-[A-Z])?$/.exec(item);
			if (m !== null && m[1] === projectId) max = Math.max(max, Number(m[2]));
		}
	}
	return max;
}

/** 選択肢の番号を 1 つ予約して返す。キーを決められなければ null */
export function nextChoice(root: string, today: string): number | null {
	const base = numbersBaseOf(root);
	if (base === null) return null;
	prune(base, today);
	const projectId = readProjectFile(root)?.projectId ?? mainFolderName(root);
	const start = Math.max(maxReserved(base, 'choices', /^(\d+)$/, Number), maxLegacyChoice(root, projectId)) + 1;
	for (let n = start; n < start + 1000; n++) {
		if (reserve(base, 'choices', String(n), { kind: 'choice' })) return n;
	}
	return null;
}
