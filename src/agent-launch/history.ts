/*
	cc ・ cx ・ ag の共通部: そのフォルダに、そのエージェントの履歴があるか。
	読み取りのみ。会話の中身は読まない (置き場の構造だけで判定する)。

	  cc (claude): ~/.claude/projects/<符号化したパス>/ に *.jsonl が 1 つ以上
	  ag (agy)   : ~/.gemini/antigravity-cli/cache/last_conversations.json にフォルダのキーがあり、
	               会話の .db (conversations/<ID>.db) も在る
	  cx (codex) : ~/.codex/state_5.sqlite の threads 表に、cwd がそのフォルダで archived = 0 の行がある

	W: は C:\work と同じ場所 (subst)。エージェントによって、どちらの形でパスを残すかが違う
	(実データ: claude と agy は W: の形も C:\work の形も、codex は \\?\C:\work の形) ので、両方の形を見る。
	ホームのフォルダは引数で受ける (試験が一時のフォルダを渡せる)。

	計画: notes/10_plan/i261101-02-ag-cmdと起動の共通部.html
*/

import * as fs from 'node:fs';
import * as path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

export type Agent = 'cc' | 'cx' | 'ag';

/**
 * 同じ場所を指す、W: の形と C:\work の形を返す。それ以外のパスは、そのまま 1 つ。
 * 末尾の区切りと、\\?\ の接頭辞は落とす
 */
export function pathForms(dir: string): string[] {
	let p = dir.replace(/\//g, '\\');
	if (p.startsWith('\\\\?\\')) { p = p.slice(4); }
	p = p.replace(/\\+$/, '');
	const m = /^w:\\(.+)$/i.exec(p) ?? /^c:\\work\\(.+)$/i.exec(p);
	if (m == null) { return [p]; }
	return ['W:\\' + m[1], 'C:\\work\\' + m[1]];
}

/**
 * claude がパスから作る、履歴のフォルダ名。実データの形 (W:\2026\<名前> → W--2026-<名前>) で確かめた。
 * 英数字以外はすべて - にする、は仮定 (実データに _ ・ . ・ 日本語を含むものが無く、確かめていない)
 */
export function encodeClaudeDir(dir: string): string {
	return Array.from(dir).map((ch) => (/[A-Za-z0-9]/.test(ch) ? ch : '-')).join('');
}

function normalize(p: string): string {
	let q = p.replace(/\//g, '\\');
	if (q.startsWith('\\\\?\\')) { q = q.slice(4); }
	return q.replace(/\\+$/, '').toLowerCase();
}

function claudeHistory(forms: string[], home: string): boolean {
	for (const form of forms) {
		const d = path.join(home, '.claude', 'projects', encodeClaudeDir(form));
		try {
			if (fs.readdirSync(d).some((f) => f.endsWith('.jsonl'))) { return true; }
		} catch {
			// フォルダが無い
		}
	}
	return false;
}

function agyHistory(forms: string[], home: string): boolean {
	const base = path.join(home, '.gemini', 'antigravity-cli');
	let table: Record<string, unknown>;
	try {
		table = JSON.parse(fs.readFileSync(path.join(base, 'cache', 'last_conversations.json'), 'utf8')) as Record<string, unknown>;
	} catch {
		return false;
	}
	const wanted = new Set(forms.map(normalize));
	for (const [key, id] of Object.entries(table)) {
		if (!wanted.has(normalize(key)) || typeof id !== 'string') { continue; }
		if (fs.existsSync(path.join(base, 'conversations', id + '.db'))) { return true; }
	}
	return false;
}

function codexHistory(forms: string[], home: string): boolean {
	const file = path.join(home, '.codex', 'state_5.sqlite');
	if (!fs.existsSync(file)) { return false; }
	let db: DatabaseSync | null = null;
	try {
		db = new DatabaseSync(file, { readOnly: true });
		const wanted = new Set(forms.map(normalize));
		const rows = db.prepare('select cwd from threads where archived = 0').all() as { cwd: string }[];
		return rows.some((r) => wanted.has(normalize(r.cwd)));
	} catch {
		return false;
	} finally {
		try { db?.close(); } catch { /* 閉じられなくても読み取りのみ */ }
	}
}

export function hasHistory(agent: Agent, dir: string, home: string): boolean {
	const forms = pathForms(dir);
	switch (agent) {
		case 'cc': return claudeHistory(forms, home);
		case 'ag': return agyHistory(forms, home);
		case 'cx': return codexHistory(forms, home);
	}
}
