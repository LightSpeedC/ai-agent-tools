/*
	issue の操作 (フェーズ 2 の前半): init ・ new ・ show ・ list。
	仕様は notes/50_spec/課題ファイルの形と検査.html、決めた経緯は計画 p261103-01。

	状態は、置いてあるフォルダ (todo / doing / done / archived) で持つ (126-A)。
	ここの関数は、何かを表示せず、結果を返すか、UsageError (引数の誤り) ・ Failure (そのほかの失敗) を投げる。
*/
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { Folders, ItemsRel, NamePattern, RefPattern, SlugMax, SlugPattern, TodoLine, listMdNames, type Folder } from './check.ts';
import { splitIssue } from './meta.ts';
import { OldIdFileName, UuidFileName, mainFolderName, maxReserved, numbersBaseOf, prune, readProjectFile, reserve, uuidFileText } from './numbers.ts';

/** 引数の誤り。終了コード 5 */
export class UsageError extends Error {}
/** そのほかの失敗 (見つからない ・ 重複 ・ 番号を使い切った)。終了コード 1 */
export class Failure extends Error {}

/** フォルダが表す状態 (archived は、済のまま退避したもの) */
export const StateOf: Record<Folder, string> = { todo: '未', doing: '着手', done: '済', archived: '済' };

/** 連番の 36 進数の桁 (英字は小文字。l は読み間違えるので大文字の L) */
const Digits = '0123456789abcdefghijkLmnopqrstuvwxyz';
const NumberMax = 36 * 36 - 1;

function itemsDirOf(root: string): string {
	return path.join(root, ...ItemsRel.split('/'));
}

// ---- 日付と連番 ----

