/*
	issue の索引 DB (キャッシュ) を持つかを決めるための計測。計画は p261103-01 の 121-A。

	「全部読む」と「キャッシュ」を、同じ件数 ・ 同じ場所 (tmp/ の下の作り物の課題) で比べる。
	1 件の大きさは、file-manager のプロジェクトの実測 (約 390 件 ・ HTML 合計約 1 MB ≒ 1 件 2.7 KB) に合わせる。

		node tools/50_run/bench-issue-cache/bench.ts [--counts 68,390,2000,5000] [--runs 7]
		bun  tools/50_run/bench-issue-cache/bench.ts

	測るもの (どれも中央値。1 回目の暖機は捨てる)
		check      全部読む検査 (checkProject)。読む + 解釈 + 検査
		read       全部読む (readdir + readFile + メタ情報と本文の分割だけ)
		stat       キャッシュの判定に要る最小限 (readdir + stat)
		validate   キャッシュの判定 (DB を開く + 全行の更新日時とサイズを読む + stat と比べる + 閉じる)
		search     本文の検索 (全部読んで includes ・ LIKE ・ FTS5 trigram)
		cold       process を起こして `issue check` を 1 回走らせた全体の時間 (起動を含む)
	CPU は process.cpuUsage の user + system。OS のファイルキャッシュは温まっている (冷えた状態は測っていない)。

	前半 (check ・ read ・ stat ・ validate ・ search) は、全件を items/ 直下に平らに置いた配置で測った比較用。
	126-A (状態を todo / doing / done / archived のフォルダで持つ) 以後の本番の配置ではない。check は
	置き場の誤りと state キーを指摘するが、ここでは時間だけを見て、指摘の中身は見ない。
	後半 (状態でフォルダを分けた場合) が、本番の配置での未・着手だけを読む費用。
*/
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { checkProject } from '../../../src/issue/check.ts';
import { splitIssue } from '../../../src/issue/meta.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..', '..', '..');
const work = path.join(root, 'tmp', 'bench-issue-cache');
const main = path.join(root, 'src', 'issue', 'main.ts');

// ---- 引数 ----

function arg(name: string, fallback: string): string {
	const i = process.argv.indexOf(name);
	return i >= 0 && process.argv[i + 1] !== undefined ? process.argv[i + 1] : fallback;
}
const counts = arg('--counts', '68,390,2000,5000').split(',').map(Number);
const runs = Number(arg('--runs', '7'));

// ---- 作り物の課題 ----

const ProjectId = 'schema: 1\nproject_id: 7b0c4e1a9f3d4a62b8d51c2e6f90a3b7\n';
/** 36 進数の桁 (英字は小文字。l は読み間違えるので大文字の L) */
const Digits = '0123456789abcdefghijkLmnopqrstuvwxyz';

/** 36 進数 2 桁 */
function nn(n: number): string {
	return Digits[Math.floor(n / 36) % 36] + Digits[n % 36];
}

const Sentence = '課題管理ツールの索引は、ファイルの更新日時とサイズが前と同じなら読まずに信頼し、違えば中身の指紋で確かめる。';
/** 約 2.7 KB (UTF-8 で 1 文字 3 バイトとして 900 文字) */
function body(i: number): string {
	let text = '\n';
	while ([...text].length < 880) text += Sentence;
	const marker = i % 50 === 0 ? '\n表のまま出す課題\n' : '\n';
	return text + marker + '\n## やること\n- [未] a\n- [着手] b\n- [済] c\n';
}

function generate(n: number): string {
	const dir = path.join(work, 'n' + n);
	fs.rmSync(dir, { recursive: true, force: true });
	const items = path.join(dir, 'notes', '40_issues', 'items');
	fs.mkdirSync(items, { recursive: true });
	fs.writeFileSync(path.join(items, 'project-id.txt'), ProjectId);
	for (let i = 0; i < n; i++) {
		const day = 1 + Math.floor(i / 1296);
		const id = 'i2611' + String(day).padStart(2, '0') + '-' + nn(i % 1296);
		const text = '---\nschema: 1\nid: ' + id + '\ntitle: 作り物の課題 ' + i + '\nstate: 未\ngroup: bench\ncreated: 2026-11-0' + Math.min(day, 9) + '\n---\n' + body(i);
		fs.writeFileSync(path.join(items, id + '-bench' + i + '.md'), text);
	}
	return dir;
}

