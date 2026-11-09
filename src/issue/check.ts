/*
	issue check: 課題ファイルと project-id.txt を検査する（読み取り専用）。
	仕様は notes/50_spec/課題ファイルの形と検査.html、決めた経緯は計画 p261103-01。
*/
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { KeyOrder, States, parsePairs, splitIssue } from './meta.ts';
import { OldIdFileName, UuidFileName, mainFolderName } from './numbers.ts';

export type Level = 'error' | 'warning';
export type Finding = { level: Level; code: string; file: string; message: string };
/** 状態のフォルダ。todo = 未、doing = 着手、done = 済、archived = グループごと片付いて退避した済 */
export const Folders = ['todo', 'doing', 'done', 'archived'] as const;
export type Folder = (typeof Folders)[number];

export type CheckResult = {
	findings: Finding[];
	/** 4 つのフォルダの課題の合計 */
	issues: number;
	todo: number;
	doing: number;
	done: number;
	archived: number;
	/** decisions/ の決定の件数 (計画 p261108-01) */
	decisions: number;
};

/** プロジェクトの root からの、決定の置き場 (計画 p261108-01) */
export const DecisionsRel = 'notes/40_issues/decisions';
/** 決定の id: 親の番号 (課題 i ・ 計画 p ・ 調査 r) + -d + 10 進数の連番 (1 から。桁はそろえない) */
export const DecisionIdPattern = /^([ipr]\d{6}-[0-9a-kLm-z]{2})-d([1-9]\d*)$/;
export const DecisionNamePattern = /^([ipr]\d{6}-[0-9a-kLm-z]{2}-d[1-9]\d*)-(.+)\.md$/;
/** 決定の親になれる番号 */
export const ParentPattern = /^[ipr]\d{6}-[0-9a-kLm-z]{2}$/;
/** 決定のメタ情報のキーの順 */
export const DecisionKeyOrder = ['schema', 'id', 'title', 'parent', 'decided', 'chosen', 'refs', 'replaces', 'legacy_ids'] as const;
const DecisionRequired = ['schema', 'id', 'title', 'parent', 'decided', 'chosen'] as const;
/**
 * 決定の refs ・ replaces の 1 つ。別プロジェクトは :名前:番号 (153-A) か 名前:番号。
 * 番号は、課題 ・ 計画 ・ 調査か、決定 (-dN 付き)
 */
export const DecisionRefPattern = /^(?::[A-Za-z0-9_.-]+:|[A-Za-z0-9_.-]+:)?([a-z]\d{6}-[0-9a-kLm-z]{2}(?:-d[1-9]\d*)?)$/;
/** 旧番号: :プロジェクト名:旧番号 */
export const LegacyIdPattern = /^:[A-Za-z0-9_.-]+:[^\s,:]+$/;
/** 案の行: - X: 文 (X は英大文字 1 字) */
export const OptionLine = /^- ([A-Z]): (.*)$/;

/** プロジェクトの root からの、課題の置き場 */
export const ItemsRel = 'notes/40_issues/items';

