/*
	対象のファイルを集める。

	check-markdown ・ check-contrast が同じ集め方をするため切り出した。
	フォルダなら拡張子で絞り、ファイルならそれ 1 つを返す。
*/

import * as fs from 'node:fs';
import * as path from 'node:path';

export type CollectResult = {
	files: string[];
	/** 対象がフォルダなら、その絶対パス。ファイルならその親。表示を相対にするのに使う */
	root: string;
	/** 対象が見つからない */
	missing: boolean;
};

function walk(dir: string, ext: string, recurse: boolean, out: string[]): void {
	let entries: fs.Dirent[];
	try {
		entries = fs.readdirSync(dir, { withFileTypes: true });
	} catch {
		return;
	}
	for (const e of entries) {
		const full = path.join(dir, e.name);
		if (e.isDirectory()) {
			if (recurse) { walk(full, ext, recurse, out); }
			continue;
		}
		if (e.isFile() && e.name.toLowerCase().endsWith(ext)) { out.push(full); }
	}
}

/**
 * 集める。exclude は除外するパスの正規表現で、PowerShell 版と同じ書き方を受ける。
 * 突き合わせは区切りを \ に寄せてから行う（既存の指定が \\(tmp|etc)\\ の形のため）。
 */
export function collect(target: string, ext: string, recurse: boolean, exclude: string): CollectResult {
	if (!fs.existsSync(target)) {
		return { files: [], root: '', missing: true };
	}

	const abs = path.resolve(target);
	const st = fs.statSync(abs);
	if (!st.isDirectory()) {
		return { files: [abs], root: path.dirname(abs), missing: false };
	}

	const found: string[] = [];
	walk(abs, ext, recurse, found);

	const re = exclude.length > 0 ? new RegExp(exclude) : null;
	const kept = found.filter((f) => re == null || !re.test(f.split('/').join('\\')));
	kept.sort();
	return { files: kept, root: abs, missing: false };
}

/** 表示用に root からの相対にする */
export function relativeTo(root: string, file: string): string {
	const rel = path.relative(root, file);
	return rel.length > 0 ? rel : path.basename(file);
}