// ---- 計測 ----

type Sample = { wall: number; cpu: number };

function median(xs: number[]): number {
	const s = [...xs].sort((a, b) => a - b);
	return s[Math.floor(s.length / 2)];
}

function measure(fn: () => void, n: number = runs): { wall: number; cpu: number } {
	fn(); // 暖機
	const samples: Sample[] = [];
	for (let i = 0; i < n; i++) {
		const c0 = process.cpuUsage();
		const t0 = performance.now();
		fn();
		const wall = performance.now() - t0;
		const c1 = process.cpuUsage(c0);
		samples.push({ wall, cpu: (c1.user + c1.system) / 1000 });
	}
	return { wall: median(samples.map((s) => s.wall)), cpu: median(samples.map((s) => s.cpu)) };
}

function itemsDirOf(dir: string): string {
	return path.join(dir, 'notes', '40_issues', 'items');
}

function readAll(dir: string): number {
	const items = itemsDirOf(dir);
	let n = 0;
	for (const name of fs.readdirSync(items)) {
		if (!name.endsWith('.md')) continue;
		const parts = splitIssue(fs.readFileSync(path.join(items, name), 'utf8'));
		n += parts.parsed.pairs.length;
	}
	return n;
}

function statAll(dir: string): Map<string, { mtime: number; bytes: number }> {
	const items = itemsDirOf(dir);
	const out = new Map<string, { mtime: number; bytes: number }>();
	for (const name of fs.readdirSync(items)) {
		if (!name.endsWith('.md')) continue;
		const st = fs.statSync(path.join(items, name));
		out.set(name, { mtime: Math.floor(st.mtimeMs), bytes: st.size });
	}
	return out;
}

// ---- SQLite (node:sqlite ・ bun:sqlite の両対応) ----

type Stmt = { run(...a: unknown[]): unknown; all(...a: unknown[]): unknown[] };
type Db = { exec(sql: string): void; prepare(sql: string): Stmt; close(): void };
const isBun = typeof (globalThis as { Bun?: unknown }).Bun !== 'undefined';

async function loadOpen(): Promise<(file: string) => Db> {
	if (isBun) {
		const m = await import('bun' + ':sqlite');
		return (file) => new m.Database(file) as unknown as Db;
	}
	const m = await import('node' + ':sqlite');
	return (file) => new m.DatabaseSync(file) as unknown as Db;
}

function buildCache(open: (file: string) => Db, dir: string): { file: string; ms: number } {
	const file = path.join(dir, 'cache.sqlite');
	for (const suffix of ['', '-wal', '-shm', '-journal']) fs.rmSync(file + suffix, { force: true });
	const t0 = performance.now();
	const db = open(file);
	db.exec('create table issue_file(file_path text primary key, file_modified_at integer not null, file_bytes integer not null, file_sha256 text not null, issue_id text, body text) strict');
	db.exec("create virtual table issue_fts using fts5(file_path unindexed, body, tokenize='trigram')");
	const items = itemsDirOf(dir);
	const insert = db.prepare('insert into issue_file values (?, ?, ?, ?, ?, ?)');
	const insertFts = db.prepare('insert into issue_fts values (?, ?)');
	db.exec('begin');
	for (const name of fs.readdirSync(items)) {
		if (!name.endsWith('.md')) continue;
		const abs = path.join(items, name);
		const buf = fs.readFileSync(abs);
		const st = fs.statSync(abs);
		const parts = splitIssue(buf.toString('utf8'));
		insert.run(name, Math.floor(st.mtimeMs), st.size, crypto.createHash('sha256').update(buf).digest('hex'), name.slice(0, 10), parts.body);
		insertFts.run(name, parts.body);
	}
	db.exec('commit');
	db.close();
	return { file, ms: performance.now() - t0 };
}

