/*
	text の土台。組の判定・デコード・エンコード・行割り・合言葉。

	C# 版（src/Text/Engine.cs）の移植。挙動は合わせる。

	文字コードの中核は convert-encoding と同じものを使う（CP932 の逆引きなど）。
	2 本で別々に持つと、片方だけ直したときに食い違う。
*/

import {
	decode as codecDecode, encode as codecEncode,
	findUnmappableSjis, getPreamble, isAscii, startsWith,
} from '../lib/codec.ts';
import type { EncKind } from '../lib/codec.ts';
import { decideAmbiguous, isValidSjis, isValidUtf8 } from '../lib/detector.ts';

export type { EncKind };

/** 改行の種類。text は「改行なし」も区別する */
export type EolKind = 'crlf' | 'lf' | 'cr' | 'none';

/** 終了コード付きのエラー */
export class ToolError extends Error {
	readonly code: number;
	constructor(code: number, message: string) {
		super(message);
		this.code = code;
	}
}

/** 判定した組 */
export interface Combo {
	enc: EncKind;
	eol: EolKind;
	/** UTF-8 と SJIS の両方で妥当（非 ASCII） */
	ambiguous: boolean;
	/** 非 ASCII のバイトが無い（utf8 と sjis でバイト列が同じ） */
	ascii: boolean;
}

/**
 * 表示する組。純 ASCII は utf8 と sjis を区別できないので ascii と書く
 * （「cmd なのに utf8」と読めてしまうのを防ぐ）。
 * 判定する組は増やさないので --from ascii は受けない。
 * --from で明示された組は、そのままの名前で出す。
 */
export function comboName(c: Combo): string {
	const enc = (c.ascii && (c.enc === 'utf8' || c.enc === 'sjis')) ? 'ascii' : c.enc;
	return enc + '/' + c.eol;
}

// ---- 名前 ----------------------------------------------------------------

const EncMap: Record<string, EncKind> = {
	utf8: 'utf8',
	utf8bom: 'utf8bom',
	sjis: 'sjis',
	utf16le: 'utf16le',
	utf16be: 'utf16be',
};

/** --to の用途名。文字コードと改行の両方が決まる */
const ToMap: Record<string, { enc: EncKind; eol: EolKind }> = {
	cmd: { enc: 'sjis', eol: 'crlf' },
	bat: { enc: 'sjis', eol: 'crlf' },
	ps1: { enc: 'utf8bom', eol: 'crlf' },
	html: { enc: 'utf8bom', eol: 'lf' },
	reg: { enc: 'utf16le', eol: 'crlf' },
	utf8: { enc: 'utf8', eol: 'lf' },
};

export function parseFrom(text: string): EncKind {
	if (text == null || text.length === 0) { throw new ToolError(2, '--from に値がありません。'); }
	const k = EncMap[text.toLowerCase()];
	if (k != null) { return k; }
	throw new ToolError(2, '--from に指定できない名前です: ' + text
		+ ' ／ 使える名前: utf8 utf8bom sjis utf16le utf16be');
}

export function parseTo(text: string): { enc: EncKind; eol: EolKind } {
	if (text == null || text.length === 0) { throw new ToolError(2, '--to に値がありません。'); }
	const v = ToMap[text.toLowerCase()];
	if (v != null) { return v; }
	throw new ToolError(2, '--to に指定できない用途名です: ' + text
		+ ' ／ 使える用途名: cmd bat ps1 html reg utf8');
}

// ---- 判定 ----------------------------------------------------------------

/** UTF-16 でないのに NUL を含めばバイナリとみなす */
export function looksBinary(b: Uint8Array, enc: EncKind): boolean {
	if (enc === 'utf16le' || enc === 'utf16be') { return false; }
	for (let i = 0; i < b.length; i++) { if (b[i] === 0x00) { return true; } }
	return false;
}

/** 改行はデコード後の文字で見る（UTF-16 はバイトでは正しく数えられない） */
export function eolOf(b: Uint8Array, enc: EncKind): EolKind {
	const s = decode(b, enc);
	let crlf = false, lf = false, cr = false;
	for (let i = 0; i < s.length; i++) {
		if (s[i] === '\r') {
			if (i + 1 < s.length && s[i + 1] === '\n') { crlf = true; i++; }
			else { cr = true; }
		} else if (s[i] === '\n') { lf = true; }
	}
	if (crlf) { return 'crlf'; }
	if (lf) { return 'lf'; }
	if (cr) { return 'cr'; }
	return 'none';
}

/**
 * BOM → UTF-8 厳密妥当 → SJIS の順で決める。
 * UTF-8 と SJIS の両方で妥当かつ非 ASCII のときは、読んだ文字の自然さで
 * 見分ける（decideAmbiguous。convert-encoding と同じ判定）。それでも決まらない
 * ときだけ ambiguous を立てる（read/find は UTF-8 に倒し、edit/write は拒否する）。
 */
