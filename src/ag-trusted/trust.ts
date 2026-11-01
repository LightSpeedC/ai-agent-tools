/*
	ag-trusted: agy の settings.json の trustedWorkspaces に、フォルダを書き足す。

	書き方は、文字列としての挿入。配列に 1 行だけ足し、ほかの部分 (承認した許可のリスト等) は
	1 バイトも変えない。agy 自身が承認のたびにこのファイルを書き換えるため、JSON を作り直して
	書き戻す形にはしない (その間に agy が書いた分を消すおそれがある)。

	計画: notes/10_plan/i261101-02-ag-cmdと起動の共通部.html (83-B)
*/

import * as fs from 'node:fs';
import * as crypto from 'node:crypto';

const Key = 'trustedWorkspaces';

// ---- JSON の文字列としての走査 (値を取り出さず、位置だけを数える) ----

function skipWs(t: string, i: number): number {
	while (i < t.length && /\s/.test(t[i])) { i++; }
	return i;
}

/** t[i] が引用符の文字列の始まり。終わりの次の位置を返す */
function skipString(t: string, i: number): number {
	i++;
	while (i < t.length) {
		const c = t[i];
		if (c === '\\') { i += 2; continue; }
		if (c === '"') { return i + 1; }
		i++;
	}
	throw new Error('文字列が閉じていません');
}

/** 値 (文字列 ・ 入れ子 ・ 数 ・ 真偽値 ・ null) の終わりの次の位置を返す */
function skipValue(t: string, i: number): number {
	const c = t[i];
	if (c === '"') { return skipString(t, i); }
	if (c === '{' || c === '[') {
		let depth = 0;
		for (; i < t.length; i++) {
			const d = t[i];
			if (d === '"') { i = skipString(t, i) - 1; continue; }
			if (d === '{' || d === '[') { depth++; }
			else if (d === '}' || d === ']') {
				depth--;
				if (depth === 0) { return i + 1; }
			}
		}
		throw new Error('括弧が閉じていません');
	}
	while (i < t.length && !/[,\]}\s]/.test(t[i])) { i++; }
	return i;
}

interface Member {
	key: string;
	keyStart: number;
	valueStart: number;
	valueEnd: number;
}

/** 最上位のオブジェクトのメンバーの位置。open は { の位置、close は } の位置 */
function rootMembers(t: string): { members: Member[]; open: number; close: number } {
	let i = skipWs(t, t.charCodeAt(0) === 0xfeff ? 1 : 0);
	if (t[i] !== '{') { throw new Error('最上位がオブジェクトではありません'); }
	const open = i;
	i++;
	const members: Member[] = [];
	for (;;) {
		i = skipWs(t, i);
		if (t[i] === '}') { return { members, open, close: i }; }
		if (t[i] !== '"') { throw new Error('キーの位置が読めません'); }
		const keyStart = i;
		const keyEnd = skipString(t, i);
		const key = JSON.parse(t.slice(keyStart, keyEnd)) as string;
		i = skipWs(t, keyEnd);
		if (t[i] !== ':') { throw new Error('キーの後ろに : がありません'); }
		i = skipWs(t, i + 1);
		const valueStart = i;
		const valueEnd = skipValue(t, i);
		members.push({ key, keyStart, valueStart, valueEnd });
		i = skipWs(t, valueEnd);
		if (t[i] === ',') { i++; }
	}
}

/** 配列の要素の位置 */
function arrayElements(t: string, m: Member): { start: number; end: number }[] {
	if (t[m.valueStart] !== '[') { throw new Error(Key + ' が配列ではありません'); }
	const out: { start: number; end: number }[] = [];
	let i = m.valueStart + 1;
	for (;;) {
		i = skipWs(t, i);
		if (t[i] === ']') { return out; }
		const start = i;
		const end = skipValue(t, i);
		out.push({ start, end });
		i = skipWs(t, end);
		if (t[i] === ',') { i++; }
	}
}

/** その位置を含む行の、行頭の空白 */
function lineIndent(t: string, pos: number): string {
	const ls = t.lastIndexOf('\n', pos - 1) + 1;
	return /^[ \t]*/.exec(t.slice(ls))![0];
}

const Unit = '  ';

