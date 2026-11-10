/*
	text find — 文字コードを問わず素の文字列 (--regex なら正規表現) を探す。◎/■/◆ の入れ子で出す。
*/

import * as fs from 'node:fs';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';
import { ToolError, comboName, decode, lineContent, looksBinary, mtimeOf, splitLines } from './engine.ts';
import { Args, out, resolve, show } from './files.ts';

const ValueOpts = new Set(['--path', '--include', '--exclude', '--exclude-dir', '--from']);

/*
	既定で外すフォルダ。

	素通しにしていたため、--recurse を素で撃つと etc/history/jsonl の
	会話ログまで読んでいた（i260913-02）。**共通ルール
	「.gitignore で除外されたものは原則として読まない／出力に含めない」を破る。**

	check-markdown ・ check-contrast は既にこの 4 つを外している。揃える。
	意図して見たいときは --no-default-exclude で解除できる。
*/
export const DefaultExcludeDirs = ['tmp', 'etc', 'node_modules', '.git'];

/**
 * 検索語から、行や全文に当てる正規表現を作る (228-B)。--regex でなければ、語を文字のまま探す形にする。
 * g を付けて返す。読めない正規表現は、終了コード 2
 */
export function makePattern(keyword: string, regex: boolean, ignoreCase: boolean): RegExp {
	const src = regex ? keyword : keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
	try {
		// m: ^ と $ を行の頭と終わりに当てる。find は行ごとに、replace は全文に当てるので、どちらでも同じ意味にする
		return new RegExp(src, 'gm' + (ignoreCase ? 'i' : '') + 'u');
	} catch (e) {
		throw new ToolError(2, '正規表現が読めません: ' + (e as Error).message);
	}
}

/** 対象のファイルを選ぶ (find ・ replace 共通)。--path ・ 第 2 位置引数 ・ -r ・ --include ・ --exclude ・ --exclude-dir */
export function selectTargets(args: Args, pathPos: number): { basePath: string; baseFull: string; baseIsFile: boolean; recurse: boolean; targets: string[] } {
	let basePath = args.get('--path');
	if (basePath == null && args.positional.length > pathPos) { basePath = args.positional[pathPos]; }
	if (basePath == null) { basePath = '.'; }
	const recurse = args.flag('-r', '--recurse');
	const inc = globs(args.get('--include'));
	const exc = globs(args.get('--exclude'));
	const excDir = dirSet(args.get('--exclude-dir'));
	if (!args.flag('--no-default-exclude', '--no-default-exclude')) {
		for (const d of DefaultExcludeDirs) { excDir.add(d); }
	}
	const baseFull = path.resolve(basePath);
	const baseIsFile = fs.existsSync(basePath) && fs.statSync(basePath).isFile();
	const targets: string[] = [];
	if (baseIsFile) { targets.push(path.resolve(basePath)); }
	else if (fs.existsSync(basePath) && fs.statSync(basePath).isDirectory()) {
		// 238-A: git の管理下では、.gitignore で外したものを読まない (--no-default-exclude で解除)
		const ignored = args.flag('--no-default-exclude', '--no-default-exclude') ? null : gitIgnored(baseFull);
		const skipped = { n: 0 };
		walk(baseFull, recurse, inc, exc, excDir, targets, ignored, skipped);
		if (skipped.n > 0) { process.stderr.write('.gitignore で外した ' + skipped.n + ' 件 (--no-default-exclude で読む)\n'); }
	} else {
		throw new ToolError(2, '対象がありません: ' + show(basePath));
	}
	return { basePath, baseFull, baseIsFile, recurse, targets };
}

interface Hit {
	lineNo: number;
	content: string;
}

interface FileHits {
	rel: string;
	sub: string;
	name: string;
	combo: string;
	size: number;
	mtime: string;
	hits: Hit[];
}

