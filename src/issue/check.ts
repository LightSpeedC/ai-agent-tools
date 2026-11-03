/*
	issue check: 課題ファイルと project-id.txt を検査する（読み取り専用）。
	仕様は notes/50_spec/課題ファイルの形と検査.html、決めた経緯は計画 p261103-01。
*/
import fs from 'node:fs';
import path from 'node:path';
import { KeyOrder, States, parsePairs, splitIssue } from './meta.ts';

export type Level = 'error' | 'warning';
export type Finding = { level: Level; code: string; file: string; message: string };
export type CheckResult = { findings: Finding[]; issues: number; archived: number };

/** プロジェクトの root からの、課題の置き場 */
export const ItemsRel = 'notes/40_issues/items';

/** <id>-<件名>.md。連番は 36 進数 2 桁で、英字は小文字、l は大文字の L */
const NamePattern = /^(i\d{6}-[0-9a-kLm-z]{2})-(.+)\.md$/;
const IdPattern = /^i\d{6}-[0-9a-kLm-z]{2}$/;
/** 件名に使える文字: 英数字 ・ ハイフン ・ 下線 ・ ピリオド ・ ひらがな ・ カタカナ ・ 漢字 */
const SlugPattern = /^[0-9A-Za-z_.\-ぁ-ゖァ-ヺー々㐀-䶿一-鿿]+$/;
const SlugMax = 30;
const ProjectIdPattern = /^[0-9a-f]{32}$/;
/** 番号 (課題 ・ 計画 ・ 調査)。ほかのプロジェクトの番号は「プロジェクト名:番号」 */
const RefPattern = /^(?:[A-Za-z0-9_.-]+:)?([a-z]\d{6}-[0-9a-kLm-z]{2})$/;
const TodoLine = /^\s*- \[([^\]]*)\]/;
const Required = ['schema', 'id', 'title', 'state', 'group', 'created'] as const;
/** refs の参照先を探す、notes/ の下のフォルダ（ファイル名の先頭が番号） */
const RefFolders = ['notes/01_research', 'notes/02_ideas', 'notes/10_plan'];

type Add = (level: Level, code: string, file: string, message: string) => void;
type Entry = { rel: string; abs: string; archived: boolean };
type FileInfo = { rel: string; nameId: string | null; refs: string[] };

/** 作業フォルダから親へたどり、notes/40_issues/items/ を持つ最初のフォルダを返す。無ければ null */
export function findProjectRoot(startDir: string): string | null {
	let dir = path.resolve(startDir);
	for (;;) {
		if (hasItems(dir)) return dir;
		const parent = path.dirname(dir);
		if (parent === dir) return null;
		dir = parent;
	}
}

export function hasItems(root: string): boolean {
	try {
		return fs.statSync(path.join(root, ...ItemsRel.split('/'))).isDirectory();
	} catch {
		return false;
	}
}

function isRealDate(text: string): boolean {
	const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
	if (m === null) return false;
	const y = Number(m[1]);
	const mo = Number(m[2]);
	const d = Number(m[3]);
	const date = new Date(Date.UTC(y, mo - 1, d));
	return date.getUTCFullYear() === y && date.getUTCMonth() === mo - 1 && date.getUTCDate() === d;
}

/** BOM と CR を誤りとして報告し、以降の検査のために直した文字列を返す */
function normalize(text: string, rel: string, add: Add): string {
	let out = text;
	if (out.startsWith('﻿')) {
		add('error', 'encoding', rel, 'BOM がある (UTF-8 の BOM 無しにする)');
		out = out.slice(1);
	}
	if (out.includes('\r')) {
		add('error', 'encoding', rel, 'CR (CRLF) がある (LF にする)');
		out = out.replace(/\r\n?/g, '\n');
	}
	return out;
}

function listMd(dir: string, relDir: string, archived: boolean): Entry[] {
	let names: string[];
	try {
		names = fs.readdirSync(dir, { withFileTypes: true }).filter((e) => e.isFile()).map((e) => e.name);
	} catch {
		return [];
	}
	return names
		.filter((n) => n.toLowerCase().endsWith('.md'))
		.sort()
		.map((n) => ({ rel: relDir + '/' + n, abs: path.join(dir, n), archived }));
}

