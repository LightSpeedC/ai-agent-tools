/*
	text write — 指定した組（--to）または既存の組（--keep）で全文を書く。
*/

import * as fs from 'node:fs';
import type { EncKind, EolKind } from './engine.ts';
import {
	ToolError, decode, detectCombo, encodeFull, findUnmappable, parseTo,
} from './engine.ts';
import { Args, exists, out, readBytes, resolve, show, writeAtomic } from './files.ts';
import { sameBytes } from '../lib/codec.ts';

const ValueOpts = new Set(['--to', '--in', '--from']);

export function run(a: string[]): number {
	const args = Args.parse(a, ValueOpts);
	if (args.positional.length < 1) { throw new ToolError(2, '書くファイルを指定してください。'); }
	const p = args.positional[0];

	let enc: EncKind;
	let eol: EolKind;
	const to = args.get('--to');
	const keep = args.flag('--keep', '--keep');

	if (to != null) {
		const v = parseTo(to);
		enc = v.enc;
		eol = v.eol;
	} else if (keep) {
		if (!exists(p)) { throw new ToolError(2, '--keep は既存ファイルが必要です: ' + show(p)); }
		const cur = readBytes(p);
		const c = resolve(cur, args.get('--from'));
		if (c.ambiguous) {
			throw new ToolError(3, '既存ファイルの組を決められません。--from で明示してください: ' + show(p));
		}
		enc = c.enc;
		eol = c.eol;
	} else {
		throw new ToolError(2, '--to <用途> か --keep を指定してください。');
	}

	let content = readContent(args);
	const eolStr = eolToString(eol);
	if (eolStr != null) {
		content = content.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
		if (eolStr !== '\n') { content = content.replace(/\n/g, eolStr); }
	}

	const bad = findUnmappable(content, enc);
	if (bad != null) {
		throw new ToolError(5, enc + ' で表現できない文字です: \'' + bad.ch + '\' (U+'
			+ bad.codePoint.toString(16).toUpperCase().padStart(4, '0')
			+ ')。書き込む中身を見直してください。');
	}

	const result = encodeFull(content, enc);

	if (exists(p)) {
		const old = new Uint8Array(fs.readFileSync(p));
		if (sameBytes(old, result)) {
			out('変更なし: ' + show(p));
			return 0;
		}
	}

	writeAtomic(p, result);
	out('書きました: ' + show(p) + ' [' + enc + '/' + eol + ']');
	return 0;
}

function readContent(args: Args): string {
	const inFile = args.get('--in');
	if (inFile != null) {
		const b = readBytes(inFile);
		const c = detectCombo(b);
		if (c.ambiguous) {
			throw new ToolError(3, 'UTF-8 と SJIS の両方で妥当で組を決められません（--in）: ' + show(inFile));
		}
		return decode(b, c.enc);
	}

	// 第 2 引数は標準入力より優先する。エージェントのシェルは stdin が
	// 常にリダイレクト状態のため、引数を先に見ないと空の stdin で上書きしてしまう。
	if (args.positional.length >= 2) { return args.positional[1]; }

	if (!process.stdin.isTTY) {
		let all: Uint8Array;
		try {
			all = new Uint8Array(fs.readFileSync(0));
		} catch {
			all = new Uint8Array(0);
		}
		// 空の標準入力で 0 バイト上書きしない。中身があるときだけ採用する。
		if (all.length > 0) {
			const c = detectCombo(all);
			if (c.ambiguous) {
				throw new ToolError(3, 'UTF-8 と SJIS の両方で妥当で組を決められません（標準入力）。');
			}
			return decode(all, c.enc);
		}
	}

	throw new ToolError(2, '書き込む中身を --in <path>、第 2 引数、または（空でない）標準入力で渡してください。');
}

function eolToString(k: EolKind): string | null {
	switch (k) {
		case 'crlf': return '\r\n';
		case 'lf': return '\n';
		case 'cr': return '\r';
		default: return null;
	}
}
