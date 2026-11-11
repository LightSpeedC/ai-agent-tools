/*
	issue decide migrate: 資料と課題に散っている過去の決定 (96-A 等) を、decisions/ へ移す。
	計画は p261108-03 (188-A 〜 193-A)、仕様は notes/50_spec/課題ファイルの形と検査.html。

	拾うもの:
	  - 計画 ・ 調査の HTML の決定の表 (行の最初のセルが「番号-字」)。
	    「決めること / 案」の表は、同じ番号の行を 1 件にまとめ、全部の案を書く。選んだ字は表の外の本文から (192-A)。
	    「決めたこと」の表は、選んだ案だけ。ほかの案は「記録なし」(188-A)。
	  - 表に無い番号は、資料と課題の本文に出てくる「番号-字」から (193-A)。
	親は、表 (または本文) がある資料 ・ 課題の番号。連番は親ごとに旧番号の順 (189-A)。
	ここの関数は、何かを表示せず、結果を返す。
*/
import fs from 'node:fs';
import path from 'node:path';
import { DecisionsRel, ItemsRel, ParentPattern } from './check.ts';
import { splitIssue } from './meta.ts';
import { loadDecisions, newDecision } from './decide.ts';
import { Failure, UsageError, compareId } from './ops.ts';
import { UuidFileName, readProjectFile } from './numbers.ts';
import { parseLegacyIssues } from './migrate.ts';
import { getPlainText } from '../html2md/htmlutil.ts';

export const DecideWrittenListRel = `${DecisionsRel}/_decide-migrate-written.txt`;

const Letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const NoRecord = '記録なし';

