/*
	git の管理下で、.gitignore で外したもの (フォルダとファイル) を求める。
	text find ・ replace (238-A) と check-markdown ・ walk の collect (242-A) が使う。
*/

import * as path from 'node:path';
import { spawnSync } from 'node:child_process';

/**
 * .gitignore で外したもの (フォルダとファイル) の絶対パスを、正規化した (小文字 ・ / 区切り) 集合で返す。
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
			set.add(normPath(path.join(base, rel.replace(/\/$/, ''))));
		}
		return set;
	} catch {
		return null;
	}
}

/** gitIgnored の集合と突き合わせる形 (小文字 ・ / 区切りの絶対パス) */
export function normPath(p: string): string {
	return path.resolve(p).replace(/\\/g, '/').toLowerCase();
}
