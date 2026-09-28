/*
	バイト列から文字コードを判定する。

	C# 版（src/ConvertEncoding/Detector.cs）の移植。判定の順も結果も合わせる。
*/

import type { EncKind } from './codec.ts';

function startsWith(bytes: Uint8Array, ...prefix: number[]): boolean {
	if (bytes.length < prefix.length) { return false; }
	for (let i = 0; i < prefix.length; i++) {
		if (bytes[i] !== prefix[i]) { return false; }
	}
	return true;
}

function isAscii(b: Uint8Array): boolean {
	for (let i = 0; i < b.length; i++) {
		if (b[i] > 0x7f) { return false; }
	}
	return true;
}

/**
 * UTF-8 の並びとして成立するか。
 * 過剰な長さの符号化（overlong）とサロゲート域は不正として弾く。
 * ここを通すと SJIS のファイルが UTF-8 と誤判定される場面が増える。
 *
 * 不正な位置が要るときは index を返す（読めないバイトの報告に使う）。
 */
export function findInvalidUtf8(b: Uint8Array): number {
	let i = 0;
	while (i < b.length) {
		const c = b[i];
		if (c <= 0x7f) { i++; continue; }

		let len: number;
		let min: number;
		if (c >= 0xc2 && c <= 0xdf) { len = 2; min = 0x80; }
		else if (c >= 0xe0 && c <= 0xef) { len = 3; min = 0x800; }
		else if (c >= 0xf0 && c <= 0xf4) { len = 4; min = 0x10000; }
		else { return i; }   // 0xC0 0xC1 0xF5〜0xFF は UTF-8 に現れない

		if (i + len > b.length) { return i; }

		let cp = c & (0xff >> (len + 1));
		for (let k = 1; k < len; k++) {
			const cc = b[i + k];
			if (cc < 0x80 || cc > 0xbf) { return i; }
			cp = (cp << 6) | (cc & 0x3f);
		}

		if (cp < min) { return i; }                        // overlong
		if (cp > 0x10ffff) { return i; }
		if (cp >= 0xd800 && cp <= 0xdfff) { return i; }    // サロゲート

		i += len;
	}
	return -1;
}

export function isValidUtf8(b: Uint8Array): boolean {
	return findInvalidUtf8(b) < 0;
}

/** CP932 の並びとして成立するか。不正な位置を返す（無ければ -1） */
export function findInvalidSjis(b: Uint8Array): number {
	let i = 0;
	while (i < b.length) {
		const c = b[i];
		if (c <= 0x7f) { i++; continue; }
		if (c >= 0xa1 && c <= 0xdf) { i++; continue; }   // 半角カナ

		if ((c >= 0x81 && c <= 0x9f) || (c >= 0xe0 && c <= 0xfc)) {
			if (i + 1 >= b.length) { return i; }
			const d = b[i + 1];
			if (d < 0x40 || d > 0xfc || d === 0x7f) { return i; }
			i += 2;
			continue;
		}

		return i;
	}
	return -1;
}

export function isValidSjis(b: Uint8Array): boolean {
	return findInvalidSjis(b) < 0;
}

// ---- 両方で成立するときの見分け（i260929-01） ----------------------------

// JIS 第一水準の漢字（SJIS の先頭 88〜98）。初めて要るときに作る
let level1: Set<string> | null = null;

function level1Kanji(): Set<string> {
	if (level1 != null) { return level1; }
	const dec = new TextDecoder('shift_jis');
	const set = new Set<string>();
	const pair = new Uint8Array(2);
	for (let a = 0x88; a <= 0x98; a++) {
		for (let t = 0x40; t <= 0xfc; t++) {
			if (t === 0x7f) { continue; }
			pair[0] = a; pair[1] = t;
			const ch = dec.decode(pair);
			if (ch.length === 1 && ch !== '�') { set.add(ch); }
		}
	}
	level1 = set;
	return set;
}

/** よく使う文字か。UTF-8 で読んだ側にも SJIS で読んだ側にも同じ物差しを当てる */
function isCommonChar(ch: string): boolean {
	const cp = ch.codePointAt(0)!;
	if (cp >= 0x3041 && cp <= 0x3096) { return true; }   // ひらがな
	if (cp >= 0x30a1 && cp <= 0x30fc) { return true; }   // カタカナ・長音
	if (cp >= 0x3000 && cp <= 0x3003) { return true; }   // 全角空白・、。〃
	if (cp >= 0xff01 && cp <= 0xff5e) { return true; }   // 全角英数
	if (cp >= 0xff61 && cp <= 0xff9f) { return true; }   // 半角カナ
	return level1Kanji().has(ch);
}