export function run(a: string[]): number {
	const args = Args.parse(a, ValueOpts);
	if (args.positional.length < 1) { throw new ToolError(2, '検索語を指定してください。'); }
	const keyword = args.positional[0];
	if (keyword.length === 0) { throw new ToolError(2, '検索語が空です。'); }

	// grep と同じ書き方 text find <語> <パス> を受ける。第 2 位置引数をパスにする。
	/*
		既定の除外に --exclude-dir を足す。
		--no-default-exclude を渡したときだけ既定を外す。
		**足す形にしているので、--exclude-dir を渡しても既定は消えない。**
	*/
	const { basePath, baseFull, baseIsFile, recurse, targets } = selectTargets(args, 1);
	const ignoreCase = args.flag('-i', '--ignore-case');
	const bare = args.flag('--bare', '--bare');
	const from = args.get('--from');
	const pattern = makePattern(keyword, args.flag('--regex', '--regex'), ignoreCase);

	const results: FileHits[] = [];
	for (const file of targets) {
		try {
			const fh = scan(file, baseFull, baseIsFile, from, pattern);
			if (fh != null && fh.hits.length > 0) { results.push(fh); }
		} catch {
			// 読めないファイルは飛ばす
		}
	}

	if (results.length === 0) { return 1; }

	if (bare) { outputBare(results); }
	else { outputGrouped(basePath, keyword, args, recurse, ignoreCase, results); }
	return 0;
}

function scan(file: string, baseFull: string, baseIsFile: boolean,
	from: string | null, pattern: RegExp): FileHits | null {
	const bytes = new Uint8Array(fs.readFileSync(file));
	const combo = resolve(bytes, from);
	if (looksBinary(bytes, combo.enc)) { return null; }
	const text = decode(bytes, combo.enc);
	const lines = splitLines(text);

	const hits: Hit[] = [];
	for (let i = 0; i < lines.length; i++) {
		const content = lineContent(text, lines[i]);
		pattern.lastIndex = 0;
		if (pattern.test(content)) {
			hits.push({ lineNo: i + 1, content: content });
		}
	}
	if (hits.length === 0) { return { rel: '', sub: '', name: '', combo: '', size: 0, mtime: '', hits: hits }; }

	const rel = baseIsFile ? path.basename(file) : relPath(baseFull, file);
	const slash = rel.lastIndexOf('/');
	return {
		rel: rel,
		sub: slash < 0 ? '.' : rel.substring(0, slash),
		name: slash < 0 ? rel : rel.substring(slash + 1),
		combo: comboName(combo),
		size: bytes.length,
		mtime: mtimeOf(fs.statSync(file).mtime),
		hits: hits,
	};
}

function outputGrouped(basePath: string, keyword: string, args: Args,
	recurse: boolean, ignoreCase: boolean, results: FileHits[]): void {
	results.sort((x, y) => {
		if (x.sub !== y.sub) { return x.sub < y.sub ? -1 : 1; }
		if (x.name !== y.name) { return x.name < y.name ? -1 : 1; }
		return 0;
	});

	out('◎"' + show(basePath) + '"');
	let opt = '  検索="' + keyword + '"';
	const include = args.get('--include');
	if (include != null) { opt += '  対象="' + include + '"'; }
	if (recurse) { opt += '  再帰'; }
	if (!ignoreCase) { opt += '  大小区別'; }
	if (args.flag('--regex', '--regex')) { opt += '  正規表現'; }
	out(opt);

	let curSub: string | null = null;
	for (const fh of results) {
		if (curSub !== fh.sub) {
			out('■"' + fh.sub + '"');
			curSub = fh.sub;
		}
		out('◆"' + fh.name + '" [' + fh.combo + '] size=' + fh.size + ' mtime=' + fh.mtime);
		for (const h of fh.hits) {
			out(String(h.lineNo).padStart(6, ' ') + ':\t' + h.content);
		}
	}
}

function outputBare(results: FileHits[]): void {
	for (const fh of results) {
		for (const h of fh.hits) {
			out(fh.rel + ':' + h.lineNo + ':' + h.content);
		}
	}
}

/**
 * .gitignore で外したもの (フォルダとファイル) の絶対パスを、小文字にした集合で返す (238-A)。
 * git の管理下でない ・ git が無い ・ base そのものが外されている (利用者が名指しした) ときは null。
 * git ls-files --directory は、外したフォルダを中まで見ずに 1 行で返すので、大きい target も読まない
 */
