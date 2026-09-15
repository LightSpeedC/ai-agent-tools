/*
	ファイルの文字コードと改行を変換する。

	    convert-encoding <path> --to <指定>[/<改行>] [--from <形式>] [--force]
	    convert-encoding <path> --info
	    convert-encoding <path> --check

	C# 版（src/ConvertEncoding/Program.cs）の移植。
	オプションも出力も終了コードも、現存と同じにしてある（突き合わせのため）。
*/

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as crypto from 'node:crypto';
import type { EncKind } from '../lib/codec.ts';
import {
	countEol, decode, describeEol, encode, getLineNumber,
	normalizeEol, normalizeEolBytes, sameBytes, startsWith,
} from '../lib/codec.ts';
import { getPreamble } from '../lib/codec.ts';
import { findUnmappableSjis } from '../lib/codec.ts';
import { detect, findUndecodable } from '../lib/detector.ts';
import { describeSourceNames, displayName, parseSource, parseTarget } from './spec.ts';
import type { TargetSpec } from './spec.ts';
import { formatCheck, formatInfo, inspect, walk } from './scan.ts';
import type { ScanEntry } from './scan.ts';

const ExitOk = 0;
const ExitBadArgs = 1;
const ExitNoFile = 2;
const ExitUnknownEncoding = 3;
const ExitUnmappable = 4;
const ExitWriteFailed = 5;

/** 標準出力へ UTF-8 で書く */
function out(text: string): void {
	process.stdout.write(text);
}

function fail(code: number, message: string): number {
	process.stderr.write('[NG] ' + message + '\n');
	return code;
}

function printUsage(): void {
	const lines = [
		'ファイルの文字コードと改行を変換します。',
		'',
		'  convert-encoding <path> --to <指定>[/<改行>] [--from <形式>] [--force]',
		'  convert-encoding <path> --info  [--include <glob>] [--exclude <glob>] [--exclude-dir <名前>]',
		'  convert-encoding <path> --check [--include <glob>] [--exclude <glob>] [--exclude-dir <名前>]',
		'  convert-encoding <path> --read',
		'  convert-encoding <path> --from hex',
		'  convert-encoding <path> --dump [--offset <n>] [--bytes <m>]',
		'',
		'--to の指定',
		'  ps1            UTF-8 BOM 付き ＋ CRLF',
		'  cmd  bat       SJIS（CP932）＋ CRLF',
		'  reg            UTF-16 LE ＋ BOM ＋ CRLF',
		'  html           UTF-8 BOM 付き ＋ LF',
		'  utf8  utf8bom  sjis  utf16le  utf16be',
		'                 文字コードだけを変える。改行は入力のまま',
		'  /lf  /crlf     改行を上書きする。単独で書くと改行だけ変える',
		'',
		'--info / --check',
		'  文字コードと改行を見るだけ。ファイルは書き換えません。',
		'  フォルダを渡すと、その下を再帰して見ます。',
		'  --info  全件を出す。終了コードは常に 0',
		'  --check 規約に合わないものだけを出す。あれば 1',
		'  あるべき組は拡張子で決まります（ps1 cmd bat reg html。',
		'  そのほかは BOM 無し UTF-8）。改行を定めていない拡張子（txt 等）は',
		'  改行を問いません。ただし改行が混ざっていれば、どの拡張子でも違反です。',
		'  既定で tmp etc node_modules .git ・ 先頭 _ ・ バイナリを見ません。',
		'  --exclude と --exclude-dir は既定に足します。',
		'',
		'--read',
		'  中身を UTF-8 で標準出力へ出す。ファイルは書き換えません。',
		'  SJIS のファイルを読むときに使います。',
		'',
		'--dump',
		'  中身を 16 進テキストで標準出力へ出す。ファイルは書き換えません。',
		'  --offset と --bytes で範囲を絞れます。出力は --from hex へ渡せます。',
		'',
		'--from の指定',
		'  省略すると自動で判定します。改行は書けません。',
		'  ' + describeSourceNames(),
		'  hex を渡すと、中身を 16 進テキストとみなしてバイト列に展開します。',
		'',
		'終了コード',
		'  0 成功  1 引数エラー（--check では規約に合わないものがある）  2 ファイル無し',
		'  3 文字コードを判定できない  4 表現できない文字がある  5 書き込み失敗',
	];
	out(lines.join('\n') + '\n');
}

