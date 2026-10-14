/*
	audio-files: 音声の引数 ・ 一覧ファイル（--list）・ フォルダ（--dir ＋ --ext）から、処理するファイルを集める。
	transcribe と convert-audio で共通（i261012-02）。

	cmd の入口を通すと 1 行の長さに上限があり、100 本を超える絶対パスを並べると落ちる（ai-chat-lite #1445）。
	引数に並べずに渡す口として、一覧ファイルとフォルダを受ける。
*/
import * as fs from 'node:fs';
import * as path from 'node:path';

export interface Sources {
	files: string[];
	lists: string[];
	dirs: string[];
	/** 小文字 ・ 先頭の . なし */
	exts: string[];
}

/** --list ・ --dir ・ --ext を読む。読んだら消費した数（1）を返し、該当しなければ null */
export function takeSourceOption(s: Sources, a: string, v: string | undefined): number | { error: string } | null {
	if (a !== '--list' && a !== '--dir' && a !== '--ext') { return null; }
	if (v === undefined || v.startsWith('--')) { return { error: a + ' に値がありません' }; }
	if (a === '--list') { s.lists.push(v); }
	else if (a === '--dir') { s.dirs.push(v); }
	else {
		for (const e of v.split(',')) {
			const x = e.trim().replace(/^\./, '').toLowerCase();
			if (x !== '') { s.exts.push(x); }
		}
	}
	return 1;
}

/** 引数を読み終えたあとの検査。null なら問題なし */
export function checkSources(s: Sources): string | null {
	if (s.dirs.length > 0 && s.exts.length === 0) { return '--dir には --ext で拡張子を渡してください（例: --ext "wav,mp3"）'; }
	if (s.exts.length > 0 && s.dirs.length === 0) { return '--ext は --dir と一緒に渡してください'; }
	if (s.files.length === 0 && s.lists.length === 0 && s.dirs.length === 0) { return '音声のファイルを渡してください（--list ・ --dir でも渡せます）'; }
	return null;
}

/** 処理するファイルを集める。引数 → 一覧 → フォルダの順で、重なり（大小を問わない）は最初の 1 回だけ残す */
export function collectFiles(s: Sources): { files: string[] } | { error: string } {
	const all: string[] = [...s.files];
	for (const l of s.lists) {
		if (!fs.existsSync(l) || !fs.statSync(l).isFile()) { return { error: '一覧ファイルが見つかりません: ' + l }; }
		const base = path.dirname(path.resolve(l));
		for (const line of fs.readFileSync(l, 'utf8').replace(/^﻿/, '').split(/\r?\n/)) {
			const t = line.trim();
			if (t === '' || t.startsWith('#')) { continue; }
			// 相対パスは一覧ファイルのあるフォルダから見る（決めたこと 5-A）
			all.push(path.resolve(base, t));
		}
	}
	for (const d of s.dirs) {
		if (!fs.existsSync(d) || !fs.statSync(d).isDirectory()) { return { error: 'フォルダが見つかりません: ' + d }; }
		// 下の階層は見ない（決めたこと 7-A）。同じ名前が別のフォルダにあると、--out でぶつかるため
		const names = fs.readdirSync(d, { withFileTypes: true })
			.filter(e => e.isFile() && s.exts.includes(path.extname(e.name).replace(/^\./, '').toLowerCase()))
			.map(e => e.name)
			.sort((x, y) => x.toLowerCase() < y.toLowerCase() ? -1 : x.toLowerCase() > y.toLowerCase() ? 1 : 0);
		if (names.length === 0) { return { error: 'フォルダに ' + s.exts.join(' ・ ') + ' のファイルがありません: ' + d }; }
		for (const n of names) { all.push(path.join(d, n)); }
	}
	const seen = new Set<string>();
	const files: string[] = [];
	for (const f of all) {
		// Windows は大小を区別しないので、小文字に寄せて比べる
		const key = path.resolve(f).toLowerCase();
		if (seen.has(key)) { continue; }
		seen.add(key);
		files.push(f);
	}
	return { files: files };
}