export function detectCombo(b: Uint8Array): Combo {
	let enc: EncKind;
	let ambiguous = false;

	if (startsWith(b, getPreamble('utf8bom'))) { enc = 'utf8bom'; }
	else if (startsWith(b, getPreamble('utf16le'))) { enc = 'utf16le'; }
	else if (startsWith(b, getPreamble('utf16be'))) { enc = 'utf16be'; }
	else {
		const u8 = isValidUtf8(b);
		const sj = isValidSjis(b);
		if (u8 && sj) {
			enc = 'utf8';
			if (!isAscii(b)) {
				const d = decideAmbiguous(b);
				if (d == null) { ambiguous = true; }
				else { enc = d; }
			}
		}
		else if (u8) { enc = 'utf8'; }
		else if (sj) { enc = 'sjis'; }
		else { enc = 'sjis'; }   // どちらでもない。生バイトを保つ
	}

	return { enc: enc, eol: eolOf(b, enc), ambiguous: ambiguous, ascii: isAscii(b) };
}

// ---- デコード・エンコード ------------------------------------------------

export function decode(b: Uint8Array, k: EncKind): string {
	return codecDecode(b, k);
}

/** 文字列をバイト列に。BOM は付けない（呼び出し側の splice 用） */
export function encodeRaw(s: string, k: EncKind): Uint8Array {
	const full = codecEncode(s, k);
	const pre = getPreamble(k);
	return pre.length === 0 ? full : full.subarray(pre.length);
}

/** プリアンブル込みでエンコード（全書き用） */
export function encodeFull(s: string, k: EncKind): Uint8Array {
	return codecEncode(s, k);
}

/** 先頭にプリアンブルがあれば、その長さ（無ければ 0） */
export function preambleLen(b: Uint8Array, k: EncKind): number {
	// utf8 指定でも BOM 付きのファイルを読めるようにしている
	const pre = k === 'utf8' ? getPreamble('utf8bom') : getPreamble(k);
	return (pre.length > 0 && startsWith(b, pre)) ? pre.length : 0;
}

/**
 * 変換先で表現できない文字を 1 つ探す。見つかれば返す。
 * いま表現できない組が出るのは CP932 だけ（UTF-8 系はすべて書ける）。
 */
export function findUnmappable(text: string, kind: EncKind): { ch: string; codePoint: number } | null {
	if (kind !== 'sjis') { return null; }
	const bad = findUnmappableSjis(text);
	return bad == null ? null : { ch: bad.ch, codePoint: bad.codePoint };
}

// ---- 合言葉 --------------------------------------------------------------

/** 更新日時の表記 yymmdd-hhmmss-ccc（ローカル時刻） */
export function mtimeOf(d: Date): string {
	const p2 = (n: number) => String(n).padStart(2, '0');
	const p3 = (n: number) => String(n).padStart(3, '0');
	return String(d.getFullYear() % 100).padStart(2, '0')
		+ p2(d.getMonth() + 1) + p2(d.getDate())
		+ '-' + p2(d.getHours()) + p2(d.getMinutes()) + p2(d.getSeconds())
		+ '-' + p3(d.getMilliseconds());
}

let crcTable: Uint32Array | null = null;

function crc32(data: Uint8Array): number {
	if (crcTable == null) {
		const t = new Uint32Array(256);
		for (let n = 0; n < 256; n++) {
			let c = n;
			for (let k = 0; k < 8; k++) {
				c = (c & 1) !== 0 ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
			}
			t[n] = c >>> 0;
		}
		crcTable = t;
	}
	let crc = 0xffffffff;
	for (let i = 0; i < data.length; i++) {
		crc = crcTable[(crc ^ data[i]) & 0xff] ^ (crc >>> 8);
	}
	return (crc ^ 0xffffffff) >>> 0;
}

/**
 * 範囲テキスト（改行を LF に正規化）＋ サイズ ＋ 更新日時 から 8 hex。
 * 暗号強度は不要なので CRC32。1 対 1 の突き合わせなので 32 bit で足りる。
 */
export function computeDigest(rangeText: string, size: number, mtime: string): string {
	const norm = rangeText.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
	const s = norm + '\x1f' + size + '\x1f' + mtime;
	const bytes = new TextEncoder().encode(s);
	return crc32(bytes).toString(16).padStart(8, '0');
}

// ---- 行 ------------------------------------------------------------------

/** 1 行の範囲（デコード後の文字インデックス） */
export interface Line {
	start: number;        // 行頭
	contentEnd: number;   // 改行の直前
	fullEnd: number;      // 次の行頭（改行を含む）
}

/** デコード済み文字列を行に割る */
export function splitLines(s: string): Line[] {
	const list: Line[] = [];
	let start = 0;
	let i = 0;
	while (i < s.length) {
		const ch = s[i];
		if (ch === '\n') {
			list.push({ start: start, contentEnd: i, fullEnd: i + 1 });
			i++; start = i;
		} else if (ch === '\r') {
			const nl = (i + 1 < s.length && s[i + 1] === '\n') ? i + 2 : i + 1;
			list.push({ start: start, contentEnd: i, fullEnd: nl });
			i = nl; start = i;
		} else { i++; }
	}
	// 末尾に改行が無い最後の行
	if (start < s.length || list.length === 0) {
		list.push({ start: start, contentEnd: s.length, fullEnd: s.length });
	}
	return list;
}

/** 行の内容（改行を除く） */
export function lineContent(s: string, ln: Line): string {
	return s.substring(ln.start, ln.contentEnd);
}