/**
 * 同じフォルダに一時ファイルを作ってから置き換える。
 * 書き込みの途中で失敗しても元のファイルが壊れない。
 */
function writeAtomic(p: string, bytes: Uint8Array): void {
	const dir = path.dirname(path.resolve(p));
	const temp = path.join(dir, path.basename(p) + '.' + crypto.randomUUID().replace(/-/g, '') + '.tmp');

	fs.writeFileSync(temp, bytes);
	try {
		fs.renameSync(temp, p);
	} catch (e) {
		// 置き換えに失敗したら一時ファイルを残さない
		try { fs.unlinkSync(temp); } catch { /* 消せなくても元は無事 */ }
		throw e;
	}
}

/**
 * 16 進テキストをバイト列に直す。空白と改行は読み飛ばす。
 * 「41 80 42」「418042」「行ごとに分かれた形」のいずれも受ける。
 */
function parseHex(source: Uint8Array): { bytes?: Uint8Array; error?: string } {
	// 入力は 16 進なので ASCII しか現れない。BOM があれば取り除く
	let offset = 0;
	if (startsWith(source, getPreamble('utf8bom'))) { offset = 3; }
	const text = new TextDecoder('utf-8').decode(source.subarray(offset));

	const bytes: number[] = [];
	let high = -1;

	for (let i = 0; i < text.length; i++) {
		const c = text[i];
		if (c === ' ' || c === '\t' || c === '\r' || c === '\n') { continue; }

		const v = hexValue(c);
		if (v < 0) {
			return { error: '16 進として読めない文字があります: ' + (i + 1) + ' 文字目の \'' + c + '\'' };
		}

		if (high < 0) { high = v; }
		else { bytes.push((high << 4) | v); high = -1; }
	}

	if (high >= 0) {
		return { error: '16 進の桁数が奇数です。2 桁で 1 バイトになります。' };
	}

	return { bytes: Uint8Array.from(bytes) };
}

function hexValue(c: string): number {
	if (c >= '0' && c <= '9') { return c.charCodeAt(0) - 0x30; }
	if (c >= 'a' && c <= 'f') { return c.charCodeAt(0) - 0x61 + 10; }
	if (c >= 'A' && c <= 'F') { return c.charCodeAt(0) - 0x41 + 10; }
	return -1;
}

/**
 * バイト列を 16 進テキストにする。2 桁ずつ空白区切りで、16 バイトごとに改行。
 * 末尾にも改行 1 つ。人が目で追いやすいように折り返す（16 は hexdump の慣例）。
 * 空白も改行も --from hex が読み飛ばすため、折り返しても往復は保たれる。
 * offset がファイルを超えたら空、bytes が超えたらある分だけ出す。
 */
function dumpHex(source: Uint8Array, offset: number, count: number): string {
	const PerLine = 16;

	const start = offset < source.length ? offset : source.length;
	let end: number;
	if (count < 0) { end = source.length; }
	else {
		const e = start + count;
		end = e > source.length ? source.length : e;
	}

	let sb = '';
	let col = 0;
	for (let i = start; i < end; i++) {
		if (col === PerLine) { sb += '\n'; col = 0; }
		if (col > 0) { sb += ' '; }
		sb += source[i].toString(16).toUpperCase().padStart(2, '0');
		col++;
	}
	if (sb.length > 0) { sb += '\n'; }
	return sb;
}

/**
 * バイト列のまま改行を置き換えてよい文字コードか。0x0A / 0x0D が
 * 文字の途中に現れない単バイト安全なものだけ true。UTF-16 は
 * 改行が 2 バイトになり複雑なので対象にしない。
 */
