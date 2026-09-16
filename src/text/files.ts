/*
	引数の解釈・ファイルの読み書き・出力。

	C# 版（src/TextCs/Program.cs）の Args ・ Files ・ Io を移したもの。
*/

import * as fs from 'node:fs';
import * as path from 'node:path';
import * as crypto from 'node:crypto';
import { maskHome } from '../lib/paths.ts';
import type { Combo, EncKind } from './engine.ts';
import {
	ToolError, computeDigest, detectCombo, encodeRaw,
	eolOf, mtimeOf, parseFrom, preambleLen,
} from './engine.ts';

// ---- 出力 ----------------------------------------------------------------

/** 標準出力は UTF-8 で出す（Node ・ Bun はコードページを見ない） */
export function out(s: string): void {
	process.stdout.write(s + '\n');
}

/** 改行を付けずに出す */
export function outRaw(s: string): void {
	process.stdout.write(s);
}

export function err(s: string): void {
	process.stderr.write(s + '\n');
}

// ---- 引数 ----------------------------------------------------------------

/** 簡易な引数パーサ。--name value / --flag / 位置引数 */
export class Args {
	private readonly opts = new Map<string, string>();
	private readonly flags = new Set<string>();
	readonly positional: string[] = [];

	/** 値を取るオプション名の集合を渡して解釈する */
	static parse(a: string[], valueOpts: Set<string>): Args {
		const r = new Args();
		let i = 0;
		while (i < a.length) {
			const t = a[i];
			if (t.startsWith('-') && t.length > 1) {
				if (valueOpts.has(t)) {
					if (i + 1 >= a.length) { throw new ToolError(2, t + ' に値がありません。'); }
					r.opts.set(t, a[i + 1]);
					i += 2;
				} else {
					r.flags.add(t);
					i++;
				}
			} else {
				r.positional.push(t);
				i++;
			}
		}
		return r;
	}

	get(name: string): string | null {
		const v = this.opts.get(name);
		return v === undefined ? null : v;
	}

	has(name: string): boolean {
		return this.flags.has(name) || this.opts.has(name);
	}

	flag(a: string, b: string): boolean {
		return this.flags.has(a) || this.flags.has(b);
	}
}

// ---- ファイル ------------------------------------------------------------

export function readBytes(p: string): Uint8Array {
	if (!fs.existsSync(p)) { throw new ToolError(2, 'ファイルがありません: ' + show(p)); }
	return new Uint8Array(fs.readFileSync(p));
}

export function exists(p: string): boolean {
	return fs.existsSync(p);
}

/** 組を決める。--from があれば判定を上書き */
export function resolve(bytes: Uint8Array, from: string | null): Combo {
	if (from != null && from.length > 0) {
		const k = parseFrom(from);
		// --from で明示された組は、そのままの名前で出す（ascii へ寄せない）
		return { enc: k, eol: eolOf(bytes, k), ambiguous: false, ascii: false };
	}
	return detectCombo(bytes);
}

/** 文字インデックス → 元バイト列でのオフセット */
export function byteOffset(original: Uint8Array, decoded: string, charIndex: number, enc: EncKind): number {
	const pre = preambleLen(original, enc);
	if (charIndex <= 0) { return pre; }
	const prefix = encodeRaw(decoded.substring(0, charIndex), enc);
	return pre + prefix.length;
}

/** [csChar, ceChar) を newText に置き換えたバイト列を作る（元バイトを保つ） */
export function splice(original: Uint8Array, decoded: string, enc: EncKind,
	csChar: number, ceChar: number, newText: string): Uint8Array {
	const bStart = byteOffset(original, decoded, csChar, enc);
	const bEnd = byteOffset(original, decoded, ceChar, enc);
	const mid = encodeRaw(newText, enc);

	const tail = original.length - bEnd;
	const result = new Uint8Array(bStart + mid.length + tail);
	result.set(original.subarray(0, bStart), 0);
	result.set(mid, bStart);
	result.set(original.subarray(bEnd), bStart + mid.length);
	return result;
}

/**
 * 一時ファイルに書いてから置き換える。途中で中断してもファイルが壊れない。
 * 新規ファイル（置換先が無い）にも対応する。
 */
export function writeAtomic(p: string, bytes: Uint8Array): void {
	const full = path.resolve(p);
	const dir = path.dirname(full);
	const temp = path.join(dir, path.basename(full) + '.' + crypto.randomUUID().replace(/-/g, '') + '.tmp');
	fs.writeFileSync(temp, bytes);
	try {
		fs.renameSync(temp, p);
	} catch (e) {
		try { fs.unlinkSync(temp); } catch { /* 消せなくても元は無事 */ }
		throw e;
	}
}

/** 更新日時（ローカル）を yymmdd-hhmmss-ccc で */
export function mtime(p: string): string {
	return mtimeOf(fs.statSync(p).mtime);
}

export function sizeOf(p: string): number {
	return fs.statSync(p).size;
}

/** 表示用にユーザープロファイルを ~ に伏せる（実体は lib/paths.ts で共有） */
export function show(p: string): string {
	return maskHome(p);
}

export { computeDigest };
