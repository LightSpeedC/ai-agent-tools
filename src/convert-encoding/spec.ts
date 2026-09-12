/*
	用途名・文字コード名・改行名の対応。

	C# 版（src/ConvertEncoding/Spec.cs）の移植。
	表示する名前は EncKind の値そのもの（--to / --from に書く綴りと同じ）。
*/

import type { EncKind, EolKind } from '../lib/codec.ts';
import { isAscii } from '../lib/codec.ts';

/** --to に指定された内容。null は「変えない」を表す */
export interface TargetSpec {
	enc: EncKind | null;
	eol: EolKind | null;
}

/**
 * 用途名。ファイルの種類ごとに文字コードと改行の両方が決まる。
 * 新しい種類を足すときは、ここへ 1 行加えるだけでよい。
 */
const Profiles: Record<string, TargetSpec> = {
	ps1: { enc: 'utf8bom', eol: 'crlf' },
	cmd: { enc: 'sjis', eol: 'crlf' },
	bat: { enc: 'sjis', eol: 'crlf' },
	reg: { enc: 'utf16le', eol: 'crlf' },
	html: { enc: 'utf8bom', eol: 'lf' },
};

const Encodings: Record<string, EncKind> = {
	utf8: 'utf8',
	utf8bom: 'utf8bom',
	sjis: 'sjis',
	utf16le: 'utf16le',
	utf16be: 'utf16be',
};

const Eols: Record<string, EolKind> = {
	lf: 'lf',
	crlf: 'crlf',
};

export function describeTargetNames(): string {
	return '用途名 ps1 cmd bat reg html ／ 文字コード utf8 utf8bom sjis utf16le utf16be'
		+ ' ／ 改行を足すときは /lf /crlf';
}

export function describeSourceNames(): string {
	return 'utf8 utf8bom sjis utf16le utf16be（用途名 ps1 cmd bat reg html も可）';
}

/**
 * --to の値を解釈する。「用途名」「文字コード」「/改行」およびその組み合わせを受ける。
 */
export function parseTarget(text: string): { spec?: TargetSpec; error?: string } {
	if (text == null || text.length === 0) {
		return { error: '--to に値がありません。' };
	}

	let head = text;
	let tail: string | null = null;
	const slash = text.indexOf('/');
	if (slash >= 0) {
		head = text.substring(0, slash);
		tail = text.substring(slash + 1);
	}

	const result: TargetSpec = { enc: null, eol: null };

	// 前半は空でもよい（"/crlf" のように改行だけ指定する形）
	if (head.length > 0) {
		const profile = Profiles[head.toLowerCase()];
		if (profile != null) {
			result.enc = profile.enc;
			result.eol = profile.eol;
		} else {
			const enc = Encodings[head.toLowerCase()];
			if (enc == null) {
				return { error: '--to に指定できない名前です: ' + head + '\n使える名前: ' + describeTargetNames() };
			}
			result.enc = enc;
		}
	}

	// 後半があれば改行を上書きする
	if (tail != null) {
		const eol = Eols[tail.toLowerCase()];
		if (eol == null) {
			return { error: '改行の指定が正しくありません: ' + tail + '\n使える名前: lf crlf' };
		}
		result.eol = eol;
	}

	if (result.enc == null && result.eol == null) {
		return { error: '--to の指定が空です。' };
	}

	return { spec: result };
}

/**
 * --from の値を解釈する。文字コードだけを受け、改行の指定は認めない。
 * 用途名も受け付ける（--to と同じ語彙で書けるようにするため）。
 */
export function parseSource(text: string): { kind?: EncKind; error?: string } {
	if (text == null || text.length === 0) {
		return { error: '--from に値がありません。' };
	}

	if (text.indexOf('/') >= 0) {
		return { error: '--from に改行は指定できません。読み込みでは改行を区別しません。' };
	}

	const profile = Profiles[text.toLowerCase()];
	if (profile != null && profile.enc != null) { return { kind: profile.enc }; }

	const enc = Encodings[text.toLowerCase()];
	if (enc != null) { return { kind: enc }; }

	return { error: '--from に指定できない名前です: ' + text + '\n使える名前: ' + describeSourceNames() };
}

/**
 * 実際のファイルの組を表示するときの名前。純 ASCII は utf8 と sjis で
 * バイト列が同じになるため、どちらか一方の名前を出さず ascii と書く。
 * 「cmd なのに utf8」と読めてしまうのを防ぐのが目的で、
 * 判定する組は増やさない（--from ascii は受けない）。
 */
export function displayName(kind: EncKind, source: Uint8Array): string {
	if ((kind === 'utf8' || kind === 'sjis') && isAscii(source)) { return 'ascii'; }
	return kind;
}