/** 番号を拾う: 前後が英数字 ・ ハイフン ・ ピリオドなら番号とみなさない */
const MentionPattern = /(?<![0-9A-Za-z\-.])(\d{1,3})-([A-Z])(?![0-9A-Za-z\-])/g;
/** 表の 1 列目: 「番号-字」だけか、その後ろに空白とかっこの説明が続く (147-A (決定番号の持ち方。…)) */
const CellNumber = /^(\d{1,3})-([A-Z])(?:$|\s*[(（])/;
const DocIdOfName = /^([ipr]\d{6}-[0-9a-kLm-z]{2})-/;

type Source = {
	/** 親にする番号 (無ければ null。番号の無い資料) */
	id: string | null;
	/** root からの相対パス */
	rel: string;
	/** 決めた日に使う日 (資料の作成日。無ければ番号の日付) */
	date: string;
	/** 表を除いた本文 (コードを除いた素の文字) */
	text: string;
	/** HTML の資料なら、その中身 (表を読むため) */
	html: string | null;
};

export type PlannedDecision = {
	parent: string;
	number: number;
	legacy: string;
	title: string;
	options: string[];
	chosen: string;
	body: string;
	decided: string;
	slug: string;
	from: 'table' | 'text';
	source: string;
	/** 249-A: --pending ・ --provisional で名指しした番号の状態。無ければ 決めた */
	status?: string;
};

/**
 * 249-A: 名指しした旧番号に状態を付ける。計画に無い番号 ・ 両方に書いた番号は UsageError
 */
export function markStatuses(plan: DecideMigratePlan, pending: number[], provisional: number[]): void {
	const both = pending.filter((n) => provisional.includes(n));
	if (both.length > 0) throw new UsageError(`--pending と --provisional の両方に書いた番号がある: ${both.join(', ')}`);
	const numbers = new Set(plan.move.map((m) => m.number));
	const missing = [...pending, ...provisional].filter((n) => !numbers.has(n));
	if (missing.length > 0) throw new UsageError(`移す計画に無い番号: ${missing.join(', ')} (既にある ・ 読めなかった番号は名指しできない)`);
	for (const m of plan.move) {
		if (pending.includes(m.number)) m.status = '答え待ち';
		else if (provisional.includes(m.number)) m.status = '仮に決めた';
	}
}

export type DecideMigratePlan = {
	move: PlannedDecision[];
	skipped: string[];
	assumedA: string[];
	fromText: string[];
	split: { number: string; letters: string }[];
	unreadable: { where: string; message: string }[];
};

function toPosix(p: string): string {
	return p.split(path.sep).join('/');
}

function walk(dir: string, ext: string, out: string[]): void {
	let entries: fs.Dirent[];
	try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
	for (const e of entries) {
		if (e.name.startsWith('_') || e.name.startsWith('.')) continue;
		const full = path.join(dir, e.name);
		if (e.isDirectory()) walk(full, ext, out);
		else if (e.isFile() && e.name.toLowerCase().endsWith(ext)) out.push(full);
	}
}

/** 番号の日付 (yymmdd) を yyyy-mm-dd にする */
function dateOfId(id: string): string {
	return `20${id.slice(1, 3)}-${id.slice(3, 5)}-${id.slice(5, 7)}`;
}

/** コード (pre ・ code) を除く */
function stripCodeHtml(html: string): string {
	return html.replace(/<pre\b[\s\S]*?<\/pre>/gi, ' ').replace(/<code\b[\s\S]*?<\/code>/gi, ' ');
}

function stripCodeMd(md: string): string {
	return md.replace(/```[\s\S]*?```/g, ' ').replace(/`[^`\n]*`/g, ' ');
}

function oneLine(s: string): string {
	return s.replace(/\s+/g, ' ').trim();
}

function plain(html: string): string {
	return oneLine(getPlainText(html));
}

function readSources(root: string): Source[] {
	const sources: Source[] = [];
	const notes = path.join(root, 'notes');
	const issuesDir = path.join(notes, '40_issues');
	// 資料 (notes/ の HTML。40_issues は課題として別に読む)
	const htmlFiles: string[] = [];
	walk(notes, '.html', htmlFiles);
	for (const f of htmlFiles) {
		if (f.startsWith(issuesDir + path.sep)) continue;
		const html = fs.readFileSync(f, 'utf8').replace(/^﻿/, '');
		const m = DocIdOfName.exec(path.basename(f));
		const id = m !== null && ParentPattern.test(m[1]) ? m[1] : null;
		const created = /作成:\s*(\d{4}-\d{2}-\d{2})/.exec(html)?.[1];
		const noTables = html.replace(/<table\b[\s\S]*?<\/table>/gi, ' ');
		sources.push({ id, rel: toPosix(path.relative(root, f)), date: created ?? (id !== null ? dateOfId(id) : ''), text: plain(stripCodeHtml(noTables)), html });
	}
	// 課題 (items/ の Markdown)
	const mdFiles: string[] = [];
	walk(path.join(root, ...ItemsRel.split('/')), '.md', mdFiles);
	for (const f of mdFiles) {
		const parts = splitIssue(fs.readFileSync(f, 'utf8').replace(/^﻿/, '').replace(/\r\n?/g, '\n'));
		if (parts.broken) continue;
		const meta: Record<string, string> = {};
		for (const p of parts.parsed.pairs) meta[p.key] = p.value;
		const id = meta.id;
		if (id === undefined || !ParentPattern.test(id)) continue;
		sources.push({ id, rel: toPosix(path.relative(root, f)), date: meta.created ?? dateOfId(id), text: oneLine(stripCodeMd(parts.body)), html: null });
	}
	// 旧課題の HTML
	for (const name of ['issues-legacy.html', 'issues.html', 'issues-archive.html']) {
		const f = path.join(issuesDir, name);
		if (!fs.existsSync(f)) continue;
		const parsed = parseLegacyIssues(fs.readFileSync(f, 'utf8').replace(/^﻿/, ''));
		for (const i of parsed.issues) {
			if (!ParentPattern.test(i.id)) continue;
			sources.push({ id: i.id, rel: `notes/40_issues/${name}#${i.id}`, date: dateOfId(i.id), text: plain(stripCodeHtml(i.bodyHtml)), html: null });
		}
	}
	// 番号の小さい順 (日付 → 種類 → 連番)。番号の無い資料は後ろ
	const key = (s: Source): string => (s.id === null ? '~' : s.id.slice(1) + s.id[0]);
	return sources.sort((a, b) => (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : a.rel < b.rel ? -1 : 1));
}

type Cell = { html: string; rowspan: number };
type TableRow = { number: number; letter: string; cells: string[]; headers: string[]; table: number };

