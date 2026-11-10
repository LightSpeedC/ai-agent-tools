/*
	番号の予約の共有 (計画 p261109-01)。
	課題 ・ 決定 ・ 選択肢の番号の予約を、ホームの下の 1 か所 (~/.ai-agent-tools/numbers/<キー>/) に置く (202-A)。
	同じ PC の同じユーザなら、worktree でも別の clone でも番号が重ならない。

	- キーは uuid_<project_uuid>_<project_id> (220-A。203-A ・ 207-A を置き換える)。探すのは uuid の部分。
	  リポジトリを作る ・ 名前を変える ・ id を変えても、同じフォルダを使う。古い名前と id の違いは付け直す (221-A)
	- uuid を変えたら (init --new-id)、予約を新しい uuid の名前に写す (222-A。元のプロジェクトの予約は残す)
	- 新しく置き場を作るとき、同じ project_id の別の uuid の置き場があれば警告する。引き継がない (227-A)
	- legacy_names の旧 id も、legacy_ids を数えるときの自分の id にする (223-B)
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

export type ProjectFile = { kind: 'uuid' | 'old'; uuid: string | null; projectId: string | null; formerIds: string[] };

/** project-uuid.txt を読む。無ければ古い project-id.txt を読む。どちらも無ければ null */
export function readProjectFile(root: string): ProjectFile | null {
	const dir = path.join(root, ...ItemsDirRel);
	const get = (text: string, key: string): string | null => new RegExp(`^${key}:[ \\t]*(\\S+)[ \\t]*$`, 'm').exec(text.replace(/\r/g, ''))?.[1] ?? null;
	try {
		const text = fs.readFileSync(path.join(dir, UuidFileName), 'utf8');
		// legacy_names: プロジェクト id を変える前の id (カンマ区切り、154-A ・ 223-B)
		const former = /^legacy_names:[ \t]*(.*)$/m.exec(text.replace(/\r/g, ''))?.[1] ?? '';
		return { kind: 'uuid', uuid: get(text, 'project_uuid'), projectId: get(text, 'project_id'), formerIds: former.split(',').map((s) => s.trim()).filter((s) => s !== '') };
	} catch {
		// 無ければ古いほうを見る
	}
	try {
		const text = fs.readFileSync(path.join(dir, OldIdFileName), 'utf8');
		return { kind: 'old', uuid: get(text, 'project_id'), projectId: null, formerIds: [] };
	} catch {
		return null;
	}
}

