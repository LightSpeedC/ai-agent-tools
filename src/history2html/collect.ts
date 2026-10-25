/*
	会話ログ（JSONL）を読み、依頼ごとにまとめる（計画 p261014-01 の第 2 章）。

	**載せる記録を名指しし、それ以外はすべて捨てる。**捨てるものを並べる形にすると、
	Claude Code の更新で新しい種類の記録が増えたとき、既定で載ってしまう。

	  載せる   人の発言 ・ AI の本文 ・ ツールの名前と 1 行の要約（決めたこと 14-A）
	           セッションの題 ・ compact の区切り（線だけ）
	  捨てる   attachment（system-reminder ・ ルールの全文 ・ メールアドレスが入る）・ 思考 ・ ツールの結果
	           isMeta ・ isSidechain ・ 通知の中身 ・ ローカルコマンド ・ compact の要約 ・ 知らない種類

	読むのはフォルダ直下の *.jsonl だけ。下のフォルダ（<セッション>/subagents/）は
	サブエージェントの記録なので読まない。
*/

import * as fs from 'node:fs';
import * as path from 'node:path';

/** 応答の 1 件。a = AI の本文、u = ツール、m = 印（中断） */
export type Item =
	| { k: 'a'; ts: number; x: string }
	| { k: 'u'; ts: number; n: string; x: string; id?: string; e?: 1 }
	| { k: 'm'; ts: number; x: string };

/** 依頼の 1 件。p = 人の発言、n = 人の発言なしで始まる応答（通知 ・ 定期実行 ・ 続き）、c = compact の区切り */
export type Turn = {
	k: 'p' | 'n' | 'c';
	ts: number;
	session: number;
	/** p は発言の本文、n は印の名前（通知 ・ 定期実行 ・ 続き） */
	x: string;
	items: Item[];
	/** 並べ替えで、同じ時刻のときに読んだ順を保つため */
	seq: number;
};

export type Session = { title: string | null; firstTs: number };

export type Collected = {
	sessions: Session[];
	turns: Turn[];
	files: number;
	badLines: number;
};

/** 人の発言でない、Claude Code が差し込む本文。先頭のタグで見分ける */
const SystemPrefixes = ['<task-notification', '<command-name', '<command-message', '<command-args', '<local-command-', '<bash-input', '<bash-stdout', '<bash-stderr', '<user-memory-input'];

const Interrupted = /^\[Request interrupted by user/;

/** 本文の中に差し込まれた system-reminder を除く */
function stripReminders(s: string): string {
	return s.replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, '').trim();
}

/** user の記録の中身を、本文の文字列 ・ 画像の数 ・ ツールの結果に分ける */
function userParts(content: unknown): { text: string; images: number; results: { id: string; error: boolean }[] } {
	if (typeof content === 'string') { return { text: content, images: 0, results: [] }; }
	const texts: string[] = [];
	let images = 0;
	const results: { id: string; error: boolean }[] = [];
	if (Array.isArray(content)) {
		for (const b of content) {
			if (b == null || typeof b !== 'object') { continue; }
			if (b.type === 'text' && typeof b.text === 'string') { texts.push(b.text); }
			else if (b.type === 'image') { images++; }
			else if (b.type === 'tool_result') { results.push({ id: String(b.tool_use_id ?? ''), error: b.is_error === true }); }
		}
	}
	return { text: texts.join('\n'), images, results };
}

/** 1 行目を 200 字まで。続きがあれば「…」 */
function firstLine(s: string): string {
	const lines = s.split(/\r?\n/);
	let head = lines[0];
	let more = lines.length > 1 && lines.slice(1).some((l) => l.trim().length > 0);
	if (head.length > 200) { head = head.slice(0, 200); more = true; }
	return more ? head + ' …' : head;
}

/*
	ツールの 1 行の要約（決めたこと 14-A）。**中身（読んだ ・ 書いた ・ 当たった行）は出さない。**
	出すのは何をしたかが分かる最小限: コマンドの 1 行目 ・ パス ・ 検索語 ・ URL。
	表に無いツールは名前だけ
*/
export function summarize(name: string, input: any): string {
	const i = input ?? {};
	const str = (v: unknown) => (typeof v === 'string' ? v : '');
	switch (name) {
		case 'Bash':
		case 'PowerShell':
			return firstLine(str(i.command));
		case 'Read': {
			let s = str(i.file_path);
			const off = typeof i.offset === 'number' ? i.offset : null;
			const lim = typeof i.limit === 'number' ? i.limit : null;
			if (off != null && lim != null) { s += ' (' + off + '〜' + (off + lim - 1) + ' 行)'; }
			else if (off != null) { s += ' (' + off + ' 行目から)'; }
			else if (lim != null) { s += ' (' + lim + ' 行まで)'; }
			return s;
		}
		case 'Edit':
		case 'Write':
		case 'MultiEdit':
			return str(i.file_path);
		case 'NotebookEdit':
			return str(i.notebook_path);
		case 'Grep':
		case 'Glob':
			return firstLine(str(i.pattern)) + (str(i.path) ? ' (' + str(i.path) + ')' : '');
		case 'WebFetch':
			return str(i.url);
		case 'WebSearch':
			return firstLine(str(i.query));
		case 'Agent':
		case 'Task':
			return firstLine(str(i.description));
		default:
			return '';
	}
}