/** <id>-<件名>.md。連番は 36 進数 2 桁で、英字は小文字、l は大文字の L */
export const NamePattern = /^(i\d{6}-[0-9a-kLm-z]{2})-(.+)\.md$/;
export const IdPattern = /^i\d{6}-[0-9a-kLm-z]{2}$/;
/** 件名に使える文字: 英数字 ・ ハイフン ・ 下線 ・ ピリオド ・ ひらがな ・ カタカナ ・ 漢字 */
export const SlugPattern = /^[0-9A-Za-z_.\-ぁ-ゖァ-ヺー々㐀-䶿一-鿿]+$/;
export const SlugMax = 30;
export const ProjectIdPattern = /^[0-9a-f]{32}$/;
/** 番号 (課題 ・ 計画 ・ 調査)。ほかのプロジェクトの番号は「プロジェクト名:番号」 */
export const RefPattern = /^(?:[A-Za-z0-9_.-]+:)?([a-z]\d{6}-[0-9a-kLm-z]{2})$/;
/** やることの行。直後に ( が続くものは、リンクの列挙 (- [文](先)) なので含めない */
export const TodoLine = /^\s*- \[([^\]]*)\](?!\()/;
const Required = ['schema', 'id', 'title', 'group', 'created'] as const;
/** refs の参照先を探す、notes/ の下のフォルダ（ファイル名の先頭が番号） */
const RefFolders = ['notes/01_research', 'notes/02_ideas', 'notes/10_plan'];

type Add = (level: Level, code: string, file: string, message: string) => void;
type Entry = { rel: string; abs: string; folder: Folder };
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

/** フォルダ直下の .md の名前 (並べ替え済み)。フォルダが無ければ空 */
export function listMdNames(dir: string): string[] {
	try {
		return fs.readdirSync(dir, { withFileTypes: true })
			.filter((e) => e.isFile() && e.name.toLowerCase().endsWith('.md'))
			.map((e) => e.name)
			.sort();
	} catch {
		return [];
	}
}

/** 状態のフォルダ以外にある .md (items/ 直下と、4 つ以外のフォルダの直下)。置き場の誤り */
function findMisplaced(itemsDir: string): string[] {
	const rels: string[] = [];
	for (const name of listMdNames(itemsDir)) rels.push(ItemsRel + '/' + name);
	let subdirs: string[];
	try {
		subdirs = fs.readdirSync(itemsDir, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name).sort();
	} catch {
		return rels;
	}
	for (const sub of subdirs) {
		if ((Folders as readonly string[]).includes(sub)) continue;
		for (const name of listMdNames(path.join(itemsDir, sub))) rels.push(ItemsRel + '/' + sub + '/' + name);
	}
	return rels;
}

/** project-uuid.txt (schema 2) を検査する (p261109-01 の 207-A ・ 208-A)。無ければ古い project-id.txt を検査し、移すよう促す */
function checkProjectId(root: string, itemsDir: string, add: Add): void {
	const newRel = ItemsRel + '/' + UuidFileName;
	let newText: string | null = null;
	try {
		newText = fs.readFileSync(path.join(itemsDir, UuidFileName), 'utf8');
	} catch {
		// 無ければ古いほうを見る
	}
	if (newText !== null) {
		const text = normalize(newText, newRel, add).replace(/\n+$/, '');
		const parsed = parsePairs(text.split('\n'), 1);
		for (const p of parsed.problems) add('error', 'project-uuid', newRel, p);
		const get = (k: string): string | undefined => parsed.pairs.find((p) => p.key === k)?.value;
		const schema = get('schema');
		if (schema !== '2') add('error', 'project-uuid', newRel, schema === undefined ? 'schema が無い' : `schema が 2 でない: ${schema}`);
		const uuid = get('project_uuid');
		if (uuid === undefined) {
			if (!parsed.brokenKeys.has('project_uuid')) add('error', 'project-uuid', newRel, 'project_uuid が無い');
		} else if (!ProjectIdPattern.test(uuid)) {
			add('error', 'project-uuid', newRel, 'project_uuid が小文字 32 桁の 16 進数でない');
		}
		const id = get('project_id');
		if (id === undefined) {
			if (!parsed.brokenKeys.has('project_id')) add('error', 'project-uuid', newRel, 'project_id (フォルダ名) が無い');
		} else {
			const folder = mainFolderName(root);
			if (id !== folder) add('warning', 'project-uuid', newRel, `project_id (${id}) がフォルダ名 (${folder}) と違う (改名したなら、旧名を legacy_names に残して直す)`);
		}
		for (const p of parsed.pairs) {
			if (!['schema', 'project_uuid', 'project_id', 'legacy_names'].includes(p.key)) add('warning', 'unknown-key', newRel, `知らないキー: ${p.key}`);
		}
		if (fs.existsSync(path.join(itemsDir, OldIdFileName))) add('warning', 'project-uuid', ItemsRel + '/' + OldIdFileName, `${UuidFileName} があるので、古い ${OldIdFileName} は消す`);
		return;
	}

	const rel = ItemsRel + '/' + OldIdFileName;
	let text: string;
	try {
		text = fs.readFileSync(path.join(itemsDir, OldIdFileName), 'utf8');
	} catch {
		add('error', 'project-uuid', newRel, `${UuidFileName} が無い (issue init で作る)`);
		return;
	}
	add('warning', 'project-uuid', rel, `古い形の ${OldIdFileName}。issue init で ${UuidFileName} に移す`);
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

	// 状態はフォルダで持つ (126-A)。state キーが残っていれば誤り
	if (get('state') !== undefined || parts.parsed.brokenKeys.has('state')) {
		add('error', 'state-key', rel, 'state キーは持たない (状態は todo/ ・ doing/ ・ done/ ・ archived/ のフォルダで持つ)');
	}
	/** 済 (done/ と、退避した archived/)。やることが残っていない・報告元の確認が済んでいることを要る */
	const isDone = entry.folder === 'done' || entry.folder === 'archived';

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
		else if (from !== undefined && isDone && confirmed !== 'true') add('error', 'confirmed', rel, `報告元の確認 (confirmed) が true でないのに ${entry.folder}/ にある (済にできない)`);
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
	if (isDone && open > 0) add('error', 'todo', rel, `${entry.folder}/ にあるのに、未・着手のやることが ${open} 件残っている`);

	// グループ
	const group = get('group');
	if (groups !== null && group !== undefined && !groups.has(group)) add('warning', 'group', rel, `groups.txt に無いグループ: ${group}`);

	// キーの順と、知らないキー
	const known = pairs.map((p) => p.key).filter((k) => (KeyOrder as readonly string[]).includes(k));
	const expected = [...known].sort((a, b) => (KeyOrder as readonly string[]).indexOf(a) - (KeyOrder as readonly string[]).indexOf(b));
	if (known.join(',') !== expected.join(',')) add('warning', 'key-order', rel, `キーの順が決まりと違う (決まり: ${KeyOrder.join(' ・ ')})`);
	for (const p of pairs) {
		// state は、上で state-key として誤りにしてある
		if (p.key !== 'state' && !(KeyOrder as readonly string[]).includes(p.key)) add('warning', 'unknown-key', rel, `知らないキー: ${p.key}`);
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

/** decisions/ の決定を検査し、件数を返す。issueIds は、課題の id (親 ・ refs の参照先を探す) */
function checkDecisions(root: string, issueIds: Set<string>, add: Add): number {
	const dir = path.join(root, ...DecisionsRel.split('/'));
	let entries: fs.Dirent[];
	try {
		entries = fs.readdirSync(dir, { withFileTypes: true });
	} catch {
		return 0;
	}
	// 下のフォルダに置いた .md は、置き場の誤り
	for (const sub of entries.filter((e) => e.isDirectory()).map((e) => e.name).sort()) {
		for (const name of listMdNames(path.join(dir, sub))) {
			add('error', 'place', `${DecisionsRel}/${sub}/${name}`, '決定は decisions/ の直下に置く');
		}
	}
	const names = listMdNames(dir);
	type Info = { rel: string; id: string | null; parent: string | null; refs: string[]; replaces: string[] };
	const infos: Info[] = [];
	for (const name of names) {
		const rel = `${DecisionsRel}/${name}`;
		const info: Info = { rel, id: null, parent: null, refs: [], replaces: [] };
		infos.push(info);
		const nameMatch = DecisionNamePattern.exec(name);
		if (nameMatch === null) {
			add('error', 'name', rel, 'ファイル名が <親の番号>-d<連番>-<件名>.md の形でない');
			continue;
		}
		info.id = nameMatch[1];
		const slug = nameMatch[2];
		if (!SlugPattern.test(slug)) add('error', 'name', rel, '件名に使えない文字がある (英数字 ・ - ・ _ ・ . ・ 日本語だけ。空白は不可)');
		else if ([...slug].length > SlugMax) add('warning', 'slug-long', rel, `件名が ${SlugMax} 文字を超えている`);

		let text: string;
		try {
			text = fs.readFileSync(path.join(dir, name), 'utf8');
		} catch {
			add('error', 'meta', rel, 'ファイルを読めない');
			continue;
		}
		text = normalize(text, rel, add);
		const parts = splitIssue(text);
		if (parts.broken) {
			for (const p of parts.problems) add('error', 'meta', rel, p);
			continue;
		}
		for (const p of parts.parsed.problems) add('error', 'meta', rel, p);
		const pairs = parts.parsed.pairs;
		const get = (k: string): string | undefined => pairs.find((p) => p.key === k)?.value;
		for (const key of DecisionRequired) {
			if (get(key) === undefined && !parts.parsed.brokenKeys.has(key)) add('error', 'key', rel, `必須の ${key} が無い`);
		}
		const schema = get('schema');
		if (schema !== undefined && schema !== '1') add('error', 'value', rel, `schema が 1 でない: ${schema}`);
		const id = get('id');
		if (id !== undefined) {
			if (!DecisionIdPattern.test(id)) add('error', 'value', rel, `id の形が違う: ${id}`);
			else if (id !== info.id) add('error', 'value', rel, `id がファイル名の先頭と違う: ${id}`);
		}
		const parent = get('parent');
		if (parent !== undefined) {
			const ownParent = DecisionIdPattern.exec(info.id ?? '')?.[1];
			if (!ParentPattern.test(parent)) add('error', 'value', rel, `parent の形が違う: ${parent}`);
			else if (parent !== ownParent) add('error', 'value', rel, `parent が id の -d より前と違う: ${parent}`);
			else info.parent = parent;
		}
		const decided = get('decided');
		if (decided !== undefined && !isRealDate(decided)) add('error', 'value', rel, `decided が実在する yyyy-mm-dd でない: ${decided}`);
		const chosen = get('chosen');
		if (chosen !== undefined) {
			// 複数の案を選べる (217-A。A,C)
			const picked = chosen.split(',');
			const keys = new Set(parts.body.split('\n').map((line) => OptionLine.exec(line)?.[1]).filter((k) => k !== undefined));
			if (picked.some((c) => !/^[A-Z]$/.test(c)) || new Set(picked).size !== picked.length) add('error', 'value', rel, `chosen が英大文字 1 字 (複数はカンマで区切る) でない: ${chosen}`);
			else for (const c of picked.filter((c) => !keys.has(c))) {
				add('error', 'chosen', rel, `chosen の案 (- ${c}: …) が本文に無い`);
			}
		}
		const list = (key: string, pattern: RegExp): string[] => {
			const value = get(key);
			if (value === undefined) return [];
			const items = value.split(',').map((s) => s.trim());
			if (items.some((s) => !pattern.test(s))) {
				add('error', 'value', rel, `${key} の形が違う: ${value}`);
				return [];
			}
			return items.filter((s) => !s.includes(':'));
		};
		info.refs = list('refs', DecisionRefPattern);
		info.replaces = list('replaces', DecisionRefPattern);
		list('legacy_ids', LegacyIdPattern);

		const order = DecisionKeyOrder as readonly string[];
		const known = pairs.map((p) => p.key).filter((k) => order.includes(k));
		const expected = [...known].sort((a, b) => order.indexOf(a) - order.indexOf(b));
		if (known.join(',') !== expected.join(',')) add('warning', 'key-order', rel, `キーの順が決まりと違う (決まり: ${DecisionKeyOrder.join(' ・ ')})`);
		for (const p of pairs) {
			if (!order.includes(p.key)) add('warning', 'unknown-key', rel, `知らないキー: ${p.key}`);
		}
	}

	// 同じ id のファイルが複数ある (別の PC で、同じ親へ同時に足したとき)
	const byId = new Map<string, string[]>();
	for (const info of infos) {
		if (info.id === null) continue;
		byId.set(info.id, [...(byId.get(info.id) ?? []), info.rel]);
	}
	for (const [id, files] of byId) {
		if (files.length > 1) add('error', 'duplicate', files[0], `同じ id ${id} のファイルが ${files.length} 個ある: ${files.map((f) => path.basename(f)).join(' ・ ')}`);
	}

	// 親 ・ refs ・ replaces の参照先 (同じプロジェクトの中だけ)
	const decisionIds = new Set(byId.keys());
	const found = (ref: string): boolean => (DecisionIdPattern.test(ref) ? decisionIds.has(ref) : refExists(root, ref, issueIds));
	for (const info of infos) {
		if (info.parent !== null && !found(info.parent)) add('warning', 'refs', info.rel, `親が見つからない: ${info.parent}`);
		for (const ref of info.refs) if (!found(ref)) add('warning', 'refs', info.rel, `refs の参照先が見つからない: ${ref}`);
		for (const ref of info.replaces) if (!found(ref)) add('warning', 'refs', info.rel, `replaces の参照先が見つからない: ${ref}`);
	}
	return names.length;
}

/** Git の管理外であってほしいもの (root からの相対パス)。末尾が / のものは、中に作られるもののパスで調べる */
const GitIgnoreTargets = ['notes/40_issues/_issues.html'];

/**
 * `git check-ignore` で、管理外になっていないものを返す (表示は、末尾の / を除いた名前)。
 * git の管理の外 ・ git が無い ・ 調べられないときは、何も返さない (見られないので警告しない)
 */
function notIgnoredByGit(root: string, targets: string[]): string[] {
	const result: string[] = [];
	for (const target of targets) {
		// フォルダは、中に作られるもののパスで調べる (フォルダ自体の除外と、中身の除外は同じ _* で決まる)
		const probe = target.endsWith('/') ? target + 'i000000-00' : target;
		const r = spawnSync('git', ['check-ignore', '-q', '--', probe], { cwd: root, timeout: 15000 });
		if (r.error !== undefined || r.status === null) return [];
		if (r.status === 1) result.push(target.endsWith('/') ? path.posix.basename(target.slice(0, -1)) + '/' : path.posix.basename(target));
		else if (r.status !== 0) return [];
	}
	return result;
}

/** プロジェクトの root を指して検査する。何も書き換えない */
export function checkProject(root: string): CheckResult {
	const findings: Finding[] = [];
	const add: Add = (level, code, file, message) => { findings.push({ level, code, file, message }); };

	const itemsDir = path.join(root, ...ItemsRel.split('/'));
	checkProjectId(root, itemsDir, add);
	const groups = readGroups(itemsDir, add);

	// 置き場の誤り: items/ 直下と、4 つ以外のフォルダの .md
	for (const rel of findMisplaced(itemsDir)) {
		add('error', 'place', rel, '課題は todo/ ・ doing/ ・ done/ ・ archived/ のどれかのフォルダに置く');
	}

	const entries: Entry[] = [];
	for (const folder of Folders) {
		for (const name of listMdNames(path.join(itemsDir, folder))) {
			entries.push({ rel: `${ItemsRel}/${folder}/${name}`, abs: path.join(itemsDir, folder, name), folder });
		}
	}
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

	const decisions = checkDecisions(root, ids, add);

	// 生成物 (_issues.html) は、先頭 _ の決まりで Git から外れている前提 (番号の予約は、ホームの下に置く。p261109-01)
	const notIgnored = notIgnoredByGit(root, GitIgnoreTargets);
	if (notIgnored.length > 0) {
		add('warning', 'gitignore', '.gitignore', `${notIgnored.join(' ・ ')} が Git の管理外になっていない (.gitignore に _* を足す)`);
	}

	findings.sort((a, b) => {
		if (a.file !== b.file) return a.file < b.file ? -1 : 1;
		if (a.level !== b.level) return a.level === 'error' ? -1 : 1;
		return a.code < b.code ? -1 : a.code > b.code ? 1 : 0;
	});

	const count = (folder: Folder): number => entries.filter((e) => e.folder === folder).length;
	return {
		findings,
		issues: entries.length,
		todo: count('todo'),
		doing: count('doing'),
		done: count('done'),
		archived: count('archived'),
		decisions,
	};
}
