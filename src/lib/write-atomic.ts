/*
	ファイルを原子的に書く (243-A)。同じフォルダの一時ファイルに書いてから、名前を置き換える。
	途中で止まっても、元のファイルか新しいファイルのどちらかが残り、半分だけ書かれたものは残らない。
	html2md ・ history2html ・ text ・ convert-encoding が、この 1 つを使う。
*/

import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';

export function writeAtomic(p: string, bytes: Uint8Array): void {
	const full = path.resolve(p);
	const temp = path.join(path.dirname(full), path.basename(full) + '.' + crypto.randomUUID().replace(/-/g, '') + '.tmp');
	fs.writeFileSync(temp, bytes);
	try {
		fs.renameSync(temp, full);
	} catch (e) {
		// 置き換えに失敗したら一時ファイルを残さない
		try { fs.unlinkSync(temp); } catch { /* 消せなくても元は無事 */ }
		throw e;
	}
}
