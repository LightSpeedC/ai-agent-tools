/*
	cc ・ cx ・ ag の共通部: 起こすフォルダを決める。
	いまの cc.cmd ・ cx.cmd の動きをそのまま写している。

	  1. 年のフォルダ (<置き場>/<yyyy>) を、無ければ作る
	  2. 置き場の直下で、名前の一部 (大小を区別しない) が当たるフォルダを探す
	  3. 無ければ、年のフォルダの中で探す
	  4. どちらにも無ければ、年のフォルダの中に <yyyymmdd>-<名前> を作る
	  複数に当たるときは、名前順で最初の 1 つ。フォルダだけを探す (ファイルは対象外)

	計画: notes/10_plan/i261101-02-ag-cmdと起動の共通部.html
*/

import * as fs from 'node:fs';
import * as path from 'node:path';

export interface Picked {
	dir: string;
	/** 既にあったフォルダか (新しく作ったなら false) */
	existing: boolean;
}

function pad2(n: number): string {
	return String(n).padStart(2, '0');
}

/** 年 ・ yyyymmdd ・ 月/日 ・ 時:分。cmd の %date% の並びに合わせる */
export function datePart(now: Date): { year: string; ymd: string; md: string; hm: string } {
	const year = String(now.getFullYear());
	const month = pad2(now.getMonth() + 1);
	const day = pad2(now.getDate());
	return {
		year,
		ymd: year + month + day,
		md: month + '/' + day,
		hm: pad2(now.getHours()) + ':' + pad2(now.getMinutes()),
	};
}

/** parent の直下のフォルダのうち、名前の一部が当たるものを、名前順に並べる */
function dirsMatching(parent: string, name: string): string[] {
	let entries: fs.Dirent[];
	try {
		entries = fs.readdirSync(parent, { withFileTypes: true });
	} catch {
		return [];
	}
	const needle = name.toLowerCase();
	return entries
		.filter((e) => e.isDirectory() && e.name.toLowerCase().includes(needle))
		.map((e) => e.name)
		.sort((a, b) => {
			const x = a.toLowerCase();
			const y = b.toLowerCase();
			return x < y ? -1 : x > y ? 1 : 0;
		})
		.map((n) => path.join(parent, n));
}

export function pickFolder(root: string, name: string, now: Date): Picked {
	const { year, ymd } = datePart(now);
	const yearDir = path.join(root, year);
	fs.mkdirSync(yearDir, { recursive: true });

	const found = dirsMatching(root, name)[0] ?? dirsMatching(yearDir, name)[0];
	if (found != null) { return { dir: found, existing: true }; }

	const dir = path.join(yearDir, ymd + '-' + name);
	fs.mkdirSync(dir, { recursive: true });
	return { dir, existing: false };
}
