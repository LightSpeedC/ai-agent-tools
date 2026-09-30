/*
	text find — 文字コードを問わず素の文字列を探す。◎/■/◆ の入れ子で出す。
*/

import * as fs from 'node:fs';
import * as path from 'node:path';
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
const DefaultExcludeDirs = ['tmp', 'etc', 'node_modules', '.git'];

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

	let basePath = args.get('--path');
	// grep と同じ書き方 text find <語> <パス> を受ける。第 2 位置引数をパスにする。
	if (basePath == null && args.positional.length >= 2) { basePath = args.positional[1]; }
	if (basePath == null) { basePath = '.'; }
	const recurse = args.flag('-r', '--recurse');
	const ignoreCase = args.flag('-i', '--ignore-case');
	const bare = args.flag('--bare', '--bare');
	const from = args.get('--from');

	const inc = globs(args.get('--include'));
	const exc = globs(args.get('--exclude'));

	/*
		既定の除外に --exclude-dir を足す。
		--no-default-exclude を渡したときだけ既定を外す。
		**足す形にしているので、--exclude-dir を渡しても既定は消えない。**
	*/
	const excDir = dirSet(args.get('--exclude-dir'));
	if (!args.flag('--no-default-exclude', '--no-default-exclude')) {
		for (const d of DefaultExcludeDirs) { excDir.add(d); }
	}

	const baseFull = path.resolve(basePath);
	const baseIsFile = fs.existsSync(basePath) && fs.statSync(basePath).isFile();

	const targets: string[] = [];
	if (baseIsFile) { targets.push(path.resolve(basePath)); }
	else if (fs.existsSync(basePath) && fs.statSync(basePath).isDirectory()) {
		walk(baseFull, recurse, inc, exc, excDir, targets);
	} else {
		throw new ToolError(2, '対象がありません: ' + show(basePath));
	}

	const results: FileHits[] = [];
	for (const file of targets) {
		try {
			const fh = scan(file, baseFull, baseIsFile, from, keyword, ignoreCase);
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
	from: string | null, keyword: string, ignoreCase: boolean): FileHits | null {
	const bytes = new Uint8Array(fs.readFileSync(file));
	const combo = resolve(bytes, from);
	if (looksBinary(bytes, combo.enc)) { return null; }
	const text = decode(bytes, combo.enc);
	const lines = splitLines(text);

	const needle = ignoreCase ? keyword.toLowerCase() : keyword;
	const hits: Hit[] = [];
	for (let i = 0; i < lines.length; i++) {
		const content = lineContent(text, lines[i]);
		const hay = ignoreCase ? content.toLowerCase() : content;
		if (hay.indexOf(needle) >= 0) {
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

function walk(dir: string, recurse: boolean, inc: RegExp[], exc: RegExp[],
	excDir: Set<string>, outFiles: string[]): void {
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
		outFiles.push(path.join(dir, name));
	}

	if (!recurse) { return; }

	for (const ent of entries) {
		if (!ent.isDirectory()) { continue; }
		const name = ent.name;
		if (name === '.git') { continue; }
		if (name.startsWith('_')) { continue; }
		if (excDir.has(name.toLowerCase())) { continue; }
		walk(path.join(dir, name), true, inc, exc, excDir, outFiles);
	}
}

function relPath(baseFull: string, file: string): string {
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