function validate(open: (file: string) => Db, file: string, dir: string): number {
	const db = open(file);
	const rows = db.prepare('select file_path, file_modified_at, file_bytes from issue_file').all() as { file_path: string; file_modified_at: number; file_bytes: number }[];
	const cached = new Map(rows.map((r) => [r.file_path, r]));
	const now = statAll(dir);
	let changed = 0;
	for (const [name, st] of now) {
		const c = cached.get(name);
		if (c === undefined || c.file_modified_at !== st.mtime || c.file_bytes !== st.bytes) changed++;
	}
	db.close();
	return changed;
}

/**
 * 後片付け。bun は、閉じた SQLite のファイルをしばらく掴んだままで、Windows では削除が EBUSY になる。
 * 計測の値には関係しないので、失敗しても止めず、残りは次の generate が消す
 */
function tryRemove(target: string): void {
	try {
		fs.rmSync(target, { recursive: true, force: true });
	} catch {
		console.log('(後片付けを飛ばした: 掴まれているファイルがある)');
	}
}

function fmt(x: number): string {
	return x < 10 ? x.toFixed(2) : x < 100 ? x.toFixed(1) : x.toFixed(0);
}

// ---- 実行 ----

const open = await loadOpen();
const runtime = isBun ? 'bun ' + (process.versions as { bun?: string }).bun : 'node ' + process.versions.node;
console.log('処理系: ' + runtime + ' ・ 各 ' + runs + ' 回の中央値 ・ 1 件 約 2.7 KB ・ OS のファイルキャッシュは温まっている');
console.log('');
console.log('| 件数 | check (全部読む検査) | read (全部読む) | stat (判定の最小限) | validate (キャッシュの判定) | キャッシュを作る | cold (起動を含む 1 回) |');
console.log('|---:|---:|---:|---:|---:|---:|---:|');

type SearchRow = { n: number; files2: number; like2: number; files5: number; like5: number; fts5: number };
const searchRows: SearchRow[] = [];

for (const n of counts) {
	const dir = generate(n);
	const check = measure(() => { checkProject(dir); });
	const read = measure(() => { readAll(dir); });
	const stat = measure(() => { statAll(dir); });
	const built = buildCache(open, dir);
	const val = measure(() => { validate(open, built.file, dir); });
	const cold = measure(() => { spawnSync(process.execPath, [main, 'check', '--root', dir], { encoding: 'utf8' }); }, 5);
	console.log(`| ${n} | ${fmt(check.wall)} ms (CPU ${fmt(check.cpu)}) | ${fmt(read.wall)} ms (CPU ${fmt(read.cpu)}) | ${fmt(stat.wall)} ms (CPU ${fmt(stat.cpu)}) | ${fmt(val.wall)} ms (CPU ${fmt(val.cpu)}) | ${fmt(built.ms)} ms | ${fmt(cold.wall)} ms |`);

	// 検索: 2 文字 (管理) と 5 文字 (表のまま出)。全部読む ・ LIKE ・ FTS5 trigram (3 文字以上だけ)
	const items = itemsDirOf(dir);
	const grep = (term: string): number => {
		let hit = 0;
		for (const name of fs.readdirSync(items)) {
			if (name.endsWith('.md') && fs.readFileSync(path.join(items, name), 'utf8').includes(term)) hit++;
		}
		return hit;
	};
	const sql = (text: string, ...params: unknown[]): number => {
		const db = open(built.file);
		const r = db.prepare(text).all(...params) as { c: number }[];
		db.close();
		return r[0].c;
	};
	searchRows.push({
		n,
		files2: measure(() => { grep('管理'); }, 3).wall,
		like2: measure(() => { sql("select count(*) as c from issue_file where body like '%管理%'"); }, 3).wall,
		files5: measure(() => { grep('表のまま出'); }, 3).wall,
		like5: measure(() => { sql("select count(*) as c from issue_file where body like '%表のまま出%'"); }, 3).wall,
		fts5: measure(() => { sql("select count(*) as c from issue_fts where issue_fts match '表のまま出'"); }, 3).wall,
	});
	tryRemove(dir);
}

