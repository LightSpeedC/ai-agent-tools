/*
	issue の操作 (フェーズ 2 の前半): init ・ new ・ show ・ list。
	仕様は notes/50_spec/課題ファイルの形と検査.html、決めた経緯は計画 p261103-01。

	状態は、置いてあるフォルダ (todo / doing / done / archived) で持つ (126-A)。
	ここの関数は、何かを表示せず、結果を返すか、UsageError (引数の誤り) ・ Failure (そのほかの失敗) を投げる。
*/
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { Folders, ItemsRel, NamePattern, RefPattern, SlugMax, SlugPattern, TodoLine, listMdNames, type Folder } from './check.ts';
import { splitIssue } from './meta.ts';

/** 引数の誤り。終了コード 5 */
export class UsageError extends Error {}
/** そのほかの失敗 (見つからない ・ 重複 ・ 番号を使い切った)。終了コード 1 */
export class Failure extends Error {}

/** フォルダが表す状態 (archived は、済のまま退避したもの) */
export const StateOf: Record<Folder, string> = { todo: '未', doing: '着手', done: '済', archived: '済' };

/** 連番の 36 進数の桁 (英字は小文字。l は読み間違えるので大文字の L) */
const Digits = '0123456789abcdefghijkLmnopqrstuvwxyz';
const NumberMax = 36 * 36 - 1;
/** 番号の予約を古いとみなす長さ。持ち主の new は数ミリ秒で終わるので、これより古ければ持ち主は居ない */
const LockStaleMs = 60 * 1000;

function itemsDirOf(root: string): string {
	return path.join(root, ...ItemsRel.split('/'));
}

/** 番号の予約を置くフォルダ。先頭 _ なので Git 管理外 */
function lockBaseOf(root: string): string {
	return path.join(root, 'notes', '40_issues', '_lock');
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

/** project-id.txt を作る。既にあれば変えない (newId なら振り直す) */
export function initProject(root: string, newId: boolean): { rel: string; result: 'created' | 'exists' | 'replaced' } {
	const rel = ItemsRel + '/project-id.txt';
	const file = path.join(itemsDirOf(root), 'project-id.txt');
	const exists = fs.existsSync(file);
	if (exists && !newId) return { rel, result: 'exists' };
	fs.mkdirSync(path.dirname(file), { recursive: true });
	fs.writeFileSync(file, 'schema: 1\nproject_id: ' + crypto.randomUUID().replace(/-/g, '') + '\n');
	return { rel, result: exists ? 'replaced' : 'created' };
}

// ---- new ----

/** 題から件名 (スラッグ) を作る。使えない文字は - にし、30 文字までに切る。作れなければ空 */
export function slugFromTitle(title: string): string {
	let out = '';
	for (const ch of title.trim()) out += SlugPattern.test(ch) ? ch : '-';
	out = out.replace(/-+/g, '-').replace(/^-|-$/g, '');
	return [...out].slice(0, SlugMax).join('').replace(/-$/, '');
}

function singleLine(value: string, name: string): string {
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

/** 番号の予約を取る (mkdir は、既にあれば失敗するので排他になる)。古い予約は消して取り直す */
function acquire(lock: string): boolean {
	for (let attempt = 0; attempt < 2; attempt++) {
		try {
			fs.mkdirSync(lock);
			return true;
		} catch (e) {
			if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e;
			try {
				if (Date.now() - fs.statSync(lock).mtimeMs > LockStaleMs) {
					fs.rmdirSync(lock);
					continue;
				}
			} catch {
				continue; // 調べている間に、持ち主が消した
			}
			return false;
		}
	}
	return false;
}

function release(lock: string): void {
	try {
		fs.rmdirSync(lock);
	} catch {
		// 既に無ければよい
	}
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

	const createdProjectId = initProject(root, false).result === 'created';

	const today = todayJst();
	const date6 = today.slice(2, 4) + today.slice(5, 7) + today.slice(8, 10);
	const lockBase = lockBaseOf(root);
	fs.mkdirSync(lockBase, { recursive: true });
	const todoDir = path.join(itemsDirOf(root), 'todo');

	for (let n = Math.max(1, maxNumber(root, date6) + 1); n <= NumberMax; n++) {
		const id = `i${date6}-${nnOf(n)}`;
		if (hasFileWithId(root, id)) continue;
		const lock = path.join(lockBase, id);
		if (!acquire(lock)) continue;
		try {
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
		} finally {
			release(lock);
		}
	}
	throw new Failure(`${date6} の番号 (01 〜 ${nnOf(NumberMax)}) を使い切った`);
}

// ---- 読む (show ・ list) ----

type Loaded = { folder: Folder; rel: string; text: string };

function loadFile(root: string, folder: Folder, name: string): Loaded {
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

/** id のファイルを、4 つのフォルダから探して読む */
export function showIssue(root: string, id: string): IssueView {
	const found: { folder: Folder; name: string }[] = [];
	for (const folder of Folders) {
		for (const name of listMdNames(path.join(itemsDirOf(root), folder))) {
			if (name.startsWith(id + '-')) found.push({ folder, name });
		}
	}
	if (found.length === 0) throw new Failure(`${id} の課題が見つからない`);
	if (found.length > 1) throw new Failure(`${id} のファイルが複数ある: ${found.map((f) => `${f.folder}/${f.name}`).join(' ・ ')} (issue check で確かめる)`);
	const loaded = loadFile(root, found[0].folder, found[0].name);
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