/** 1 つの表の行を読む。rowspan を後ろの行へ配る。table は資料の中の何番目の表か */
function readTable(tableHtml: string, table: number): TableRow[] {
	const headers = [...tableHtml.matchAll(/<th\b[^>]*>([\s\S]*?)<\/th>/gi)].map((m) => plain(m[1]));
	const rows: TableRow[] = [];
	const carry: (string | null)[] = [];
	const carryLeft: number[] = [];
	for (const tr of tableHtml.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)) {
		const raw: Cell[] = [...tr[1].matchAll(/<td\b([^>]*)>([\s\S]*?)<\/td>/gi)].map((m) => ({ html: m[2], rowspan: Number(/rowspan="(\d+)"/.exec(m[1])?.[1] ?? '1') }));
		if (raw.length === 0) continue;
		const cells: string[] = [];
		let k = 0;
		for (let col = 0; k < raw.length || (carryLeft[col] ?? 0) > 0; col++) {
			if ((carryLeft[col] ?? 0) > 0) {
				cells.push(carry[col] ?? '');
				carryLeft[col]--;
				continue;
			}
			if (k >= raw.length) break;
			const c = raw[k++];
			cells.push(plain(stripCodeHtml(c.html.replace(/<code\b[^>]*>([\s\S]*?)<\/code>/gi, '$1'))));
			if (c.rowspan > 1) { carry[col] = cells[cells.length - 1]; carryLeft[col] = c.rowspan - 1; }
		}
		const m = CellNumber.exec(cells[0] ?? '');
		if (m === null) continue;
		rows.push({ number: Number(m[1]), letter: m[2], cells: cells.slice(1), headers: headers.slice(1), table });
	}
	return rows;
}

/** 本文の中で、その番号に付いた字を、出てきた順に返す */
function mentionsOf(text: string): { number: number; letter: string; index: number }[] {
	const out: { number: number; letter: string; index: number }[] = [];
	for (const m of text.matchAll(MentionPattern)) out.push({ number: Number(m[1]), letter: m[2], index: m.index ?? 0 });
	return out;
}

function optionsUpTo(map: Map<string, string>, chosen: string): string[] {
	const maxLetter = [...map.keys(), chosen].reduce((a, b) => (b > a ? b : a), 'A');
	const list: string[] = [];
	for (const l of Letters.slice(0, Letters.indexOf(maxLetter) + 1)) list.push(map.get(l) ?? NoRecord);
	return list;
}

/** 決定の移行は、課題の移行が済んでいることが前提 (items/project-uuid.txt か古い project-id.txt があり、旧 issues.html が残っていない) */
function assertIssuesMigrated(root: string): void {
	const hint = '先に issue migrate で課題を移す (決定の親になる課題が items/ に要るため)';
	if (readProjectFile(root) === null) throw new Failure(`${ItemsRel}/${UuidFileName} が無い。${hint}`);
	if (fs.existsSync(path.join(root, 'notes', '40_issues', 'issues.html'))) throw new Failure(`notes/40_issues/issues.html が残っている (課題の移行が済んでいない)。${hint}`);
}

