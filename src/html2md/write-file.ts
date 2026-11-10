/*
	中身が同じなら書き出さない。

	再変換のたびに書き直すと、中身が同じでも更新日時が変わり、git status で M になる
	（git update-index --refresh でも消えないことがあった。i261009-02）。
	書き出す前に既存のファイルとバイト列を比べ、同じならファイルに触らない。
*/
import * as fs from 'node:fs';
import { writeAtomic } from '../lib/write-atomic.ts';

/** 書いたら true、中身が同じで触らなかったら false。書くときは一時ファイルを経て置き換える (243-A) */
export function writeIfChanged(filePath: string, bytes: Uint8Array): boolean {
	if (fs.existsSync(filePath)) {
		const current = fs.readFileSync(filePath);
		if (current.length === bytes.length && Buffer.compare(current, bytes) === 0) { return false; }
	}
	writeAtomic(filePath, bytes);
	return true;
}
