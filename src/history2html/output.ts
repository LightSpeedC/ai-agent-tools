/*
	依頼を日ごとに分け、伏せ字を掛け、書き出す形にする（計画 p261014-01 の第 4 章）。

	  index.html                      ビューア（CSS と JS は中に入れる。1 ファイルで見た目が揃う）
	  data/index.js                   目次。セッションの題 ・ 日 ・ 人の発言の時刻と先頭
	  data/<yyyy-mm>/<日>.js          その日の依頼（人の発言と、応答のある位置）
	  data/<yyyy-mm>/<日>-res.js      その日の応答。展開したときに読む

	データは <script> で読む（決めたこと 13-A）。file:// のまま開いて確かめられる。
	並びは、セッションをまたいで依頼の時刻順（決めたこと 20-A）。応答は依頼の下にまとめる。
*/

import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Collected, Item, Turn } from './collect.ts';
import { findLeaks, type MaskContext } from './mask.ts';

const Weekdays = ['日', '月', '火', '水', '木', '金', '土'];
const JstOffset = 9 * 60 * 60 * 1000;

/** JST の yyyy-mm-dd と hh:mm:ss */
function jst(ts: number): { day: string; time: string; md: string } {
	const iso = new Date(ts + JstOffset).toISOString();
	return { day: iso.slice(0, 10), time: iso.slice(11, 19), md: iso.slice(5, 7) + '/' + iso.slice(8, 10) };
}

function weekday(day: string): string {
	return Weekdays[new Date(day + 'T00:00:00Z').getUTCDay()];
}

/** 目次に載せる発言の先頭。伏せた後で切る（切ってから伏せると、名前の一部が残る） */
function label(text: string): string {
	const s = text.replace(/\s+/g, ' ').trim();
	return s.length > 30 ? s.slice(0, 30) + '…' : s;
}

export type Built = {
	/** 出し先からの相対パス → 中身 */
	files: Map<string, string>;
	/** 検査に掛ける文字列（ファイルごと） */
	texts: Map<string, string[]>;
	stats: { days: number; prompts: number; triggers: number; answers: number; tools: number };
};

export function build(c: Collected, mask: (s: string) => string, title: string, lead: string, homeHref: string | null): Built {
	const files = new Map<string, string>();
	const texts = new Map<string, string[]>();
	const stats = { days: 0, prompts: 0, triggers: 0, answers: 0, tools: 0 };

	// セッションの番号は、最初の依頼の時刻順に振り直す。題が無ければ「セッション N」
	const first = new Map<number, number>();
	for (const t of c.turns) {
		if (!first.has(t.session) || t.ts < (first.get(t.session) as number)) { first.set(t.session, t.ts); }
	}
	const order = [...first.keys()].sort((a, b) => (first.get(a) as number) - (first.get(b) as number));
	const renum = new Map<number, number>();
	order.forEach((s, i) => renum.set(s, i));
	const sessions = order.map((s, i) => ({ n: mask(c.sessions[s].title ?? 'セッション ' + (i + 1)) }));

	const turns = [...c.turns].sort((a, b) => a.ts - b.ts || a.seq - b.seq);
	const byDay = new Map<string, Turn[]>();
	for (const t of turns) {
		const d = jst(t.ts).day;
		let list = byDay.get(d);
		if (list == null) { list = []; byDay.set(d, list); }
		list.push(t);
	}

	const days: unknown[] = [];
	for (const [d, list] of byDay) {
		stats.days++;
		const entries: Record<string, unknown>[] = [];
		const res: Record<string, unknown>[][] = [];
		const prompts: [string, string, number][] = [];
		let chars = 0;
		list.forEach((t, i) => {
			const time = jst(t.ts).time;
			const s = renum.get(t.session) ?? 0;
			const e: Record<string, unknown> = { k: t.k, t: time, s };
			if (t.k === 'p') {
				const x = mask(t.x);
				e.x = x;
				chars += x.length;
				prompts.push([time, label(x), i]);
				stats.prompts++;
			}
			else if (t.k === 'n') {
				e.x = t.x;
				stats.triggers++;
			}
			if (t.items.length > 0) { e.r = t.items.length; }
			entries.push(e);
			res.push(t.items.map((it) => item(it, d)));
		});
		const ym = d.slice(0, 7);
		// 人の発言は -req.js、応答は -res.js（依頼と応答の対）
		const dayFile = 'data/' + ym + '/' + d + '-req.js';
		const resFile = 'data/' + ym + '/' + d + '-res.js';
		files.set(dayFile, 'history2html.day(' + JSON.stringify(d) + ', [\n' + entries.map((e) => JSON.stringify(e)).join(',\n') + '\n]);\n');
		files.set(resFile, 'history2html.res(' + JSON.stringify(d) + ', [\n' + res.map((r) => JSON.stringify(r)).join(',\n') + '\n]);\n');
		texts.set(dayFile, strings(entries));
		texts.set(resFile, strings(res));
		// rn ・ rc は応答の件数と文字数。「すべて展開」のときの高さの見積もりに使う（見積もりが小さいと、描いたときに高さが急に伸びる）
		const rn = res.reduce((a, r) => a + r.length, 0);
		const rc = res.reduce((a, r) => a + r.reduce((b, it) => b + String(it.x ?? '').length, 0), 0);
		days.push({ d, w: weekday(d), n: list.length, c: chars, rn, rc, p: prompts });
	}

	function item(it: Item, day: string): Record<string, unknown> {
		const j = jst(it.ts);
		// 日をまたいだ応答は、日付も付ける。時刻だけだと前の日のことに読める
		const t = j.day === day ? j.time : j.md + ' ' + j.time;
		if (it.k === 'a') { stats.answers++; return { k: 'a', t, x: mask(it.x) }; }
		if (it.k === 'u') {
			stats.tools++;
			const o: Record<string, unknown> = { k: 'u', t, n: mask(it.n), x: mask(it.x) };
			if (it.e === 1) { o.e = 1; }
			return o;
		}
		return { k: 'm', t, x: it.x };
	}

	const index = { title, sessions, days };
	files.set('data/index.js', 'history2html.index(' + JSON.stringify(index) + ');\n');
	texts.set('data/index.js', strings(index));

	const html = page(title, lead, homeHref);
	files.set('index.html', html);
	texts.set('index.html', html.split('\n'));
	return { files, texts, stats };
}