export function uuidFileText(uuid: string, projectId: string, formerIds: string[] = []): string {
	return `schema: 2\nproject_uuid: ${uuid}\nproject_id: ${projectId}\n` + (formerIds.length > 0 ? `legacy_names: ${formerIds.join(', ')}\n` : '');
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

/** フォルダ名に使えない字を _ にする */
function safeName(s: string): string {
	return s.replace(/[\\/:*?"<>|\s]/g, '_');
}

/** 予約の置き場のキー (220-A): uuid_<project_uuid>_<project_id> */
export function keyOf(uuid: string, projectId: string): string {
	return `uuid_${uuid}_${safeName(projectId)}`;
}

function keyJsonUuid(dir: string): string | null {
	try {
		const j = JSON.parse(fs.readFileSync(path.join(dir, 'key.json'), 'utf8')) as { project_uuid?: unknown };
		return typeof j.project_uuid === 'string' ? j.project_uuid : null;
	} catch {
		return null;
	}
}

/**
 * uuid の予約のフォルダを探す。新しい名前 (uuid_<uuid>_…) を先に、次に古い名前
 * (uuid_<uuid> ・ key.json の project_uuid が一致する github_…) を見る。無ければ null
 */
function findByUuid(top: string, uuid: string): string | null {
	let names: string[];
	try { names = fs.readdirSync(top); } catch { return null; }
	const prefix = `uuid_${uuid}_`;
	const current = names.find((n) => n.startsWith(prefix));
	if (current !== undefined) return current;
	if (names.includes(`uuid_${uuid}`)) return `uuid_${uuid}`;
	return names.find((n) => n.startsWith('github_') && keyJsonUuid(path.join(top, n)) === uuid) ?? null;
}

function writeKeyJson(base: string, key: string, root: string, uuid: string, projectId: string): void {
	const repo = githubRepoOf(root);
	const info = { schema: 2, key, repo: repo === null ? null : `${repo.owner}/${repo.name}`, project_uuid: uuid, project_id: projectId };
	try { fs.writeFileSync(path.join(base, 'key.json'), JSON.stringify(info, null, '\t') + '\n'); } catch { /* 書けなくても予約は使える */ }
}

/**
 * プロジェクトの予約の置き場 (<根>/<キー>/) を返し、無ければ作る。
 * 名前が今のキーと違う (古い名前 ・ id が変わった) ときは付け直す。付け直せなければ、古い名前のまま使う (221-A)。
 * project_uuid が無ければ、キーを決められないので null
 */
export function numbersBaseOf(root: string): string | null {
	const file = readProjectFile(root);
	const uuid = file?.uuid;
	if (!uuid) return null;
	const projectId = file?.projectId ?? mainFolderName(root);
	const key = keyOf(uuid, projectId);
	const top = numbersRoot(root);
	let base = path.join(top, key);
	const found = findByUuid(top, uuid);
	if (found === null) {
		// 新しく作る。同じ project_id の別の uuid の置き場があれば知らせる。名前だけでは別のプロジェクトかもしれないので、引き継がない (227-A)
		let names: string[] = [];
		try { names = fs.readdirSync(top); } catch { /* まだ無い */ }
		const others = names.filter((n) => n.startsWith('uuid_') && n.endsWith('_' + safeName(projectId)));
		for (const n of others) {
			process.stderr.write(`[警告] 同じプロジェクト id (${projectId}) の、別の uuid の予約の置き場がある: ${n}。project-uuid.txt を作り直したなら、前の予約は引き継がれない\n`);
		}
	}
	if (found !== null && found !== key) {
		try {
			fs.renameSync(path.join(top, found), base);
			writeKeyJson(base, key, root, uuid, projectId);
		} catch {
			base = path.join(top, found);
		}
	}
	fs.mkdirSync(path.join(base, 'ids'), { recursive: true });
	fs.mkdirSync(path.join(base, 'choices'), { recursive: true });
	if (!fs.existsSync(path.join(base, 'key.json'))) writeKeyJson(base, key, root, uuid, projectId);
	return base;
}

/**
 * uuid を変えたとき (issue init --new-id)、古い uuid の予約を新しい uuid の名前に写す (222-A)。
 * 移さずに写すのは、--new-id がフォルダごとコピーして別のプロジェクトにしたときにも使われるため。
 * 移すと、元のプロジェクトの予約を取り上げる。写せば、どちらも続きから番号を取り、重ならない。写せなければ何もしない
 */
export function copyUuid(root: string, oldUuid: string, newUuid: string, projectId: string): void {
	const top = numbersRoot(root);
	const found = findByUuid(top, oldUuid);
	if (found === null) return;
	const key = keyOf(newUuid, projectId);
	const base = path.join(top, key);
	if (fs.existsSync(base)) return;
	try {
		fs.cpSync(path.join(top, found), base, { recursive: true });
		writeKeyJson(base, key, root, newUuid, projectId);
	} catch {
		// 写せなければ、新しい uuid で新しく作る
	}
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
function maxLegacyChoice(root: string, projectIds: string[]): number {
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
			if (m !== null && projectIds.includes(m[1])) max = Math.max(max, Number(m[2]));
		}
	}
	return max;
}

/** 選択肢の番号を 1 つ予約して返す。キーを決められなければ null */
export function nextChoice(root: string, today: string): number | null {
	const base = numbersBaseOf(root);
	if (base === null) return null;
	prune(base, today);
	const file = readProjectFile(root);
	const ids = [file?.projectId ?? mainFolderName(root), ...(file?.formerIds ?? [])];
	const start = Math.max(maxReserved(base, 'choices', /^(\d+)$/, Number), maxLegacyChoice(root, ids)) + 1;
	for (let n = start; n < start + 1000; n++) {
		if (reserve(base, 'choices', String(n), { kind: 'choice' })) return n;
	}
	return null;
}
