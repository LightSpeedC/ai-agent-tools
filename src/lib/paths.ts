/*
	表示用にユーザープロファイルを ~ に伏せる。

	text（files.ts の show）が先に持っていたものを、html2md でも使うため
	共有にした（i260910-03。パスのマスキングが text だけ不揃いだった）。
*/

import * as os from 'node:os';

export function maskHome(p: string): string {
	const home = os.homedir();
	let s = p.replace(/\\/g, '/');
	if (home != null && home.length > 0) {
		const h = home.replace(/\\/g, '/');
		if (s.toLowerCase().startsWith(h.toLowerCase())) {
			s = '~' + s.substring(h.length);
		}
	}
	return s;
}