export function planDecideMigration(root: string): DecideMigratePlan {
	assertIssuesMigrated(root);
	const project = path.basename(root);
	const sources = readSources(root);
	// 既にある旧番号。「番号」か、資料ごとの番号なら「資料の番号/番号」(194-A)
	const existingKeys = new Set<string>();
	for (const d of loadDecisions(root, () => {})) {
		for (const l of (d.meta.legacy_ids ?? '').split(',')) {
			// 字の無い形 (:proj:210) も読む。decide new で旧番号だけを書いた決定がある (i261110-05)
			const m = new RegExp(`^:${project.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}:((?:[ipr]\\d{6}-[0-9a-kLm-z]{2}/)?\\d+)(?:-[A-Z])?$`).exec(l.trim());
			if (m !== null) existingKeys.add(m[1]);
		}
	}
	const existing = new Set<number>([...existingKeys].filter((k) => !k.includes('/')).map(Number));
	const plan: DecideMigratePlan = { move: [], skipped: [], assumedA: [], fromText: [], split: [], unreadable: [] };
	const inTables = new Set<number>();
	const skipped = new Set<number>();

	// 表から (188-A ・ 192-A)
	for (const s of sources) {
		if (s.html === null) continue;
		const rows: TableRow[] = [];
		let tableNo = 0;
		for (const t of s.html.matchAll(/<table\b[\s\S]*?<\/table>/gi)) rows.push(...readTable(t[0], tableNo++));
		if (rows.length === 0) continue;
		if (s.id === null) {
			plan.unreadable.push({ where: s.rel, message: `番号の無い資料の表は親にできない: ${[...new Set(rows.map((r) => r.number))].join(' ・ ')}` });
			continue;
		}
		const numbers = [...new Set(rows.map((r) => r.number))].sort((a, b) => a - b);
		for (const n of numbers) {
			if (inTables.has(n)) continue;
			inTables.add(n);
			if (existing.has(n)) { skipped.add(n); continue; }
			const mine = rows.filter((r) => r.number === n);
			const options = new Map<string, string>();
			let title = '';
			let decidedLetter: string | null = null;
			const notes: string[] = [];
			for (const r of mine) {
				const col = (name: RegExp): number => r.headers.findIndex((h) => name.test(h));
				const optCol = col(/^案$/);
				if (optCol >= 0) {
					// 案の表: 決めること ・ 案 ・ 推す理由
					const q = col(/決めること|問い/);
					if (q >= 0 && title === '') title = r.cells[q] ?? '';
					const text = (r.cells[optCol] ?? '').replace(/^[A-Z]\s*[:：]\s*/, '');
					const why = col(/理由/);
					options.set(r.letter, why >= 0 && (r.cells[why] ?? '') !== '' ? `${text} (推す理由: ${r.cells[why]})` : text);
				} else if (mine.filter((x) => x.table === r.table).length > 1) {
					// 見出しに「案」が無くても、同じ表に同じ番号の行が 2 つ以上あれば、案の表 (i261110-05)。
					// 決めたことの表として読むと、最後の行の字が選んだ字になってしまう。選んだ字は本文から拾う
					const text = (r.cells[0] ?? '').replace(/^[A-Z]\s*[:：]\s*/, '');
					const rest = r.headers.map((h, i) => (i > 0 && (r.cells[i] ?? '') !== '' ? `${h}: ${r.cells[i]}` : '')).filter((x) => x !== '');
					options.set(r.letter, rest.length > 0 ? `${text} (${rest.join(' ・ ')})` : text);
				} else {
					// 決めたことの表: この行の字が選んだ案
					const q = col(/^問い$/);
					if (q >= 0 && title === '') title = r.cells[q] ?? '';
					const chosenCol = r.headers.findIndex((h, i) => i !== q && /選んだ案|決めたこと/.test(h));
					const c = chosenCol >= 0 ? chosenCol : (q === 0 ? 1 : 0);
					options.set(r.letter, r.cells[c] ?? '');
					decidedLetter = r.letter;
					r.headers.forEach((h, i) => {
						if (i !== c && i !== q && (r.cells[i] ?? '') !== '' && r.cells[i] !== '―') notes.push(`${h}: ${r.cells[i]}`);
					});
				}
			}
			let chosen = decidedLetter;
			if (chosen === null) {
				const letters = mentionsOf(s.text).filter((x) => x.number === n).map((x) => x.letter);
				const distinct = [...new Set(letters)];
				if (distinct.length > 1) plan.split.push({ number: String(n), letters: distinct.join(' ・ ') });
				chosen = distinct[0] ?? null;
				if (chosen === null) {
					chosen = options.has('A') ? 'A' : [...options.keys()].sort()[0];
					plan.assumedA.push(String(n));
					notes.push('本文に記録なし、推奨の A とみなした (192-A)');
				}
			}
			const body = [`## 出典\n\n- ${s.rel} の表`, ...(notes.length > 0 ? ['', ...notes.map((x) => '- ' + x)] : [])].join('\n');
			plan.move.push({
				parent: s.id, number: n, legacy: `${n}-${chosen}`, title: title !== '' ? title : `${NoRecord} (旧 ${n})`,
				options: optionsUpTo(options, chosen).map(oneLine), chosen, body, decided: s.date, slug: `旧${n}`, from: 'table', source: s.rel,
			});
		}
	}

	// 表に無い番号は、本文から (193-A)
	const found = new Map<number, { source: Source; letter: string; index: number }[]>();
	for (const s of sources) {
		if (s.id === null) continue;
		for (const m of mentionsOf(s.text)) {
			if (inTables.has(m.number)) continue;
			const list = found.get(m.number) ?? [];
			list.push({ source: s, letter: m.letter, index: m.index });
			found.set(m.number, list);
		}
	}
	// 1 件分を計画に足す。prefix は資料ごとの番号のときの「資料の番号/」(194-A)
	const addFromText = (n: number, list: { source: Source; letter: string; index: number }[], prefix: string): void => {
		const key = prefix + String(n);
		if (existingKeys.has(key)) { skipped.add(n); return; }
		const counts = new Map<string, number>();
		for (const x of list) counts.set(x.letter, (counts.get(x.letter) ?? 0) + 1);
		const distinct = [...counts.keys()];
		if (distinct.length > 1) plan.split.push({ number: key, letters: distinct.join(' ・ ') });
		const chosen = distinct.reduce((a, b) => ((counts.get(b) ?? 0) > (counts.get(a) ?? 0) ? b : a), distinct[0]);
		const first = list[0].source;
		const places = list.slice(0, 5).map((x) => `- ${x.source.id} (${x.source.rel}): …${oneLine(x.source.text.slice(Math.max(0, x.index - 40), x.index + 44))}…`);
		const body = `## 出てきた箇所\n\n${places.join('\n')}${list.length > 5 ? `\n- ほか ${list.length - 5} か所` : ''}`;
		plan.fromText.push(key);
		plan.move.push({
			parent: first.id as string, number: n, legacy: `${key}-${chosen}`, title: `${NoRecord} (旧 ${key})`,
			options: optionsUpTo(new Map(), chosen), chosen, body, decided: first.date, slug: `旧${n}`, from: 'text', source: first.rel,
		});
	};
	for (const n of [...found.keys()].sort((a, b) => a - b)) {
		const list = found.get(n) ?? [];
		const ids = [...new Set(list.map((x) => x.source.id as string))];
		if (ids.length === 1) {
			if (existing.has(n)) { skipped.add(n); continue; }
			addFromText(n, list, '');
			continue;
		}
		// 2 つ以上の資料 ・ 課題に出てくる番号は、資料ごとに振り直した番号とみなし、資料ごとに 1 件 (194-A)
		for (const id of ids) addFromText(n, list.filter((x) => x.source.id === id), id + '/');
	}
	plan.skipped = [...skipped].sort((a, b) => a - b).map(String);
	// 親ごとに旧番号の順で書く
	plan.move.sort((a, b) => (a.parent < b.parent ? -1 : a.parent > b.parent ? 1 : a.number - b.number));
	return plan;
}