/** 中の文字列を行ごとに集める。検査はファイルの字面ではなく中身で行う（JSON は 1 行につながり、行の境目が消えるため） */
function strings(v: unknown): string[] {
	const out: string[] = [];
	const walk = (x: unknown) => {
		if (typeof x === 'string') { out.push(...x.split('\n')); }
		else if (Array.isArray(x)) { x.forEach(walk); }
		else if (x != null && typeof x === 'object') { Object.values(x).forEach(walk); }
	};
	walk(v);
	return out;
}

function escapeHtml(s: string): string {
	return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

const here = path.dirname(fileURLToPath(import.meta.url));

/** ビューアの HTML。CSS と JS は中に入れる */
function page(title: string, lead: string, homeHref: string | null): string {
	const dir = path.join(here, 'viewer');
	// ひな形は BOM 付きで置いてある（共通ルール）。書き出すときに付け直すので、ここで外す
	const tpl = fs.readFileSync(path.join(dir, 'index.html'), 'utf8').replace(/^﻿/, '');
	const css = fs.readFileSync(path.join(dir, 'viewer.css'), 'utf8');
	const js = fs.readFileSync(path.join(dir, 'viewer.js'), 'utf8');
	const home = homeHref == null ? ''
		: '<a class="home" href="' + escapeHtml(homeHref) + '" aria-label="戻る" title="README へ戻る"><svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><path fill="currentColor" d="M8 1 1 7h2v7h4v-4h2v4h4V7h2z"/></svg></a>';
	// 置き換えは関数で渡す。文字列で渡すと $& などが特別な意味を持つ
	return tpl
		.replace(/\{\{TITLE\}\}/g, () => escapeHtml(title))
		.replace(/\{\{LEAD\}\}/g, () => escapeHtml(lead))
		.replace('{{HOME}}', () => home)
		.replace('/*{{CSS}}*/', () => css)
		.replace('/*{{JS}}*/', () => js);
}

/** 書き出す前の検査。残っていたものを「ファイル: 種類」で返す。値そのものは返さない */
export function inspect(b: Built, ctx: MaskContext): Map<string, Map<string, number>> {
	const found = new Map<string, Map<string, number>>();
	for (const [file, lines] of b.texts) {
		for (const line of lines) {
			for (const kind of findLeaks(line, ctx)) {
				let m = found.get(file);
				if (m == null) { m = new Map(); found.set(file, m); }
				m.set(kind, (m.get(kind) ?? 0) + 1);
			}
		}
	}
	return found;
}

/** 印。前回この道具が作ったフォルダかを見分ける */
export const Marker = 'data/index.js';

/*
	書き出す。**中身が同じファイルは書かない**（決めたこと 38-A。html2md と同じ）。
	会話が増えても、変わるのは新しい日 ・ 最終日 ・ 目次だけになり、更新日時も変わらない。
	data/ の下で今回作らなかったファイル（消えた日）は消す
*/
export function write(out: string, b: Built): { written: number; same: number; removed: number } {
	const stat = { written: 0, same: 0, removed: 0 };
	fs.mkdirSync(out, { recursive: true });
	const keep = new Set<string>();
	for (const [rel, body] of b.files) {
		const p = path.join(out, rel);
		keep.add(path.resolve(p));
		// HTML は BOM 付き（共通ルール「ドキュメントの保存場所と形式」）
		const bytes = Buffer.from(rel.endsWith('.html') ? '﻿' + body : body, 'utf8');
		if (fs.existsSync(p) && fs.readFileSync(p).equals(bytes)) { stat.same++; continue; }
		fs.mkdirSync(path.dirname(p), { recursive: true });
		fs.writeFileSync(p, bytes);
		stat.written++;
	}
	const data = path.join(out, 'data');
	const sweep = (dir: string) => {
		for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
			const p = path.join(dir, e.name);
			if (e.isDirectory()) {
				sweep(p);
				if (fs.readdirSync(p).length === 0) { fs.rmdirSync(p); }
			}
			else if (!keep.has(path.resolve(p))) { fs.rmSync(p); stat.removed++; }
		}
	};
	if (fs.existsSync(data)) { sweep(data); }
	return stat;
}