function checkProjectId(itemsDir: string, add: Add): void {
	const rel = ItemsRel + '/project-id.txt';
	let text: string;
	try {
		text = fs.readFileSync(path.join(itemsDir, 'project-id.txt'), 'utf8');
	} catch {
		add('error', 'project-id', rel, 'project-id.txt が無い (issue init で作る)');
		return;
	}
	text = normalize(text, rel, add).replace(/\n+$/, '');
	const parsed = parsePairs(text.split('\n'), 1);
	for (const p of parsed.problems) add('error', 'project-id', rel, p);
	const get = (k: string): string | undefined => parsed.pairs.find((p) => p.key === k)?.value;
	const schema = get('schema');
	if (schema !== '1') add('error', 'project-id', rel, schema === undefined ? 'schema が無い' : `schema が 1 でない: ${schema}`);
	const id = get('project_id');
	if (id === undefined) {
		if (!parsed.brokenKeys.has('project_id')) add('error', 'project-id', rel, 'project_id が無い');
	} else if (!ProjectIdPattern.test(id)) {
		add('error', 'project-id', rel, 'project_id が小文字 32 桁の 16 進数でない');
	}
	for (const p of parsed.pairs) {
		if (p.key !== 'schema' && p.key !== 'project_id') add('warning', 'unknown-key', rel, `知らないキー: ${p.key}`);
	}
}

/** groups.txt が無ければ null */
function readGroups(itemsDir: string, add: Add): Set<string> | null {
	const rel = ItemsRel + '/groups.txt';
	let text: string;
	try {
		text = fs.readFileSync(path.join(itemsDir, 'groups.txt'), 'utf8');
	} catch {
		return null;
	}
	text = normalize(text, rel, add);
	const groups = new Set<string>();
	for (const raw of text.split('\n')) {
		const name = raw.trim();
		if (name === '') continue;
		if (groups.has(name)) add('error', 'group', rel, `同じ名前が 2 度ある: ${name}`);
		groups.add(name);
	}
	return groups;
}

function checkIssueFile(entry: Entry, groups: Set<string> | null, add: Add): FileInfo {
	const rel = entry.rel;
	const info: FileInfo = { rel, nameId: null, refs: [] };

	const nameMatch = NamePattern.exec(path.basename(rel));
	if (nameMatch === null) {
		add('error', 'name', rel, 'ファイル名が <id>-<件名>.md の形でない');
		return info;
	}
	info.nameId = nameMatch[1];
	const slug = nameMatch[2];
	if (!SlugPattern.test(slug)) add('error', 'name', rel, '件名に使えない文字がある (英数字 ・ - ・ _ ・ . ・ 日本語だけ。空白は不可)');
	else if ([...slug].length > SlugMax) add('warning', 'slug-long', rel, `件名が ${SlugMax} 文字を超えている`);

	let text: string;
	try {
		text = fs.readFileSync(entry.abs, 'utf8');
	} catch {
		add('error', 'meta', rel, 'ファイルを読めない');
		return info;
	}
	text = normalize(text, rel, add);

	const parts = splitIssue(text);
	if (parts.broken) {
		for (const p of parts.problems) add('error', 'meta', rel, p);
		return info;
	}
	for (const p of parts.parsed.problems) add('error', 'meta', rel, p);

	const pairs = parts.parsed.pairs;
	const get = (k: string): string | undefined => pairs.find((p) => p.key === k)?.value;

	for (const key of Required) {
		if (get(key) === undefined && !parts.parsed.brokenKeys.has(key)) add('error', 'key', rel, `必須の ${key} が無い`);
	}

	const schema = get('schema');
	if (schema !== undefined && schema !== '1') add('error', 'value', rel, `schema が 1 でない: ${schema}`);

	const id = get('id');
	if (id !== undefined) {
		if (!IdPattern.test(id)) add('error', 'value', rel, `id の形が違う: ${id}`);
		else if (id !== info.nameId) add('error', 'value', rel, `id がファイル名の先頭と違う: ${id}`);
	}

	const stateText = get('state');
	let state: string | null = null;
	if (stateText !== undefined) {
		if ((States as readonly string[]).includes(stateText)) state = stateText;
		else add('error', 'value', rel, `state が 未 / 着手 / 済 のどれでもない: ${stateText}`);
	}

	const created = get('created');
	if (created !== undefined && !isRealDate(created)) add('error', 'value', rel, `created が実在する yyyy-mm-dd でない: ${created}`);

	const refsText = get('refs');
	if (refsText !== undefined) {
		const parts2 = refsText.split(',').map((s) => s.trim());
		const bad = parts2.filter((s) => !RefPattern.test(s));
		if (bad.length > 0) add('error', 'value', rel, `refs の形が違う: ${refsText}`);
		else info.refs = parts2.filter((s) => !s.includes(':'));
	}

	// 報告元の確認
	const from = get('from');
	const confirmed = get('confirmed');
	let confirmedOk = true;
	if (confirmed !== undefined && confirmed !== 'true' && confirmed !== 'false') {
		add('error', 'value', rel, `confirmed が true / false でない: ${confirmed}`);
		confirmedOk = false;
	}
	if (confirmedOk) {
		if (from !== undefined && confirmed === undefined) add('error', 'confirmed', rel, 'from があるのに confirmed が無い');
		else if (from !== undefined && state === '済' && confirmed !== 'true') add('error', 'confirmed', rel, '報告元の確認 (confirmed) が true でないのに済になっている');
		else if (from === undefined && confirmed !== undefined) add('warning', 'confirmed', rel, 'from が無いのに confirmed がある');
	}

	// やること
	let open = 0;
	parts.body.split('\n').forEach((line, index) => {
		const m = TodoLine.exec(line);
		if (m === null) return;
		const todoState = m[1];
		const lineNo = parts.bodyFirstLine + index;
		if (!(States as readonly string[]).includes(todoState)) {
			add('error', 'todo', rel, `${lineNo} 行目: やることの状態が 未 / 着手 / 済 のどれでもない: [${todoState}]`);
		} else if (todoState !== '済') {
			open++;
		}
	});
	if (state === '済' && open > 0) add('error', 'todo', rel, `済なのに、未・着手のやることが ${open} 件残っている`);

	// archived/ の中はすべて済
	if (entry.archived && get('state') !== '済') add('error', 'archived', rel, 'archived/ に、済でない課題がある');

	// グループ
	const group = get('group');
	if (groups !== null && group !== undefined && !groups.has(group)) add('warning', 'group', rel, `groups.txt に無いグループ: ${group}`);

	// キーの順と、知らないキー
	const known = pairs.map((p) => p.key).filter((k) => (KeyOrder as readonly string[]).includes(k));
	const expected = [...known].sort((a, b) => (KeyOrder as readonly string[]).indexOf(a) - (KeyOrder as readonly string[]).indexOf(b));
	if (known.join(',') !== expected.join(',')) add('warning', 'key-order', rel, `キーの順が決まりと違う (決まり: ${KeyOrder.join(' ・ ')})`);
	for (const p of pairs) {
		if (!(KeyOrder as readonly string[]).includes(p.key)) add('warning', 'unknown-key', rel, `知らないキー: ${p.key}`);
	}

	return info;
}