/** 人の発言なしで始まる応答の印の名前 */
function triggerName(o: any, text: string): string | null {
	if (o.origin?.kind === 'task-notification' || text.trimStart().startsWith('<task-notification')) { return '通知'; }
	if (o.scheduledTaskId != null || o.scheduledFireId != null) { return '定期実行'; }
	return null;
}

export function collect(dir: string): Collected {
	const names = fs.readdirSync(dir, { withFileTypes: true })
		.filter((e) => e.isFile() && e.name.toLowerCase().endsWith('.jsonl'))
		.map((e) => e.name)
		.sort();

	const seen = new Set<string>();
	const sessions: Session[] = [];
	const sessionIndex = new Map<string, number>();
	const titles = new Map<string, string>();
	const turns: Turn[] = [];
	let badLines = 0;
	let seq = 0;

	for (const name of names) {
		const text = fs.readFileSync(path.join(dir, name), 'utf8');
		let current: Turn | null = null;
		const tools = new Map<string, Item>();

		const sessionOf = (id: string, ts: number): number => {
			let n = sessionIndex.get(id);
			if (n == null) {
				n = sessions.length;
				sessionIndex.set(id, n);
				sessions.push({ title: null, firstTs: ts });
			}
			return n;
		};
		const open = (k: 'p' | 'n', o: any, ts: number, x: string): Turn => {
			const t: Turn = { k, ts, session: sessionOf(String(o.sessionId ?? name), ts), x, items: [], seq: seq++ };
			turns.push(t);
			return t;
		};

		for (const raw of text.split(/\r?\n/)) {
			if (raw.trim().length === 0) { continue; }
			let o: any;
			try { o = JSON.parse(raw); }
			catch { badLines++; continue; }
			if (o == null || typeof o !== 'object') { badLines++; continue; }

			if (o.type === 'custom-title' && typeof o.customTitle === 'string' && o.sessionId != null) {
				// 何度も記録される。最後のものを使う
				titles.set(String(o.sessionId), o.customTitle);
				continue;
			}

			if (typeof o.uuid === 'string') {
				if (seen.has(o.uuid)) { continue; }
				seen.add(o.uuid);
			}
			if (o.isSidechain === true) { continue; }
			const ts = Date.parse(String(o.timestamp ?? ''));
			if (!Number.isFinite(ts)) { continue; }

			if (o.type === 'system') {
				if (o.subtype === 'compact_boundary') {
					turns.push({ k: 'c', ts, session: sessionOf(String(o.sessionId ?? name), ts), x: '', items: [], seq: seq++ });
					// 要約のあとに人の発言なしで AI が続けたら、「続き」として別にする
					current = null;
				}
				continue;
			}

			if (o.type === 'user') {
				const parts = userParts(o.message?.content);
				for (const r of parts.results) {
					const item = tools.get(r.id);
					if (item != null && item.k === 'u' && r.error) { item.e = 1; }
				}
				if (parts.results.length > 0) { continue; }
				if (o.isCompactSummary === true || o.isVisibleInTranscriptOnly === true) { continue; }

				const trigger = triggerName(o, parts.text);
				if (trigger != null) {
					current = open('n', o, ts, trigger);
					continue;
				}
				if (o.isMeta === true) { continue; }

				const body = stripReminders(parts.text);
				if (Interrupted.test(body)) {
					current?.items.push({ k: 'm', ts, x: '中断' });
					continue;
				}
				if (SystemPrefixes.some((p) => body.startsWith(p))) { continue; }
				if (body.length === 0 && parts.images === 0) { continue; }

				current = open('p', o, ts, body + '［画像］'.repeat(parts.images));
				continue;
			}

			if (o.type === 'assistant') {
				const blocks = o.message?.content;
				if (!Array.isArray(blocks)) { continue; }
				for (const b of blocks) {
					if (b == null || typeof b !== 'object') { continue; }
					if (b.type === 'text' && typeof b.text === 'string' && b.text.trim().length > 0) {
						if (current == null) { current = open('n', o, ts, '続き'); }
						current.items.push({ k: 'a', ts, x: b.text });
					}
					else if (b.type === 'tool_use' && typeof b.name === 'string') {
						if (current == null) { current = open('n', o, ts, '続き'); }
						const item: Item = { k: 'u', ts, n: b.name, x: summarize(b.name, b.input), id: String(b.id ?? '') };
						current.items.push(item);
						if (b.id != null) { tools.set(String(b.id), item); }
					}
					// 思考（thinking）は載せない
				}
				continue;
			}
			// 上のどれでもない記録は捨てる（attachment ・ 状態の控え ・ 知らない種類）
		}
	}

	for (const [id, title] of titles) {
		const n = sessionIndex.get(id);
		if (n != null) { sessions[n].title = title; }
	}
	return { sessions, turns, files: names.length, badLines };
}