/** 今日の日付 (JST) の yyyy-mm-dd。試験だけが、環境変数 ISSUE_TEST_TODAY で固定する */
export function todayJst(): string {
	const fixed = process.env.ISSUE_TEST_TODAY;
	if (fixed !== undefined && /^\d{4}-\d{2}-\d{2}$/.test(fixed)) return fixed;
	const parts = new Intl.DateTimeFormat('ja-JP', { timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
	const v = (t: string): string => parts.find((p) => p.type === t)?.value ?? '';
	return v('year') + '-' + v('month') + '-' + v('day');
}

function nnOf(n: number): string {
	return Digits[Math.floor(n / 36) % 36] + Digits[n % 36];
}

function numberOf(nn: string): number {
	const a = Digits.indexOf(nn[0]);
	const b = Digits.indexOf(nn[1]);
	return a < 0 || b < 0 ? -1 : a * 36 + b;
}

/** id を、日付と連番の順に並べるための比較 (36 進数の順は、文字コード順と違う: L は 0〜9 と a〜k の後) */
export function compareId(a: string, b: string): number {
	const da = a.slice(1, 7);
	const db = b.slice(1, 7);
	if (da !== db) return da < db ? -1 : 1;
	return numberOf(a.slice(8, 10)) - numberOf(b.slice(8, 10));
}

// ---- init ----

/**
 * project-uuid.txt を作る (207-A ・ 208-A)。既にあれば変えない (newId なら project_uuid を振り直す)。
 * 古い project-id.txt があれば、乱数を変えずに project-uuid.txt へ移し、古いほうを消す (moved)
 */
export function initProject(root: string, newId: boolean): { rel: string; result: 'created' | 'exists' | 'replaced' | 'moved' } {
	const rel = ItemsRel + '/' + UuidFileName;
	const file = path.join(itemsDirOf(root), UuidFileName);
	const oldFile = path.join(itemsDirOf(root), OldIdFileName);
	const current = readProjectFile(root);
	if (current !== null && !newId) {
		if (current.kind === 'uuid') return { rel, result: 'exists' };
		if (current.uuid === null || !/^[0-9a-f]{32}$/.test(current.uuid)) throw new Failure(`${ItemsRel}/${OldIdFileName} の project_id が読めない (直してから issue init)`);
		fs.writeFileSync(file, uuidFileText(current.uuid, mainFolderName(root)), { flag: 'wx' });
		fs.rmSync(oldFile);
		return { rel, result: 'moved' };
	}
	const projectId = current?.projectId ?? mainFolderName(root);
	fs.mkdirSync(path.dirname(file), { recursive: true });
	fs.writeFileSync(file, uuidFileText(crypto.randomUUID().replace(/-/g, ''), projectId));
	fs.rmSync(oldFile, { force: true });
	return { rel, result: current !== null ? 'replaced' : 'created' };
}

/** 番号の予約の置き場。キーを決められなければ (project-uuid.txt を作ったあとなので、ふつうは起きない) 失敗にする */
export function numbersBaseFor(root: string): string {
	const base = numbersBaseOf(root);
	if (base === null) throw new Failure(`番号の予約の置き場を決められない (${ItemsRel}/${UuidFileName} が無い。issue init で作る)`);
	prune(base, todayJst());
	return base;
}

// ---- new ----

/** 題から件名 (スラッグ) を作る。使えない文字は - にし、30 文字までに切る。作れなければ空 */
export function slugFromTitle(title: string): string {
	let out = '';
	for (const ch of title.trim()) out += SlugPattern.test(ch) ? ch : '-';
	out = out.replace(/-+/g, '-').replace(/^-|-$/g, '');
	return [...out].slice(0, SlugMax).join('').replace(/-$/, '');
}

export function singleLine(value: string, name: string): string {
	const text = value.trim();
	if (text === '') throw new UsageError(`${name} が空`);
	if (text.includes('\n') || text.includes('\r')) throw new UsageError(`${name} に改行は書けない`);
	return text;
}

function hasFileWithId(root: string, id: string): boolean {
	for (const folder of Folders) {
		if (listMdNames(path.join(itemsDirOf(root), folder)).some((n) => n.startsWith(id + '-'))) return true;
	}
	return false;
}

/** その日 (yymmdd) の連番の最大。無ければ 0 */
function maxNumber(root: string, date6: string): number {
	const pattern = new RegExp(`^i${date6}-([0-9a-kLm-z]{2})-`);
	let max = 0;
	for (const folder of Folders) {
		for (const name of listMdNames(path.join(itemsDirOf(root), folder))) {
			const m = pattern.exec(name);
			if (m !== null) max = Math.max(max, numberOf(m[1]));
		}
	}
	return max;
}

export type NewOptions = { title: string; group: string; slug?: string; from?: string; refs?: string; body?: string };

/** todo/ に課題を作る。何かを作る前に、引数をすべて確かめる */
export function newIssue(root: string, o: NewOptions): { id: string; rel: string; createdProjectId: boolean } {
	const title = singleLine(o.title, '--title');
	const group = singleLine(o.group, '--group');
	const from = o.from === undefined ? undefined : singleLine(o.from, '--from');
	let refs: string | undefined;
	if (o.refs !== undefined) {
		const parts = o.refs.split(',').map((s) => s.trim());
		if (parts.some((s) => !RefPattern.test(s))) throw new UsageError(`--refs の形が違う: ${o.refs} (番号をカンマで区切る)`);
		refs = parts.join(', ');
	}
	const slug = o.slug !== undefined ? o.slug : slugFromTitle(title);
	if (slug === '') throw new UsageError('題から件名を作れない。--slug で指定する');
	if (!SlugPattern.test(slug)) throw new UsageError(`--slug に使えない文字がある: ${slug} (英数字 ・ - ・ _ ・ . ・ 日本語だけ。空白は不可)`);
	if ([...slug].length > SlugMax) throw new UsageError(`--slug が ${SlugMax} 文字を超えている: ${slug}`);

	const groupsFile = path.join(itemsDirOf(root), 'groups.txt');
	if (fs.existsSync(groupsFile)) {
		const names = fs.readFileSync(groupsFile, 'utf8').split('\n').map((s) => s.trim()).filter((s) => s !== '');
		if (!names.includes(group)) throw new UsageError(`--group ${group} が groups.txt に無い (あるのは: ${names.join(' ・ ')})`);
	}

	// 全件が archived/ に退避したグループには立てない (112-A)。戻してから立てる。
	// 一部だけが保管されている (1 件ずつの archive ・ migrate) グループには立てられる (215-A)
	if (listIssues(root, ['archived'], group, () => {}).length > 0 && listIssues(root, ['todo', 'doing', 'done'], group, () => {}).length === 0) {
		throw new UsageError(`グループ ${group} は archived/ に退避済み。issue unarchive ${group} で戻してから立てる`);
	}

	// 無いときだけ作る。古い project-id.txt を移すのは issue init の役目 (同時の new で移し合わないため)
	const createdProjectId = readProjectFile(root) === null && initProject(root, false).result === 'created';

	const today = todayJst();
	const date6 = today.slice(2, 4) + today.slice(5, 7) + today.slice(8, 10);
	// 予約は、ホームの下の共有の置き場に取り、書き終えても残す (p261109-01 の 202-A ・ 205-A)
	const base = numbersBaseFor(root);
	const todoDir = path.join(itemsDirOf(root), 'todo');
	const reservedMax = maxReserved(base, 'ids', new RegExp(`^i${date6}-([0-9a-kLm-z]{2})$`), numberOf);

	for (let n = Math.max(1, maxNumber(root, date6) + 1, reservedMax + 1); n <= NumberMax; n++) {
		const id = `i${date6}-${nnOf(n)}`;
		if (hasFileWithId(root, id)) continue;
		if (!reserve(base, 'ids', id, { kind: 'issue', title })) continue;
		{
			// 予約を取る間に、別の new が作り終えていないかを、もう一度見る
			if (hasFileWithId(root, id)) continue;
			const lines = ['schema: 1', `id: ${id}`, `title: ${title}`, `group: ${group}`, `created: ${today}`];
			if (from !== undefined) lines.push(`from: ${from}`, 'confirmed: false');
			if (refs !== undefined) lines.push(`refs: ${refs}`);
			const body = o.body === undefined ? '\n' : '\n' + o.body.replace(/\r\n?/g, '\n').replace(/\n+$/, '') + '\n';
			const name = `${id}-${slug}.md`;
			fs.mkdirSync(todoDir, { recursive: true });
			fs.writeFileSync(path.join(todoDir, name), '---\n' + lines.join('\n') + '\n---\n' + body, { flag: 'wx' });
			return { id, rel: `${ItemsRel}/todo/${name}`, createdProjectId };
		}
	}
	throw new Failure(`${date6} の番号 (01 〜 ${nnOf(NumberMax)}) を使い切った`);
}

// ---- 読む (show ・ list) ----

type Loaded = { folder: Folder; rel: string; text: string };

export function loadFile(root: string, folder: Folder, name: string): Loaded {
	const rel = `${ItemsRel}/${folder}/${name}`;
	const raw = fs.readFileSync(path.join(itemsDirOf(root), folder, name), 'utf8');
	return { folder, rel, text: raw.replace(/^﻿/, '').replace(/\r\n?/g, '\n') };
}

export type IssueView = {
	id: string;
	state: string;
	folder: Folder;
	file: string;
	meta: Record<string, string>;
	body: string;
	todos: { state: string; text: string }[];
	/** ファイルの全文 (人向けの表示に使う) */
	text: string;
};

/** id のファイルを、4 つのフォルダから探す。無ければ、複数あれば Failure */
export function locateIssue(root: string, id: string): { folder: Folder; name: string } {
	const found: { folder: Folder; name: string }[] = [];
	for (const folder of Folders) {
		for (const name of listMdNames(path.join(itemsDirOf(root), folder))) {
			if (name.startsWith(id + '-')) found.push({ folder, name });
		}
	}
	if (found.length === 0) throw new Failure(`${id} の課題が見つからない`);
	if (found.length > 1) throw new Failure(`${id} のファイルが複数ある: ${found.map((f) => `${f.folder}/${f.name}`).join(' ・ ')} (issue check で確かめる)`);
	return found[0];
}

/** id のファイルを、4 つのフォルダから探して読む */
export function showIssue(root: string, id: string): IssueView {
	const located = locateIssue(root, id);
	const loaded = loadFile(root, located.folder, located.name);
	const parts = splitIssue(loaded.text);
	const meta: Record<string, string> = {};
	for (const p of parts.parsed.pairs) meta[p.key] = p.value;
	const todos: { state: string; text: string }[] = [];
	for (const line of parts.body.split('\n')) {
		const m = /^\s*- \[([^\]]*)\]\s*(.*)$/.exec(line);
		if (m !== null && TodoLine.test(line)) todos.push({ state: m[1], text: m[2] });
	}
	return { id, state: StateOf[loaded.folder], folder: loaded.folder, file: loaded.rel, meta, body: parts.body, todos, text: loaded.text };
}

export type ListItem = { id: string; state: string; folder: Folder; group: string; title: string; created: string; file: string };

/** 指定のフォルダの課題を、id の順に並べて返す。メタ情報が読めないものは飛ばし、warn で知らせる */
export function listIssues(root: string, folders: Folder[], group: string | null, warn: (message: string) => void): ListItem[] {
	const items: ListItem[] = [];
	for (const folder of folders) {
		for (const name of listMdNames(path.join(itemsDirOf(root), folder))) {
			const nameMatch = NamePattern.exec(name);
			if (nameMatch === null) continue;
			let loaded: Loaded;
			try {
				loaded = loadFile(root, folder, name);
			} catch {
				warn(`[警告] ${ItemsRel}/${folder}/${name}: 読めない`);
				continue;
			}
			const parts = splitIssue(loaded.text);
			if (parts.broken) {
				warn(`[警告] ${loaded.rel}: メタ情報を読めない (issue check で確かめる)`);
				continue;
			}
			const get = (k: string): string => parts.parsed.pairs.find((p) => p.key === k)?.value ?? '';
			if (group !== null && get('group') !== group) continue;
			items.push({ id: nameMatch[1], state: StateOf[folder], folder, group: get('group'), title: get('title'), created: get('created'), file: loaded.rel });
		}
	}
	return items.sort((a, b) => compareId(a.id, b.id));
}

// ---- 動かす (set ・ archive ・ unarchive) ----

const TodoItemLine = /^(\s*- \[)(未|着手|済)(\]\s*)(.*)$/;

/** 済 (done/ ・ archived/) に置ける条件を満たさない理由。満たしていれば空 */
function doneBlockers(text: string): string[] {
	const parts = splitIssue(text);
	if (parts.broken) return ['メタ情報を読めない'];
	const reasons: string[] = [];
	const open = parts.body.split('\n').filter((l) => {
		const m = TodoItemLine.exec(l);
		return m !== null && m[2] !== '済';
	}).length;
	if (open > 0) reasons.push(`未・着手のやることが ${open} 件残っている`);
	const get = (k: string): string | undefined => parts.parsed.pairs.find((p) => p.key === k)?.value;
	if (get('from') !== undefined && get('confirmed') !== 'true') reasons.push('報告元の確認 (confirmed) が true でない');
	return reasons;
}

/** ファイルを動かす。git の管理下 (追跡中) なら git mv、そうでなければ名前を変えるだけ */
function moveIssueFile(root: string, fromRel: string, toRel: string): void {
	const from = path.join(root, ...fromRel.split('/'));
	const to = path.join(root, ...toRel.split('/'));
	if (fs.existsSync(to)) throw new Failure(`${toRel} が既にある (動かさない)`);
	fs.mkdirSync(path.dirname(to), { recursive: true });
	const tracked = spawnSync('git', ['ls-files', '--error-unmatch', '--', fromRel], { cwd: root, encoding: 'utf8', timeout: 30000 }).status === 0;
	if (tracked) {
		const r = spawnSync('git', ['mv', '--', fromRel, toRel], { cwd: root, encoding: 'utf8', timeout: 30000 });
		if (r.status !== 0) throw new Failure(`git mv に失敗した: ${(r.stderr ?? '').trim().split('\n')[0]}`);
	} else {
		fs.renameSync(from, to);
	}
}

/** set で使える状態 (archived は archive で動かす) */
export const SetTargets: Record<string, Folder> = { 未: 'todo', 着手: 'doing', 済: 'done' };

export type SetResult = { id: string; state: string; folder: Folder; from: { state: string; folder: Folder }; file: string; moved: boolean };

/** 課題の状態を変える (ファイルを隣のフォルダへ動かす)。済にするときは、条件を満たさなければ拒否する */
export function setState(root: string, id: string, state: string): SetResult {
	const target = SetTargets[state];
	if (target === undefined) throw new UsageError(`--state に使えない語: ${state} (未 ・ 着手 ・ 済。archived は issue archive で動かす)`);
	const cur = locateIssue(root, id);
	const from = { state: StateOf[cur.folder], folder: cur.folder };
	if (cur.folder === 'archived') throw new Failure(`${id} は archived/ にある。グループを戻す issue unarchive <group> のあとで動かす`);
	const toRel = `${ItemsRel}/${target}/${cur.name}`;
	if (cur.folder === target) return { id, state, folder: target, from, file: toRel, moved: false };
	if (target === 'done') {
		const reasons = doneBlockers(loadFile(root, cur.folder, cur.name).text);
		if (reasons.length > 0) throw new Failure(`${id} を済にできない: ${reasons.join(' ・ ')}`);
	}
	moveIssueFile(root, `${ItemsRel}/${cur.folder}/${cur.name}`, toRel);
	return { id, state, folder: target, from, file: toRel, moved: true };
}

function groupOf(text: string): string | null {
	const parts = splitIssue(text);
	if (parts.broken) return null;
	return parts.parsed.pairs.find((p) => p.key === 'group')?.value ?? null;
}

type Member = { folder: Folder; name: string; id: string; text: string };

/** 4 つのフォルダの課題を読む。メタ情報が読めない課題は、unreadable に入れる */
function loadAll(root: string, folders: Folder[]): { members: (Member & { group: string })[]; unreadable: string[] } {
	const members: (Member & { group: string })[] = [];
	const unreadable: string[] = [];
	for (const folder of folders) {
		for (const name of listMdNames(path.join(itemsDirOf(root), folder))) {
			const nameMatch = NamePattern.exec(name);
			if (nameMatch === null) continue;
			let text: string;
			try {
				text = loadFile(root, folder, name).text;
			} catch {
				unreadable.push(`${folder}/${name}`);
				continue;
			}
			const group = groupOf(text);
			if (group === null) unreadable.push(`${folder}/${name}`);
			else members.push({ folder, name, id: nameMatch[1], text, group });
		}
	}
	return { members, unreadable };
}

export type GroupMoveResult = { group: string; moved: string[]; already: number };

/** グループの全件が済 (done/) なら、archived/ へ動かす。1 件でも満たさなければ、1 件も動かさない */
export function archiveGroup(root: string, group: string): GroupMoveResult {
	const { members, unreadable } = loadAll(root, ['todo', 'doing', 'done']);
	if (unreadable.length > 0) throw new Failure(`メタ情報を読めない課題があり、グループを判定できない: ${unreadable.join(' ・ ')} (issue check で確かめる)`);
	const mine = members.filter((m) => m.group === group);
	const archivedCount = loadAll(root, ['archived']).members.filter((m) => m.group === group).length;
	if (mine.length === 0 && archivedCount === 0) throw new Failure(`グループ ${group} の課題が無い`);
	const open = mine.filter((m) => m.folder !== 'done');
	if (open.length > 0) throw new Failure(`グループ ${group} に、未・着手の課題が残っている: ${open.map((m) => m.id).join(' ・ ')}`);
	const problems: string[] = [];
	for (const m of mine) {
		const reasons = doneBlockers(m.text);
		if (reasons.length > 0) problems.push(`${m.id} (${reasons.join(' ・ ')})`);
	}
	if (problems.length > 0) throw new Failure(`済の条件を満たさない課題がある: ${problems.join(' ・ ')}`);
	for (const m of mine) {
		if (fs.existsSync(path.join(itemsDirOf(root), 'archived', m.name))) throw new Failure(`${ItemsRel}/archived/${m.name} が既にある (動かさない)`);
	}
	const sorted = [...mine].sort((a, b) => compareId(a.id, b.id));
	for (const m of sorted) moveIssueFile(root, `${ItemsRel}/done/${m.name}`, `${ItemsRel}/archived/${m.name}`);
	return { group, moved: sorted.map((m) => m.id), already: archivedCount };
}

/** 済の課題を 1 件だけ archived/ へ動かす (214-A)。既に archived/ にあれば moved は空 */
export function archiveOne(root: string, id: string): GroupMoveResult {
	const { members, unreadable } = loadAll(root, ['todo', 'doing', 'done', 'archived']);
	const me = members.find((m) => m.id === id);
	if (me === undefined) {
		if (unreadable.length > 0) throw new Failure(`課題 ${id} が見つからない (メタ情報を読めない課題がある: ${unreadable.join(' ・ ')})`);
		throw new Failure(`課題 ${id} が無い`);
	}
	if (me.folder === 'archived') return { group: me.group, moved: [], already: 1 };
	if (me.folder !== 'done') throw new Failure(`課題 ${id} は ${StateOf[me.folder]}。済 (done/) の課題だけを archived/ へ動かせる`);
	const reasons = doneBlockers(me.text);
	if (reasons.length > 0) throw new Failure(`課題 ${id} は済の条件を満たさない: ${reasons.join(' ・ ')}`);
	if (fs.existsSync(path.join(itemsDirOf(root), 'archived', me.name))) throw new Failure(`${ItemsRel}/archived/${me.name} が既にある (動かさない)`);
	moveIssueFile(root, `${ItemsRel}/done/${me.name}`, `${ItemsRel}/archived/${me.name}`);
	return { group: me.group, moved: [id], already: 0 };
}

/** archived/ のグループの課題を、done/ へ戻す */
export function unarchiveGroup(root: string, group: string): GroupMoveResult {
	const { members, unreadable } = loadAll(root, ['archived']);
	if (unreadable.length > 0) throw new Failure(`メタ情報を読めない課題がある: ${unreadable.join(' ・ ')} (issue check で確かめる)`);
	const mine = members.filter((m) => m.group === group);
	if (mine.length === 0) throw new Failure(`グループ ${group} の課題が archived/ に無い`);
	for (const m of mine) {
		if (fs.existsSync(path.join(itemsDirOf(root), 'done', m.name))) throw new Failure(`${ItemsRel}/done/${m.name} が既にある (動かさない)`);
	}
	const sorted = [...mine].sort((a, b) => compareId(a.id, b.id));
	for (const m of sorted) moveIssueFile(root, `${ItemsRel}/archived/${m.name}`, `${ItemsRel}/done/${m.name}`);
	return { group, moved: sorted.map((m) => m.id), already: 0 };
}

// ---- やること (todo) ----

export type TodoItem = { n: number; state: string; text: string };

function todoItemsOf(lines: string[]): { index: number; item: TodoItem }[] {
	const out: { index: number; item: TodoItem }[] = [];
	lines.forEach((line, index) => {
		const m = TodoItemLine.exec(line);
		if (m !== null) out.push({ index, item: { n: out.length + 1, state: m[2], text: m[4] } });
	});
	return out;
}

export function listTodos(root: string, id: string): TodoItem[] {
	const located = locateIssue(root, id);
	return todoItemsOf(loadFile(root, located.folder, located.name).text.split('\n')).map((t) => t.item);
}

export type TodoEdit = { kind: 'add'; text: string } | { kind: 'set'; n: number; state: string };

/** やることを足す・状態を変える。BOM や CR のあるファイルは、書き換えない */
export function editTodo(root: string, id: string, edit: TodoEdit): { todos: TodoItem[]; changed: TodoItem } {
	const located = locateIssue(root, id);
	const rel = `${ItemsRel}/${located.folder}/${located.name}`;
	const abs = path.join(itemsDirOf(root), located.folder, located.name);
	const raw = fs.readFileSync(abs, 'utf8');
	if (raw.startsWith('﻿') || raw.includes('\r')) throw new Failure(`${rel} に BOM か CR (CRLF) がある。issue check で確かめて直してから (書き換えない)`);
	const isDone = located.folder === 'done' || located.folder === 'archived';

	if (edit.kind === 'add') {
		const text = edit.text.trim();
		if (text === '') throw new UsageError('--add の文が空');
		if (/[\r\n]/.test(text)) throw new UsageError('--add の文に改行は書けない');
		if (isDone) throw new Failure(`${id} は ${located.folder}/ にある。やること (未) を足せない (先に issue set --state 着手)`);
		const lines = raw.split('\n');
		const items = todoItemsOf(lines);
		let next: string;
		if (items.length > 0) {
			lines.splice(items[items.length - 1].index + 1, 0, `- [未] ${text}`);
			next = lines.join('\n');
		} else {
			next = (raw.endsWith('\n') ? raw : raw + '\n') + `\n## やること\n- [未] ${text}\n`;
		}
		fs.writeFileSync(abs, next);
		const todos = todoItemsOf(next.split('\n')).map((t) => t.item);
		return { todos, changed: todos[todos.length - 1] };
	}

	const lines = raw.split('\n');
	const items = todoItemsOf(lines);
	if (!Number.isInteger(edit.n) || edit.n < 1 || edit.n > items.length) throw new UsageError(`やることの番号が範囲外: ${edit.n} (1 〜 ${items.length})`);
	if (isDone && edit.state !== '済') throw new Failure(`${id} は ${located.folder}/ にある。やることを ${edit.state} にできない (先に issue set --state 着手)`);
	const target = items[edit.n - 1];
	lines[target.index] = lines[target.index].replace(TodoItemLine, `$1${edit.state}$3$4`);
	const next = lines.join('\n');
	if (next !== raw) fs.writeFileSync(abs, next);
	const todos = todoItemsOf(next.split('\n')).map((t) => t.item);
	return { todos, changed: todos[edit.n - 1] };
}

// ---- 報告元の確認 (confirm) ----

export type ConfirmResult = { id: string; confirmed: boolean; from: string; changed: boolean; file: string };

/**
 * 報告元の確認 (confirmed) を true / false に直す。フォルダは動かさず、その行だけを書き換える。
 * from (報告元) が無い課題には要らないので、UsageError。BOM や CR のあるファイルは、書き換えない
 */
export function setConfirmed(root: string, id: string, value: boolean): ConfirmResult {
	const located = locateIssue(root, id);
	const rel = `${ItemsRel}/${located.folder}/${located.name}`;
	const abs = path.join(itemsDirOf(root), located.folder, located.name);
	const raw = fs.readFileSync(abs, 'utf8');
	if (raw.startsWith('﻿') || raw.includes('\r')) throw new Failure(`${rel} に BOM か CR (CRLF) がある。issue check で確かめて直してから (書き換えない)`);
	const parts = splitIssue(raw);
	if (parts.broken) throw new Failure(`${rel} のメタ情報を読めない。issue check で確かめて直してから (書き換えない)`);
	const get = (k: string): string | undefined => parts.parsed.pairs.find((p) => p.key === k)?.value;
	const from = get('from');
	if (from === undefined) throw new UsageError(`${id} には from (報告元) が無い。confirmed は、他プロジェクトからの報告の課題だけに要る`);
	const isDone = located.folder === 'done' || located.folder === 'archived';
	if (isDone && !value) throw new Failure(`${id} は ${located.folder}/ にある。報告元の確認を false に戻せない (先に issue set --state 着手)`);
	const text = value ? 'true' : 'false';
	if (get('confirmed') === text) return { id, confirmed: value, from, changed: false, file: rel };

	const lines = raw.split('\n');
	const end = lines.indexOf('---', 1);
	let confirmedAt = -1;
	let fromAt = -1;
	for (let i = 1; i < end; i++) {
		if (/^confirmed:/.test(lines[i])) confirmedAt = i;
		if (/^from:/.test(lines[i])) fromAt = i;
	}
	if (confirmedAt >= 0) lines[confirmedAt] = `confirmed: ${text}`;
	else lines.splice(fromAt + 1, 0, `confirmed: ${text}`);
	fs.writeFileSync(abs, lines.join('\n'));
	return { id, confirmed: value, from, changed: true, file: rel };
}

// ---- 探す (search) ----

export type SearchHit = ListItem & { matches: { line: number; text: string }[] };

const SnippetMax = 120;

/** 指定のフォルダの課題から、題と本文 (ファイルの全文) に語を含む行を探す。英字は大小を区別しない */
/**
 * 探す語から、1 行が当たるかを返す関数を作る。regex が真なら正規表現として (213-A)、偽なら部分一致で探す。
 * どちらも英字の大小を区別しない。壊れた式は UsageError (終了コード 5)
 */
export function lineMatcher(term: string, regex: boolean): (line: string) => boolean {
	if (!regex) {
		const needle = term.toLowerCase();
		return (line) => line.toLowerCase().includes(needle);
	}
	let re: RegExp;
	try {
		re = new RegExp(term, 'i');
	} catch (e) {
		throw new UsageError(`--regex の式が読めない: ${term} (${(e as Error).message})`);
	}
	return (line) => re.test(line);
}

export function searchIssues(root: string, term: string, folders: Folder[], group: string | null, warn: (message: string) => void, regex = false): SearchHit[] {
	const hit = lineMatcher(term, regex);
	const hits: SearchHit[] = [];
	for (const folder of folders) {
		for (const name of listMdNames(path.join(itemsDirOf(root), folder))) {
			const nameMatch = NamePattern.exec(name);
			if (nameMatch === null) continue;
			let loaded: Loaded;
			try {
				loaded = loadFile(root, folder, name);
			} catch {
				warn(`[警告] ${ItemsRel}/${folder}/${name}: 読めない`);
				continue;
			}
			const parts = splitIssue(loaded.text);
			if (parts.broken) {
				warn(`[警告] ${loaded.rel}: メタ情報を読めない (issue check で確かめる)`);
				continue;
			}
			const get = (k: string): string => parts.parsed.pairs.find((p) => p.key === k)?.value ?? '';
			if (group !== null && get('group') !== group) continue;
			const matches: { line: number; text: string }[] = [];
			loaded.text.split('\n').forEach((line, index) => {
				if (hit(line)) matches.push({ line: index + 1, text: [...line.trim()].slice(0, SnippetMax).join('') });
			});
			if (matches.length === 0) continue;
			hits.push({ id: nameMatch[1], state: StateOf[folder], folder, group: get('group'), title: get('title'), created: get('created'), file: loaded.rel, matches });
		}
	}
	return hits.sort((a, b) => compareId(a.id, b.id));
}
