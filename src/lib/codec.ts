/*
	文字コードと改行の変換。

	C# 版（src/ConvertEncoding/Converter.cs）の移植。挙動は合わせる。

	CP932 のエンコーダは標準に無い。TextDecoder は shift_jis を読めるが、
	TextEncoder は UTF-8 しか書けないため、<strong>2 バイト組を総当たりでデコードして
	逆引きを組み立てる</strong>（9,206 件・14 ms 程度）。依存を増やさずに済む。
*/

/** 文字コードの種類。名前がそのまま --to / --from の綴りになる */
export type EncKind = 'utf8' | 'utf8bom' | 'sjis' | 'utf16le' | 'utf16be';

/** 改行の種類 */
export type EolKind = 'lf' | 'crlf';

const Utf8Preamble = Uint8Array.from([0xef, 0xbb, 0xbf]);
const Utf16LePreamble = Uint8Array.from([0xff, 0xfe]);
const Utf16BePreamble = Uint8Array.from([0xfe, 0xff]);
const NoPreamble = new Uint8Array(0);

export function getPreamble(kind: EncKind): Uint8Array {
	switch (kind) {
		case 'utf8bom': return Utf8Preamble;
		case 'utf16le': return Utf16LePreamble;
		case 'utf16be': return Utf16BePreamble;
		default: return NoPreamble;
	}
}

export function startsWith(bytes: Uint8Array, prefix: Uint8Array): boolean {
	if (bytes.length < prefix.length) { return false; }
	for (let i = 0; i < prefix.length; i++) {
		if (bytes[i] !== prefix[i]) { return false; }
	}
	return true;
}

/** その組で BOM が付くなら、その長さを返す */
function preambleLength(bytes: Uint8Array, kind: EncKind): number {
	if (kind === 'utf8' || kind === 'utf8bom') {
		// utf8 指定でも BOM 付きのファイルを読めるようにしている
		return startsWith(bytes, Utf8Preamble) ? Utf8Preamble.length : 0;
	}
	if (kind === 'utf16le') { return startsWith(bytes, Utf16LePreamble) ? 2 : 0; }
	if (kind === 'utf16be') { return startsWith(bytes, Utf16BePreamble) ? 2 : 0; }
	return 0;
}

// ---- CP932 --------------------------------------------------------------

const sjisDecoder = new TextDecoder('shift_jis');

/** 逆引き（文字 → 2 バイト）。最初に使うときだけ組み立てる */
let sjisTable: Map<string, number> | null = null;

function sjisEncoder(): Map<string, number> {
	if (sjisTable != null) { return sjisTable; }

	const strict = new TextDecoder('shift_jis', { fatal: true });
	const map = new Map<string, number>();
	// 先に見つかった組を採る。低い側（NEC 選定 IBM 拡張）が優先になる
	for (let hi = 0x81; hi <= 0xfc; hi++) {
		for (let lo = 0x40; lo <= 0xfc; lo++) {
			if (lo === 0x7f) { continue; }
			try {
				const s = strict.decode(Uint8Array.from([hi, lo]));
				if (s.length === 1 && !map.has(s)) { map.set(s, (hi << 8) | lo); }
			} catch {
				// その組は CP932 に無い
			}
		}
	}
	sjisTable = map;
	return map;
}

/** 半角カナは 1 バイト。U+FF61〜U+FF9F が 0xA1〜0xDF に並ぶ */
function halfWidthKana(code: number): number {
	if (code >= 0xff61 && code <= 0xff9f) { return code - 0xff61 + 0xa1; }
	return -1;
}

/**
 * CP932 に書けない最初の文字を探す。見つからなければ null。
 * サロゲートペアは 1 文字として扱う（絵文字を 2 つに割らない）。
 */
export function findUnmappableSjis(text: string): { ch: string; codePoint: number; index: number } | null {
	const table = sjisEncoder();
	let i = 0;
	while (i < text.length) {
		const cp = text.codePointAt(i)!;
		const ch = String.fromCodePoint(cp);
		const wide = ch.length;   // サロゲートペアなら 2

		if (cp <= 0x7f || halfWidthKana(cp) >= 0 || table.has(ch)) {
			i += wide;
			continue;
		}
		return { ch: ch, codePoint: cp, index: i };
	}
	return null;
}

function encodeSjis(text: string): Uint8Array {
	const table = sjisEncoder();
	const out: number[] = [];
	let i = 0;
	while (i < text.length) {
		const cp = text.codePointAt(i)!;
		const ch = String.fromCodePoint(cp);
		i += ch.length;

		if (cp <= 0x7f) { out.push(cp); continue; }
		const kana = halfWidthKana(cp);
		if (kana >= 0) { out.push(kana); continue; }
		const v = table.get(ch);
		if (v === undefined) {
			out.push(0x3f);   // '?'。--force のときだけここに来る
			continue;
		}
		out.push(v >> 8, v & 0xff);
	}
	return Uint8Array.from(out);
}

// ---- デコード・エンコード ------------------------------------------------

/** バイト列を文字列にする。先頭に BOM があれば取り除く */
export function decode(bytes: Uint8Array, kind: EncKind): string {
	const off = preambleLength(bytes, kind);
	const body = bytes.subarray(off);

	switch (kind) {
		case 'utf8':
		case 'utf8bom':
			return new TextDecoder('utf-8').decode(body);
		case 'sjis':
			return sjisDecoder.decode(body);
		case 'utf16le':
			return decodeUtf16(body, false);
		case 'utf16be':
			return decodeUtf16(body, true);
	}
}