/** 字と字の間の、並べる語 (と ・ , 、 / および)。これだけを挟んで続く字は、まとめて選んだとみなす (219-A) */
const Joiner = String.raw`\s*(?:と|・|,|、|/|および|及び)\s*`;

/**
 * 本文の中で、その番号に 2 つ以上の字を並べて書いた所 (「5-A と 5-B」「8-A・B」) から字を返す (219-A)。
 * 案の一覧 (7-A: … 7-B: …) のように、字と字の間に文が挟まるものは拾わない
 */
function jointLetters(text: string, n: number): string[] {
	const out: string[] = [];
	// 「8-A・B」: 番号 1 つに字を並べる
	for (const m of text.matchAll(new RegExp(String.raw`(?<![\d-])${n}-([A-Z])((?:${Joiner}[A-Z](?![A-Za-z0-9]))+)`, 'g'))) {
		out.push(m[1], ...(m[2].match(/[A-Z]/g) ?? []));
	}
	// 「5-A と 5-B」: 番号ごと並べる
	for (const m of text.matchAll(new RegExp(String.raw`(?<![\d-])${n}-([A-Z])((?:${Joiner}${n}-[A-Z](?![A-Za-z0-9]))+)`, 'g'))) {
		out.push(m[1], ...[...m[2].matchAll(new RegExp(String.raw`${n}-([A-Z])`, 'g'))].map((x) => x[1]));
	}
	return out;
}

export type RecheckHit ={ id: string; legacy: string; chosen: string; letters: string };

/**
 * 移し済みの決定を数え直す (218-A)。旧番号ごとに、資料 ・ 課題に出てくる字 (表の行と本文) を集め、
 * 決定の chosen に無い字が出てくるものを返す。移すときは 1 字しか選べなかったため、両方を選んでいた決定が片方だけで残っているおそれがある
 */
