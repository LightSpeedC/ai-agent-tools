/*
	text read — 何であろうと読み、UTF-8 で見せる。
	◆ ヘッダに組・サイズ・更新日時・合言葉。

	C# 版（src/TextCs/ReadCmd.cs）の移植。
*/

import { ToolError, comboName, decode, lineContent, splitLines } from './engine.ts';
import { Args, computeDigest, mtime, out, outRaw, readBytes, resolve, show } from './files.ts';

const ValueOpts = new Set(['--from', '--lines']);

export function run(a: string[]): number {
	const args = Args.parse(a, ValueOpts);
	if (args.positional.length < 1) { throw new ToolError(2, '読むファイルを指定してください。'); }
	const p = args.positional[0];

	const bytes = readBytes(p);
	const combo = resolve(bytes, args.get('--from'));
	const text = decode(bytes, combo.enc);
	const lines = splitLines(text);

	const spec = args.get('--lines');
	const hasLines = spec != null;
	let a1 = 1;
	let b1 = lines.length;
	if (hasLines) {
		const r = parseLines(spec, lines.length);
		a1 = r.a;
		b1 = r.b;
	}

	const cs = lines[a1 - 1].start;
	// 全文（--lines 無し）は末尾改行も含めた全体をハッシュする。edit 側の
	// 全文 digest（text 全体）と範囲を合わせるため（末尾改行の有無で不一致になるのを防ぐ）。
	const ce = hasLines ? lines[b1 - 1].contentEnd : text.length;
	const rangeText = text.substring(cs, ce);
	const digest = computeDigest(rangeText, bytes.length, mtime(p));

	let head = '◆"' + show(p) + '" [' + comboName(combo) + ']'
		+ ' size=' + bytes.length
		+ ' mtime=' + mtime(p);
	if (hasLines) { head += ' lines=' + a1 + '-' + b1; }
	head += ' digest=' + digest;

	if (args.flag('--no-number', '--no-number')) {
		// 中身だけを別処理へ渡す用途。◆ ヘッダは出さない。
		const from = lines[a1 - 1].start;
		const to = lines[b1 - 1].fullEnd;
		outRaw(text.substring(from, to));
		return 0;
	}

	out(head);

	for (let i = a1; i <= b1; i++) {
		const num = String(i).padStart(6, ' ');
		out(num + ':\t' + lineContent(text, lines[i - 1]));
	}
	return 0;
}

export function parseLines(spec: string, count: number): { a: number; b: number } {
	const dash = spec.indexOf('-');
	if (dash < 0) { throw new ToolError(2, '--lines は A-B の形で指定してください: ' + spec); }
	const a = Number(spec.substring(0, dash));
	const b = Number(spec.substring(dash + 1));
	if (!Number.isInteger(a) || !Number.isInteger(b)) {
		throw new ToolError(2, '--lines の数が読めません: ' + spec);
	}
	if (a < 1 || b < a || b > count) {
		throw new ToolError(2, '--lines の範囲が不正です: ' + spec + '（全 ' + count + ' 行）');
	}
	return { a: a, b: b };
}