function decodeUtf16(body: Uint8Array, bigEndian: boolean): string {
	let s = '';
	for (let i = 0; i + 1 < body.length; i += 2) {
		const a = body[i];
		const b = body[i + 1];
		s += String.fromCharCode(bigEndian ? ((a << 8) | b) : ((b << 8) | a));
	}
	return s;
}

/** 文字列をバイト列にする。必要なら BOM を先頭に付ける */
export function encode(text: string, kind: EncKind): Uint8Array {
	let body: Uint8Array;
	switch (kind) {
		case 'utf8':
		case 'utf8bom':
			body = new TextEncoder().encode(text);
			break;
		case 'sjis':
			body = encodeSjis(text);
			break;
		case 'utf16le':
			body = encodeUtf16(text, false);
			break;
		case 'utf16be':
			body = encodeUtf16(text, true);
			break;
	}

	const pre = getPreamble(kind);
	if (pre.length === 0) { return body; }
	const result = new Uint8Array(pre.length + body.length);
	result.set(pre, 0);
	result.set(body, pre.length);
	return result;
}

function encodeUtf16(text: string, bigEndian: boolean): Uint8Array {
	const out = new Uint8Array(text.length * 2);
	for (let i = 0; i < text.length; i++) {
		const c = text.charCodeAt(i);
		if (bigEndian) { out[i * 2] = c >> 8; out[i * 2 + 1] = c & 0xff; }
		else { out[i * 2] = c & 0xff; out[i * 2 + 1] = c >> 8; }
	}
	return out;
}

// ---- 改行 ----------------------------------------------------------------

/**
 * 改行を揃える。いったんすべて LF に落としてから目的の改行にする。
 * CR 単独（旧 Mac 形式）もこの順で拾える。
 */
export function normalizeEol(text: string, eol: EolKind): string {
	const s = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
	return eol === 'crlf' ? s.replace(/\n/g, '\r\n') : s;
}

/**
 * バイト列のまま改行を揃える。UTF-8 と SJIS でだけ使う。
 * この 2 つは 0x0A / 0x0D が文字の途中に現れない（SJIS の 2 バイト目は
 * 0x40 以上、UTF-8 の続きバイトは 0x80 以上）ため、バイトを見て
 * 置き換えても文字を壊さない。デコードを通さないので、CP932 の
 * 重複文字が別のバイト列に化けることも起きない。
 */
export function normalizeEolBytes(src: Uint8Array, eol: EolKind): Uint8Array {
	const out: number[] = [];
	const crlf = eol === 'crlf';

	let i = 0;
	while (i < src.length) {
		const b = src[i];
		if (b === 0x0d) {
			// CR または CRLF。次が LF ならまとめて 1 つの改行として扱う
			if (i + 1 < src.length && src[i + 1] === 0x0a) { i++; }
			i++;
			if (crlf) { out.push(0x0d, 0x0a); } else { out.push(0x0a); }
		} else if (b === 0x0a) {
			i++;
			if (crlf) { out.push(0x0d, 0x0a); } else { out.push(0x0a); }
		} else {
			out.push(b);
			i++;
		}
	}
	return Uint8Array.from(out);
}

/** 改行の数を数える。表示と判定に使う */
export function countEol(text: string): { crlf: number; lf: number; cr: number } {
	let crlf = 0, lf = 0, cr = 0;
	for (let i = 0; i < text.length; i++) {
		const c = text[i];
		if (c === '\r') {
			if (i + 1 < text.length && text[i + 1] === '\n') { crlf++; i++; }
			else { cr++; }
		} else if (c === '\n') {
			lf++;
		}
	}
	return { crlf: crlf, lf: lf, cr: cr };
}

/**
 * 改行の状態を 1 語で表す。組の名前と同じく小文字に揃える
 * （「混在」「改行なし」は指定に書けない状態なので日本語のまま）。
 */
export function describeEol(crlf: number, lf: number, cr: number): string {
	let kinds = 0;
	if (crlf > 0) { kinds++; }
	if (lf > 0) { kinds++; }
	if (cr > 0) { kinds++; }

	if (kinds === 0) { return '改行なし'; }
	if (kinds > 1) { return '混在'; }
	if (crlf > 0) { return 'crlf'; }
	if (lf > 0) { return 'lf'; }
	return 'cr';
}

/**
 * 非 ASCII のバイトを含まないか。含まなければ utf8 と sjis で
 * バイト列が同じになり、どちらの組として扱っても結果が変わらない。
 */
export function isAscii(bytes: Uint8Array): boolean {
	for (let i = 0; i < bytes.length; i++) {
		if (bytes[i] > 0x7f) { return false; }
	}
	return true;
}

export function getLineNumber(text: string, index: number): number {
	let line = 1;
	const last = Math.min(index, text.length);
	for (let i = 0; i < last; i++) {
		if (text[i] === '\n') { line++; }
	}
	return line;
}

export function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
	if (a.length !== b.length) { return false; }
	for (let i = 0; i < a.length; i++) {
		if (a[i] !== b[i]) { return false; }
	}
	return true;
}