function isByteSafeForEol(kind: EncKind): boolean {
	return kind === 'utf8' || kind === 'utf8bom' || kind === 'sjis';
}

/**
 * バイト保持パスに入る前提が正しいかの確認。--from で組を強制指定した場合、
 * 実際の先頭バイトが宣言と食い違っていることがある。両方向を見る。
 */
function hasCorrectPreamble(source: Uint8Array, kind: EncKind): boolean {
	const pre = getPreamble(kind);
	if (pre.length === 0) {
		// プリアンブルが要らない組（utf8・sjis）。UTF-8 の BOM で始まっていたら
		// それは別物なので、バイト保持パスに入れてはいけない
		return !startsWith(source, getPreamble('utf8bom'));
	}
	return startsWith(source, pre);
}

/** 見た結果を出す。--info は全件で常に 0、--check は違反だけで 0 か 1 */
function report(entries: ScanEntry[], check: boolean): number {
	if (!check) {
		out(formatInfo(entries));
		return ExitOk;
	}
	const r = formatCheck(entries);
	out(r.text);
	return r.bad > 0 ? 1 : ExitOk;
}

/** カンマ区切りでまとめて書けるようにする（text find と同じ語彙） */
function addCommaSeparated(list: string[], value: string): void {
	for (const part of value.split(',')) {
		const p = part.trim();
		if (p.length > 0) { list.push(p); }
	}
}