function refExists(root: string, ref: string, ids: Set<string>): boolean {
	if (ids.has(ref)) return true;
	for (const folder of RefFolders) {
		let names: string[];
		try {
			names = fs.readdirSync(path.join(root, ...folder.split('/')));
		} catch {
			continue;
		}
		if (names.some((n) => n.startsWith(ref + '-') || n.startsWith(ref + '.'))) return true;
	}
	return false;
}

/** プロジェクトの root を指して検査する。何も書き換えない */
export function checkProject(root: string): CheckResult {
	const findings: Finding[] = [];
	const add: Add = (level, code, file, message) => { findings.push({ level, code, file, message }); };

	const itemsDir = path.join(root, ...ItemsRel.split('/'));
	checkProjectId(itemsDir, add);
	const groups = readGroups(itemsDir, add);

	const entries = [
		...listMd(itemsDir, ItemsRel, false),
		...listMd(path.join(itemsDir, 'archived'), ItemsRel + '/archived', true),
	];
	const infos = entries.map((e) => checkIssueFile(e, groups, add));

	// 同じ id のファイルが複数ある (別の PC ・ クラウドで件名違いに立つと、git は競合を出さない)
	const byId = new Map<string, string[]>();
	for (const info of infos) {
		if (info.nameId === null) continue;
		byId.set(info.nameId, [...(byId.get(info.nameId) ?? []), info.rel]);
	}
	const ids = new Set(byId.keys());
	for (const [id, files] of byId) {
		if (files.length > 1) add('error', 'duplicate', files[0], `同じ id ${id} のファイルが ${files.length} 個ある: ${files.map((f) => path.basename(f)).join(' ・ ')}`);
	}

	// refs の参照先
	for (const info of infos) {
		for (const ref of info.refs) {
			if (!refExists(root, ref, ids)) add('warning', 'refs', info.rel, `refs の参照先が見つからない: ${ref}`);
		}
	}

	findings.sort((a, b) => {
		if (a.file !== b.file) return a.file < b.file ? -1 : 1;
		if (a.level !== b.level) return a.level === 'error' ? -1 : 1;
		return a.code < b.code ? -1 : a.code > b.code ? 1 : 0;
	});

	return {
		findings,
		issues: entries.length,
		archived: entries.filter((e) => e.archived).length,
	};
}