export function gitIgnored(base: string): Set<string> | null {
	const git = (args: string[]) => spawnSync('git', ['-C', base, ...args], { encoding: 'utf8', windowsHide: true, maxBuffer: 64 * 1024 * 1024 });
	try {
		const inside = git(['rev-parse', '--is-inside-work-tree']);
		if (inside.status !== 0 || inside.stdout.trim() !== 'true') { return null; }
		// base が外されているかは、リポジトリの頭でなければ絶対パスで聞く。'.' で聞くと、
		// 利用者の全体の .gitignore の書き方によっては頭でも「外した」と返る (実測)
		const prefix = git(['rev-parse', '--show-prefix']);
		if (prefix.status !== 0) { return null; }
		if (prefix.stdout.trim() !== '' && git(['check-ignore', '-q', '--', base]).status === 0) { return null; }
		const ls = git(['ls-files', '-o', '-i', '--exclude-standard', '--directory', '-z']);
		if (ls.status !== 0) { return null; }
		const set = new Set<string>();
		for (const rel of ls.stdout.split('\0')) {
			if (rel === '') { continue; }
			set.add(norm(path.join(base, rel.replace(/\/$/, ''))));
		}
		return set;
	} catch {
		return null;
	}
}

function norm(p: string): string {
	return path.resolve(p).replace(/\\/g, '/').toLowerCase();
}

export function walk(dir: string, recurse: boolean, inc: RegExp[], exc: RegExp[],
	excDir: Set<string>, outFiles: string[], ignored: Set<string> | null = null, skipped: { n: number } = { n: 0 }): void {
	let entries: fs.Dirent[];
	try {
		entries = fs.readdirSync(dir, { withFileTypes: true });
	} catch {
		return;
	}

	for (const ent of entries) {
		if (!ent.isFile()) { continue; }
		const name = ent.name;
		if (inc.length > 0 && !matchAny(inc, name)) { continue; }
		if (exc.length > 0 && matchAny(exc, name)) { continue; }
		if (ignored !== null && ignored.has(norm(path.join(dir, name)))) { skipped.n++; continue; }
		outFiles.push(path.join(dir, name));
	}

	if (!recurse) { return; }

	for (const ent of entries) {
		if (!ent.isDirectory()) { continue; }
		const name = ent.name;
		if (name === '.git') { continue; }
		if (name.startsWith('_')) { continue; }
		if (excDir.has(name.toLowerCase())) { continue; }
		if (ignored !== null && ignored.has(norm(path.join(dir, name)))) { skipped.n++; continue; }
		walk(path.join(dir, name), true, inc, exc, excDir, outFiles, ignored, skipped);
	}
}

export function relPath(baseFull: string, file: string): string {
	const b = baseFull.replace(/\\/g, '/').replace(/\/+$/, '');
	const f = path.resolve(file).replace(/\\/g, '/');
	if (f.toLowerCase().startsWith((b + '/').toLowerCase())) {
		return f.substring(b.length + 1);
	}
	return f;
}

function globs(csv: string | null): RegExp[] {
	const list: RegExp[] = [];
	if (csv == null || csv.length === 0) { return list; }
	for (const part of csv.split(',')) {
		const g = part.trim();
		if (g.length === 0) { continue; }
		list.push(new RegExp(globToRegex(g), 'i'));
	}
	return list;
}

function dirSet(csv: string | null): Set<string> {
	const set = new Set<string>();
	if (csv == null || csv.length === 0) { return set; }
	for (const part of csv.split(',')) {
		const d = part.trim();
		if (d.length > 0) { set.add(d.toLowerCase()); }
	}
	return set;
}

function matchAny(pats: RegExp[], name: string): boolean {
	for (const r of pats) { if (r.test(name)) { return true; } }
	return false;
}

function globToRegex(glob: string): string {
	let sb = '^';
	for (const ch of glob) {
		if (ch === '*') { sb += '.*'; }
		else if (ch === '?') { sb += '.'; }
		else { sb += ch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
	}
	return sb + '$';
}