function withCommas(n: number): string {
	return n.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

function main(argv: string[]): number {
	let target: string | null = null;
	let toText: string | null = null;
	let fromText: string | null = null;
	let force = false;
	let info = false;
	let check = false;
	let read = false;
	let dump = false;
	let dumpOffset = 0;
	let dumpBytes = -1;   // -1 は末尾まで
	const include: string[] = [];
	const exclude: string[] = [];
	const excludeDirs: string[] = [];

	for (let i = 0; i < argv.length; i++) {
		const a = argv[i];

		if (a === '--help' || a === '-h' || a === '/?') {
			printUsage();
			return ExitOk;
		}
		if (a === '--to') {
			if (i + 1 >= argv.length) { return fail(ExitBadArgs, '--to に値がありません。'); }
			toText = argv[++i];
			continue;
		}
		if (a === '--from') {
			if (i + 1 >= argv.length) { return fail(ExitBadArgs, '--from に値がありません。'); }
			fromText = argv[++i];
			continue;
		}
		if (a === '--force') { force = true; continue; }
		if (a === '--info') { info = true; continue; }
		if (a === '--check') { check = true; continue; }
		if (a === '--read') { read = true; continue; }
		if (a === '--include') {
			if (i + 1 >= argv.length) { return fail(ExitBadArgs, '--include に値がありません。'); }
			addCommaSeparated(include, argv[++i]);
			continue;
		}
		if (a === '--exclude') {
			if (i + 1 >= argv.length) { return fail(ExitBadArgs, '--exclude に値がありません。'); }
			addCommaSeparated(exclude, argv[++i]);
			continue;
		}
		if (a === '--exclude-dir') {
			if (i + 1 >= argv.length) { return fail(ExitBadArgs, '--exclude-dir に値がありません。'); }
			addCommaSeparated(excludeDirs, argv[++i]);
			continue;
		}
		if (a === '--dump') { dump = true; continue; }
		if (a === '--offset') {
			if (i + 1 >= argv.length) { return fail(ExitBadArgs, '--offset に値がありません。'); }
			const v = Number(argv[++i]);
			if (!Number.isInteger(v) || v < 0) {
				return fail(ExitBadArgs, '--offset には 0 以上の整数を指定してください。');
			}
			dumpOffset = v;
			continue;
		}
		if (a === '--bytes') {
			if (i + 1 >= argv.length) { return fail(ExitBadArgs, '--bytes に値がありません。'); }
			const v = Number(argv[++i]);
			if (!Number.isInteger(v) || v < 0) {
				return fail(ExitBadArgs, '--bytes には 0 以上の整数を指定してください。');
			}
			dumpBytes = v;
			continue;
		}

		if (a.startsWith('-')) {
			return fail(ExitBadArgs, '知らないオプションです: ' + a);
		}

		if (target != null) {
			return fail(ExitBadArgs, 'ファイルは 1 つだけ指定してください。');
		}
		target = a;
	}

	if (target == null) {
		printUsage();
		return ExitBadArgs;
	}

	const expandHex = fromText != null && fromText.toLowerCase() === 'hex';

	if (!info && !check && !read && !dump && !expandHex && toText == null) {
		return fail(ExitBadArgs, '--to か --info か --check か --read を指定してください。');
	}

	// フォルダを見る（--info ・ --check）。書き込みは行わない
	if (info || check) {
		if (fs.existsSync(target) && fs.statSync(target).isDirectory()) {
			return report(walk(target, include, exclude, excludeDirs), check);
		}
		if (check) {
			// 1 ファイルでも同じ見方をする。合っていれば何も出さない
			if (!fs.existsSync(target)) {
				return fail(ExitNoFile, 'ファイルが見つかりません: ' + target);
			}
			const one: ScanEntry[] = [];
			const single = inspect(target, path.basename(target));
			if (single != null) { one.push(single); }
			return report(one, true);
		}
	}

	if (!fs.existsSync(target) || !fs.statSync(target).isFile()) {
		return fail(ExitNoFile, 'ファイルが見つかりません: ' + target);
	}

	let source: Uint8Array;
	try {
		source = new Uint8Array(fs.readFileSync(target));
	} catch (e) {
		return fail(ExitNoFile, 'ファイルを読めません: ' + target + ' (' + (e as Error).message + ')');
	}

	// バイト列を 16 進で出す。文字コードの判定は通さない
	if (dump) {
		out(dumpHex(source, dumpOffset, dumpBytes));
		return ExitOk;
	}

	// 16 進テキストの展開。文字コードの判定は通さない
	if (expandHex) {
		if (toText != null) {
			return fail(ExitBadArgs, '--from hex と --to は併用できません。展開だけを行います。');
		}
		if (read || info) {
			// --from hex はファイルを書き換える操作。読むつもりの上書きを防ぐ
			return fail(ExitBadArgs, '--from hex と --read/--info は併用できません（--from hex はファイルを書き換えます）。');
		}

		const parsed = parseHex(source);
		if (parsed.error != null) { return fail(ExitBadArgs, parsed.error); }
		const expanded = parsed.bytes!;

		const name0 = path.basename(target);
		if (sameBytes(source, expanded)) {
			out(name0 + '  変更なし\n');
			return ExitOk;
		}

		try {
			writeAtomic(target, expanded);
		} catch (e) {
			return fail(ExitWriteFailed, '書き込みに失敗しました: ' + (e as Error).message);
		}

		out(name0 + '  16 進 -> バイト列  ' + withCommas(source.length) + ' -> ' + withCommas(expanded.length) + ' bytes\n');
		return ExitOk;
	}

	// 変換元の文字コードを決める
	let fromKind: EncKind;
	if (fromText != null) {
		const r = parseSource(fromText);
		if (r.error != null) { return fail(ExitBadArgs, r.error); }
		fromKind = r.kind!;
	} else {
		const d = detect(source);
		if (d == null) {
			return fail(ExitUnknownEncoding, '文字コードを判定できません。--from で指定してください: ' + target);
		}
		fromKind = d;
	}

	const text = decode(source, fromKind);

	// --to は --read/--info と併用すると黙って無視されていた。
	// --from hex と同じ扱いで、はっきり拒否する（i260908-04 の CLI と資料7）
	if ((read || info) && toText != null) {
		return fail(ExitBadArgs, '--to と --read/--info は併用できません（--read/--info だけを行います）。');
	}

	// 中身を読むだけ
	if (read) {
		out(text);
		return ExitOk;
	}

	const counts = countEol(text);
	const fromEol = describeEol(counts.crlf, counts.lf, counts.cr);
	const name = path.basename(target);

	if (info) {
		out(name + '  ' + displayName(fromKind, source)
			+ '  crlf=' + counts.crlf + '  lf=' + counts.lf + '  cr=' + counts.cr
			+ '  ' + withCommas(source.length) + ' bytes\n');
		return ExitOk;
	}

	const parsedTo = parseTarget(toText!);
	if (parsedTo.error != null) { return fail(ExitBadArgs, parsedTo.error); }
	const spec: TargetSpec = parsedTo.spec!;

	const toKind: EncKind = spec.enc != null ? spec.enc : fromKind;

	// 文字コードが変わらず、単バイト安全な UTF-8 / SJIS のときは、
	// デコードを通さずバイト列のまま改行だけ置き換える。
	// CP932 の重複文字がデコード・エンコードで別のバイト列に化けるのを防ぐ
	if (toKind === fromKind && isByteSafeForEol(toKind) && hasCorrectPreamble(source, toKind)) {
		const kept = spec.eol != null ? normalizeEolBytes(source, spec.eol) : source;
		const keptEol: string = spec.eol != null ? spec.eol : fromEol;

		if (sameBytes(source, kept)) {
			out(name + '  ' + displayName(fromKind, source) + '+' + fromEol + '  変更なし\n');
			return ExitOk;
		}

		try {
			writeAtomic(target, kept);
		} catch (e) {
			return fail(ExitWriteFailed, '書き込みに失敗しました: ' + (e as Error).message);
		}

		out(name + '  ' + displayName(fromKind, source) + '+' + fromEol
			+ ' -> ' + displayName(toKind, kept) + '+' + keptEol
			+ '  ' + withCommas(source.length) + ' -> ' + withCommas(kept.length) + ' bytes\n');
		return ExitOk;
	}

	// ここに来るのは再エンコードする経路。元の組として読めないバイトがあれば止める
	if (!force) {
		const at = findUndecodable(source, fromKind);
		if (at >= 0) {
			process.stderr.write('[NG] ' + fromKind + ' として読めないバイトがあります（位置 ' + at + '）\n');
			process.stderr.write('     --from で組を指定するか、--force で ? として続行します\n');
			return ExitUnmappable;
		}
	}

	// 表現できない文字があれば、既定では何もせずに終える
	if (!force && toKind === 'sjis') {
		const bad = findUnmappableSjis(text);
		if (bad != null) {
			const line = getLineNumber(text, bad.index);
			process.stderr.write('[NG] ' + toKind + ' で表現できない文字があります: '
				+ line + ' 行目の \'' + bad.ch + '\' (U+'
				+ bad.codePoint.toString(16).toUpperCase().padStart(4, '0') + ')\n');
			process.stderr.write('     --force を付けると ? に置き換えて続行します\n');
			return ExitUnmappable;
		}
	}

	const converted = spec.eol != null ? normalizeEol(text, spec.eol) : text;
	const result = encode(converted, toKind);
	const toEol: string = spec.eol != null ? spec.eol : fromEol;

	if (sameBytes(source, result)) {
		out(name + '  ' + displayName(fromKind, source) + '+' + fromEol + '  変更なし\n');
		return ExitOk;
	}

	try {
		writeAtomic(target, result);
	} catch (e) {
		return fail(ExitWriteFailed, '書き込みに失敗しました: ' + (e as Error).message);
	}

	out(name + '  ' + displayName(fromKind, source) + '+' + fromEol
		+ ' -> ' + displayName(toKind, result) + '+' + toEol
		+ '  ' + withCommas(source.length) + ' -> ' + withCommas(result.length) + ' bytes\n');
	return ExitOk;
}

process.exit(main(process.argv.slice(2)));