/** 非 ASCII の文字のうち、よく使う文字の割合。非 ASCII が無ければ 0 */
export function commonRatio(s: string): number {
	let n = 0;
	let ok = 0;
	for (const ch of s) {
		if (ch.codePointAt(0)! < 0x80) { continue; }
		n++;
		if (isCommonChar(ch)) { ok++; }
	}
	return n === 0 ? 0 : ok / n;
}

/**
 * UTF-8 と SJIS の両方で成立し、非 ASCII を含むバイト列を、読んだ文字の自然さで見分ける。
 * 決まらなければ null。
 *
 * でたらめなバイト列が UTF-8 として「かな・よく使う漢字」になることは少ない。
 * 一方、UTF-8 の日本語を SJIS で読むと 縺 繧 のような第二水準の字が混ざる。
 * 半角カナの SJIS（C2 B1 = ﾂｱ）を UTF-8 で読むと ± 等になり、よく使う文字に入らない。
 *
 * しきい値は計画書 i260929-01 の第 2 章（このリポジトリの cmd ・ ps1 の 2,257 行で実測）
 */
export function decideAmbiguous(bytes: Uint8Array): 'utf8' | 'sjis' | null {
	const nu = commonRatio(new TextDecoder('utf-8').decode(bytes));
	const ns = commonRatio(new TextDecoder('shift_jis').decode(bytes));
	if (nu >= 0.75 && nu > ns) { return 'utf8'; }
	if (ns >= 0.9 && nu <= 0.1) { return 'sjis'; }
	return null;
}

/**
 * BOM を見たあと、UTF-8 と SJIS の両方で検査してから決める。
 * 片方だけ妥当ならそれに決める。両方妥当で非 ASCII を含むものは
 * 読んだ文字の自然さで見分け（decideAmbiguous）、それでも決まらなければ
 * null を返し、呼び出し側は何も書き換えずに終える。
 *
 * 先に UTF-8 を試して確定させると、半角カタカナ（例: C2 B1 は
 * UTF-8 で「±」、SJIS で「ﾂｱ」）が UTF-8 と誤認され、SJIS の
 * つもりで置いたファイルの文字が失われる。
 */
export function detect(bytes: Uint8Array): EncKind | null {
	if (startsWith(bytes, 0xef, 0xbb, 0xbf)) { return 'utf8bom'; }
	if (startsWith(bytes, 0xff, 0xfe)) { return 'utf16le'; }
	if (startsWith(bytes, 0xfe, 0xff)) { return 'utf16be'; }

	const u8 = isValidUtf8(bytes);
	const sj = isValidSjis(bytes);

	if (u8 && sj) {
		// 純 ASCII はどちらに解釈しても変換結果のバイト列が同じ。
		// UTF-8 で確定してよい。非 ASCII を含むなら読んだ文字の自然さで見分ける
		if (isAscii(bytes)) { return 'utf8'; }
		return decideAmbiguous(bytes);
	}

	if (u8) { return 'utf8'; }
	if (sj) { return 'sjis'; }

	return null;
}

/**
 * 元の組として読めないバイトを探す。見つかればその位置、無ければ -1。
 * best-fit で別の文字に化けるのを防ぐため、書き込み前にデコード方向も検査する。
 */
export function findUndecodable(bytes: Uint8Array, kind: EncKind): number {
	let off = 0;
	if (kind === 'utf8' || kind === 'utf8bom') {
		if (startsWith(bytes, 0xef, 0xbb, 0xbf)) { off = 3; }
	} else if (kind === 'utf16le') {
		if (startsWith(bytes, 0xff, 0xfe)) { off = 2; }
	} else if (kind === 'utf16be') {
		if (startsWith(bytes, 0xfe, 0xff)) { off = 2; }
	}

	const body = bytes.subarray(off);

	if (kind === 'utf8' || kind === 'utf8bom') {
		const at = findInvalidUtf8(body);
		return at < 0 ? -1 : off + at;
	}
	if (kind === 'sjis') {
		// 構造として成立していても CP932 に割り当てが無い組がある（例: 85 40）。
		// 構造の検査だけでは通ってしまうので、実際に読めるかも見る
		const strict = new TextDecoder('shift_jis', { fatal: true });
		const at = findInvalidSjis(body);
		if (at >= 0) { return off + at; }
		let i = 0;
		while (i < body.length) {
			const c = body[i];
			const len = (c <= 0x7f || (c >= 0xa1 && c <= 0xdf)) ? 1 : 2;
			try {
				strict.decode(body.subarray(i, i + len));
			} catch {
				return off + i;
			}
			i += len;
		}
		return -1;
	}

	// UTF-16 は 2 バイト単位。奇数長なら末尾が読めない
	if (body.length % 2 !== 0) { return off + body.length - 1; }
	return -1;
}
