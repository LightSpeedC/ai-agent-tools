/*
	対象のファイルを集める。

	check-markdown ・ check-contrast が同じ集め方をするため切り出した。
	フォルダなら拡張子で絞り、ファイルならそれ 1 つを返す。
*/

import * as fs from 'node:fs';
import * as path from 'node:path';
import { gitIgnored, normPath } from './gitignore.ts';

export type CollectResult = {
	files: string[];
	/** 対象がフォルダなら、その絶対パス。ファイルならその親。表示を相対にするのに使う */
	root: string;
	/** 対象が見つからない */
	missing: boolean;
	/** exclude で落とした件数 */
	excluded: number;
	/** .gitignore で外した件数 (フォルダは 1 件と数える。gitignore を渡したときだけ) */
	ignored: number;
};

function walk(dir: string, ext: string, recurse: boolean, out: string[], ignoredSet: Set<string> | null, skipped: { n: number }): void {
	let entries: fs.Dirent[];
	try {
		entries = fs.readdirSync(dir, { withFileTypes: true });
	} catch {
		return;
	}
	for (const e of entries) {
		const full = path.join(dir, e.name);
		if (e.isDirectory()) {
			if (!recurse) { continue; }
			if (ignoredSet !== null && ignoredSet.has(normPath(full))) { skipped.n++; continue; }
			walk(full, ext, recurse, out, ignoredSet, skipped);
			continue;
		}
		if (e.isFile() && e.name.toLowerCase().endsWith(ext)) {
			if (ignoredSet !== null && ignoredSet.has(normPath(full))) { skipped.n++; continue; }
			out.push(full);
		}
	}
}

/**
 * 集める。exclude は除外するパスの正規表現で、PowerShell 版と同じ書き方を受ける。
 * 突き合わせは区切りを \ に寄せてから行う（既存の指定が \\(tmp|etc)\\ の形のため）。
 */
export function collect(target: string, ext: string, recurse: boolean, exclude: string, gitignore: boolean = false): CollectResult {
	if (!fs.existsSync(target)) {
		return { files: [], root: '', missing: true, excluded: 0, ignored: 0 };
	}

	const abs = path.resolve(target);
	const st = fs.statSync(abs);
	if (!st.isDirectory()) {
		// 名指ししたファイルは、外されていても対象にする
		return { files: [abs], root: path.dirname(abs), missing: false, excluded: 0, ignored: 0 };
	}

	// 242-A: gitignore なら、git の管理下で .gitignore で外したものを集めない
	const ignoredSet = gitignore ? gitIgnored(abs) : null;
	const skipped = { n: 0 };
	const found: string[] = [];
	walk(abs, ext, recurse, found, ignoredSet, skipped);

	const re = exclude.length > 0 ? new RegExp(exclude) : null;
	const kept = found.filter((f) => re == null || !re.test(f.split('/').join('\\')));
	kept.sort();
	return { files: kept, root: abs, missing: false, excluded: found.length - kept.length, ignored: skipped.n };
}

/** 表示用に root からの相対にする */
export function relativeTo(root: string, file: string): string {
	const rel = path.relative(root, file);
	return rel.length > 0 ? rel : path.basename(file);
}