/**
 * text の trustedWorkspaces に dir を 1 つ足した text を返す。
 * すでに完全一致 (大小も区別) であれば、changed を false にして、そのまま返す。
 * JSON として読めないとき、trustedWorkspaces が配列でないときは、例外
 */
export function addTrustedWorkspace(text: string, dir: string): { text: string; changed: boolean } {
	JSON.parse(text.charCodeAt(0) === 0xfeff ? text.slice(1) : text);
	const eol = text.includes('\r\n') ? '\r\n' : '\n';
	const json = JSON.stringify(dir);
	const { members, open, close } = rootMembers(text);
	const target = members.find((m) => m.key === Key);

	if (target != null) {
		const elements = arrayElements(text, target);
		for (const e of elements) {
			if (JSON.parse(text.slice(e.start, e.end)) === dir) { return { text, changed: false }; }
		}
		if (elements.length > 0) {
			const last = elements[elements.length - 1];
			const indent = lineIndent(text, last.start);
			return { text: text.slice(0, last.end) + ',' + eol + indent + json + text.slice(last.end), changed: true };
		}
		const keyIndent = lineIndent(text, target.keyStart);
		const opened = '[' + eol + keyIndent + Unit + json + eol + keyIndent + ']';
		return { text: text.slice(0, target.valueStart) + opened + text.slice(target.valueEnd), changed: true };
	}

	if (members.length > 0) {
		const last = members[members.length - 1];
		const indent = lineIndent(text, last.keyStart);
		const added = ',' + eol + indent + JSON.stringify(Key) + ': [' + eol + indent + Unit + json + eol + indent + ']';
		return { text: text.slice(0, last.valueEnd) + added + text.slice(last.valueEnd), changed: true };
	}

	const body = '{' + eol + Unit + JSON.stringify(Key) + ': [' + eol + Unit + Unit + json + eol + Unit + ']' + eol + '}';
	return { text: text.slice(0, open) + body + text.slice(close + 1), changed: true };
}

// ---- ファイルへの書き込み ----

export interface EnsureResult {
	status: 'added' | 'already' | 'no-file' | 'broken' | 'busy';
	backup?: string;
}

export interface EnsureHooks {
	/** 書く直前に呼ぶ。試験が、読んだあとの別の書き込みを真似るため */
	beforeWrite?: (attempt: number) => void;
}

const MaxTries = 3;

function stamp(now: Date): string {
	const p = (n: number): string => String(n).padStart(2, '0');
	return String(now.getFullYear()) + p(now.getMonth() + 1) + p(now.getDate()) + '-' + p(now.getHours()) + p(now.getMinutes()) + p(now.getSeconds());
}

/**
 * file の trustedWorkspaces に dir があるようにする。
 * ・無ければ作らない (agy の初回の設定を邪魔しない)。壊れていれば書かない
 * ・書くのは、未登録のときだけ。書く前に控え (file.backup-<日時>) を取る
 * ・読んだあとに中身が変わっていたら、読み直す。最大 3 回で諦め、書かずに busy を返す
 */
export function ensureTrusted(file: string, dir: string, hooks: EnsureHooks = {}): EnsureResult {
	for (let attempt = 1; attempt <= MaxTries; attempt++) {
		let text: string;
		try {
			text = fs.readFileSync(file, 'utf8');
		} catch {
			return { status: 'no-file' };
		}
		let r: { text: string; changed: boolean };
		try {
			r = addTrustedWorkspace(text, dir);
		} catch {
			return { status: 'broken' };
		}
		if (!r.changed) { return { status: 'already' }; }

		hooks.beforeWrite?.(attempt);
		// 書く直前に見直す。読んだあとに、別のもの (agy) が書き換えていたら、やり直す
		if (fs.readFileSync(file, 'utf8') !== text) { continue; }

		let backup = file + '.backup-' + stamp(new Date());
		for (let n = 2; fs.existsSync(backup); n++) { backup = file + '.backup-' + stamp(new Date()) + '-' + n; }
		fs.copyFileSync(file, backup);

		const temp = file + '.' + crypto.randomUUID().replace(/-/g, '') + '.tmp';
		fs.writeFileSync(temp, r.text);
		try {
			fs.renameSync(temp, file);
		} catch (e) {
			try { fs.unlinkSync(temp); } catch { /* 消せなくても元は無事 */ }
			throw e;
		}
		return { status: 'added', backup };
	}
	return { status: 'busy' };
}