console.log('');
console.log('| 件数 | 検索 2 文字: 全部読む | 検索 2 文字: LIKE | 検索 5 文字: 全部読む | 検索 5 文字: LIKE | 検索 5 文字: FTS5 trigram |');
console.log('|---:|---:|---:|---:|---:|---:|');
for (const r of searchRows) {
	console.log(`| ${r.n} | ${fmt(r.files2)} ms | ${fmt(r.like2)} ms | ${fmt(r.files5)} ms | ${fmt(r.like5)} ms | ${fmt(r.fts5)} ms |`);
}
// ---- 状態でフォルダを分けた場合 (todo / doing / done / archived) ----
// 「未・着手」だけを読めば足りる問い (一覧 ・ 検索) は、済が何件あっても、読む件数が変わらない。
// 割合は実測: ai-agent-tools は約 4% (3 / 72)、file-manager は約 14% (56 / 392)

function generateByState(n: number, openRatio: number): string {
	const dir = path.join(work, 'f' + n + '-' + Math.round(openRatio * 100));
	fs.rmSync(dir, { recursive: true, force: true });
	const open = Math.round(n * openRatio);
	for (const folder of ['todo', 'doing', 'done', 'archived']) fs.mkdirSync(path.join(itemsDirOf(dir), folder), { recursive: true });
	for (let i = 0; i < n; i++) {
		const folder = i < open ? (i % 2 === 0 ? 'todo' : 'doing') : (i % 10 < 7 ? 'done' : 'archived');
		const day = 1 + Math.floor(i / 1296);
		const id = 'i2611' + String(day).padStart(2, '0') + '-' + nn(i % 1296);
		const text = '---\nschema: 1\nid: ' + id + '\ntitle: 作り物の課題 ' + i + '\ngroup: bench\ncreated: 2026-11-0' + Math.min(day, 9) + '\n---\n' + body(i);
		fs.writeFileSync(path.join(itemsDirOf(dir), folder, id + '-bench' + i + '.md'), text);
	}
	return dir;
}

function readFolders(dir: string, folders: string[], term: string | null = null): number {
	let n = 0;
	for (const folder of folders) {
		const d = path.join(itemsDirOf(dir), folder);
		for (const name of fs.readdirSync(d)) {
			if (!name.endsWith('.md')) continue;
			const text = fs.readFileSync(path.join(d, name), 'utf8');
			if (term === null) n += splitIssue(text).parsed.pairs.length;
			else if (text.includes(term)) n++;
		}
	}
	return n;
}

console.log('');
console.log('状態でフォルダを分けた場合 (todo / doing / done / archived。未・着手 = todo + doing)');
console.log('');
console.log('| 件数 | 未・着手の割合 | 全部読む (4 つのフォルダ) | 未・着手だけ読む | 比 | 検索 5 文字: 全部読む | 検索 5 文字: 未・着手だけ |');
console.log('|---:|---:|---:|---:|---:|---:|---:|');
for (const n of counts) {
	for (const ratio of [0.04, 0.14]) {
		const dir = generateByState(n, ratio);
		const all = ['todo', 'doing', 'done', 'archived'];
		const part = ['todo', 'doing'];
		const readAllMs = measure(() => { readFolders(dir, all); });
		const readOpenMs = measure(() => { readFolders(dir, part); });
		const searchAllMs = measure(() => { readFolders(dir, all, '表のまま出'); }, 3);
		const searchOpenMs = measure(() => { readFolders(dir, part, '表のまま出'); }, 3);
		console.log(`| ${n} | ${Math.round(ratio * 100)}% | ${fmt(readAllMs.wall)} ms | ${fmt(readOpenMs.wall)} ms | ${fmt(readAllMs.wall / readOpenMs.wall)} 倍 | ${fmt(searchAllMs.wall)} ms | ${fmt(searchOpenMs.wall)} ms |`);
		tryRemove(dir);
	}
}
tryRemove(work);