export function recheckDecisions(root: string): RecheckHit[] {
	assertIssuesMigrated(root);
	const project = path.basename(root);
	const sources = readSources(root);
	const lettersOf = (n: number, docId: string | null): string[] => {
		const out: string[] = [];
		for (const s of sources) {
			if (docId !== null && s.id !== docId) continue;
			out.push(...jointLetters(s.text, n));
			if (s.html !== null) for (const t of s.html.matchAll(/<table\b[\s\S]*?<\/table>/gi)) {
				for (const r of readTable(t[0], 0)) {
					// 案の表 (案の列がある) は、選んだ字ではないので数えない。
					// 見出しに「案」の無い案の表は、あえて数える。i261110-05 の前に、その表から誤った字で移った決定を拾うため
					if (r.number === n && !r.headers.some((h) => /^案$/.test(h))) out.push(r.letter);
				}
			}
		}
		return [...new Set(out)].sort();
	};
	const hits: RecheckHit[] = [];
	const esc = project.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
	const all = loadDecisions(root, () => {});
	// 置き換えられた決定と、--replaces で書いた決定は、人が見直し済みなので出さない
	const replaced = new Set(all.map((d) => d.meta.replaces ?? '').filter((x) => x !== ''));
	for (const d of all) {
		if (replaced.has(d.id) || (d.meta.replaces ?? '') !== '') continue;
		const chosen = (d.meta.chosen ?? '').split(',').filter((c) => c !== '');
		for (const l of (d.meta.legacy_ids ?? '').split(',')) {
			const m = new RegExp(`^:${esc}:(?:([ipr]\\d{6}-[0-9a-kLm-z]{2})/)?(\\d+)-[A-Z]$`).exec(l.trim());
			if (m === null) continue;
			const letters = lettersOf(Number(m[2]), m[1] ?? null);
			if (letters.some((x) => !chosen.includes(x))) {
				hits.push({ id: d.id, legacy: (m[1] !== undefined ? m[1] + '/' : '') + m[2], chosen: chosen.join(','), letters: letters.join(' ・ ') });
			}
		}
	}
	return hits.sort((a, b) => compareId(a.id, b.id));
}

/** 計画どおりに書く。書いたものを返す (途中で失敗したら、それまでに書いた分を返して投げる) */
export function applyDecideMigration(root: string, plan: DecideMigratePlan): { written: { id: string; rel: string; legacy: string }[] } {
	const project = path.basename(root);
	const written: { id: string; rel: string; legacy: string }[] = [];
	for (const d of plan.move) {
		const r = newDecision(root, {
			parent: d.parent, title: d.title, options: d.options, chosen: d.chosen, slug: d.slug,
			legacy: `:${project}:${d.legacy}`, body: d.body, decided: d.decided, status: d.status,
		});
		written.push({ id: r.id, rel: r.rel, legacy: d.legacy });
	}
	return { written };
}

/** 書いた決定を消す (--apply の自動の戻し ・ --undo)。decisions/ の直下の .md だけを消し、ほかには触らない */
export function removeDecideWritten(root: string, rels: string[]): number {
	let n = 0;
	for (const rel of rels) {
		const full = path.join(root, ...rel.split('/'));
		if (!rel.startsWith(DecisionsRel + '/') || rel.slice(DecisionsRel.length + 1).includes('/') || !rel.endsWith('.md') || !fs.existsSync(full)) continue;
		fs.rmSync(full);
		n++;
	}
	return n;
}

/** 書いたものを読み直し、計画と比べる (旧番号 ・ 選んだ字 ・ 親 ・ 案の数) */
export function verifyDecideWritten(root: string, plan: DecideMigratePlan, written: { id: string; legacy: string }[]): { id: string; message: string }[] {
	const project = path.basename(root);
	const views = new Map(loadDecisions(root, () => {}).map((v) => [v.id, v]));
	const problems: { id: string; message: string }[] = [];
	for (const w of written) {
		const p = plan.move.find((m) => m.legacy === w.legacy);
		const v = views.get(w.id);
		if (p === undefined || v === undefined) { problems.push({ id: w.id, message: '読み直せない' }); continue; }
		if (v.meta.legacy_ids !== `:${project}:${p.legacy}`) problems.push({ id: w.id, message: `旧番号が違う: ${v.meta.legacy_ids}` });
		if (v.meta.chosen !== p.chosen) problems.push({ id: w.id, message: `選んだ字が違う: ${v.meta.chosen} (元は ${p.chosen})` });
		if (v.meta.parent !== p.parent) problems.push({ id: w.id, message: `親が違う: ${v.meta.parent}` });
		if (v.options.length !== p.options.length) problems.push({ id: w.id, message: `案の数が違う: ${v.options.length} (元は ${p.options.length})` });
	}
	return problems;
}
