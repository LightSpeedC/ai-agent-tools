/*
	text edit — 判定 → 部分置換 → 元の組のまま書き戻す。合言葉で競合を検知。

	C# 版（src/TextCs/EditCmd.cs）の移植。
*/

import type { EolKind } from './engine.ts';
import {
	ToolError, comboName, decode, detectCombo, findUnmappable, splitLines,
} from './engine.ts';
import {
	Args, computeDigest, mtime, out, readBytes, resolve, show, splice, writeAtomic,
} from './files.ts';
import { parseLines } from './read.ts';
import { sameBytes } from '../lib/codec.ts';
import { findUndecodable } from '../lib/detector.ts';

const ValueOpts = new Set([
	'--from', '--lines', '--digest', '--old', '--old-file', '--new', '--new-file',
]);

export function run(a: string[]): number {
	const args = Args.parse(a, ValueOpts);
	if (args.positional.length < 1) { throw new ToolError(2, '編集するファイルを指定してください。'); }
	const p = args.positional[0];

	const bytes = readBytes(p);
	const combo = resolve(bytes, args.get('--from'));
	if (combo.ambiguous) {
		throw new ToolError(3,
			'UTF-8 と SJIS の両方で妥当で組を決められません。--from で明示してください: ' + show(p));
	}
	// 読めないバイトがあると、置換位置の計算（デコード後の文字位置を再エンコード
	// してバイト位置に戻す）が実際のバイト位置とずれる。読めない箇所より後ろを
	// 編集すると、対象と違う位置を切ってしまう（i260908-04）
	const badAt = findUndecodable(bytes, combo.enc);
	if (badAt >= 0) {
		throw new ToolError(2, combo.enc + ' として読めないバイトがあります（'
			+ badAt + ' バイト目）。書き換え位置がずれるおそれがあるため止めます。'
			+ ' --from で組を明示するか、convert-encoding で先に直してください。');
	}

	const text = decode(bytes, combo.enc);
	const lines = splitLines(text);
	const eol = eolToString(combo.eol);

	// 置き換える中身
	let newText = readContent(args.get('--new'), args.get('--new-file'), '--new');
	if (newText == null) { throw new ToolError(2, '--new か --new-file で置き換える中身を指定してください。'); }
	newText = normalize(newText, eol);

	// スコープ（--lines）
	const spec = args.get('--lines');
	const hasLines = spec != null;
	let a1 = 1;
	let b1 = lines.length;
	if (hasLines) {
		const r = parseLines(spec, lines.length);
		a1 = r.a;
		b1 = r.b;
	}
	const scopeStart = lines[a1 - 1].start;
	const scopeEnd = lines[b1 - 1].contentEnd;

	// 合言葉の照合（スコープ範囲、--lines 無しは全体）
	const digestArg = args.get('--digest');
	if (digestArg != null) {
		const ds = hasLines ? scopeStart : 0;
		const de = hasLines ? scopeEnd : text.length;
		const got = computeDigest(text.substring(ds, de), bytes.length, mtime(p));
		if (got.toLowerCase() !== digestArg.toLowerCase()) {
			throw new ToolError(4,
				'合言葉が一致しません（別の人が更新した可能性）。渡された ' + digestArg
				+ ' / いまの ' + got + '。read し直してください。');
		}
	}

	// 置換対象の特定
	let cs: number;
	let ce: number;
	let oldText = readContent(args.get('--old'), args.get('--old-file'), '--old');
	if (oldText != null) {
		oldText = normalize(oldText, eol);
		const scope = text.substring(scopeStart, scopeEnd);
		const idx = scope.indexOf(oldText);
		if (idx < 0) { throw new ToolError(2, '--old に一致する箇所がありません。'); }
		if (scope.indexOf(oldText, idx + 1) >= 0) {
			throw new ToolError(2, '--old が複数箇所に一致します。--lines で範囲を絞ってください。');
		}
		cs = scopeStart + idx;
		ce = cs + oldText.length;
	} else if (hasLines) {
		cs = scopeStart;
		ce = scopeEnd;   // 行範囲まるごと
	} else {
		throw new ToolError(2, '--lines か --old で置換対象を指定してください。');
	}

	const bad = findUnmappable(newText, combo.enc);
	if (bad != null) {
		throw new ToolError(5, combo.enc + ' で表現できない文字です: \'' + bad.ch + '\' (U+'
			+ bad.codePoint.toString(16).toUpperCase().padStart(4, '0')
			+ ')。置換内容を見直してください。');
	}

	const result = splice(bytes, text, combo.enc, cs, ce, newText);

	if (sameBytes(result, bytes)) {
		out('変更なし: ' + show(p));
		return 0;
	}

	writeAtomic(p, result);
	out('置換しました: ' + show(p) + ' [' + comboName(combo) + ']');
	return 0;
}

function readContent(inline: string | null, file: string | null, label: string): string | null {
	if (inline != null && file != null) {
		throw new ToolError(2, label + ' と ' + label + '-file は同時に指定できません。');
	}
	if (inline != null) { return inline; }
	if (file != null) {
		const b = readBytes(file);
		const c = detectCombo(b);
		if (c.ambiguous) {
			throw new ToolError(3,
				'UTF-8 と SJIS の両方で妥当で組を決められません（' + label + '-file）: ' + show(file));
		}
		return decode(b, c.enc);
	}
	return null;
}

function eolToString(k: EolKind): string | null {
	switch (k) {
		case 'crlf': return '\r\n';
		case 'lf': return '\n';
		case 'cr': return '\r';
		default: return null;
	}
}

function normalize(s: string, eol: string | null): string {
	if (eol == null) { return s; }
	const lf = s.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
	if (eol === '\n') { return lf; }
	return lf.replace(/\n/g, eol);
}
