/*
	text replace — 複数のファイルにまたがる一括置換 (課題 i261110-04)。
	ファイルの選び方は text find と同じ。文字コード ・ BOM ・ 改行は、ファイルごとに元のまま書き戻す。

	- 検索語は素の文字列。--regex なら正規表現で、置き換える側の $1 ・ $& ・ $<名前> ・ $$ を使える (228-B)
	- 一致が 0 件なら終了コード 1 (229-A)
	- --expect <件数> と合計が違えば、どのファイルも書き換えずに終了コード 6 (230-A)。--expect 0 で 0 件なら終了コード 0
	- 置き換えたあとの文字が、そのファイルの文字コードで表せなければ、どのファイルも書き換えずに終了コード 5
	- 全部のファイルを先に組み立ててから書く。書くのは 1 ファイルずつ、一時ファイルを経て置き換える
	- --rename なら、ファイルの名前 (フォルダ名は含めない) も同じ検索語で置き換え、合計と --expect に数える (239-A)。
	  新しい名前が既にある ・ 2 つが同じ名前になる ・ 名前に使えない文字が入る、なら何も書き換えずに終了コード 7。
	  中身を書き終えてから名前を変える。git の管理下のファイルは git mv
*/

import * as fs from 'node:fs';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';
import { ToolError, comboName, decode, encodeRaw, findUnmappable, lineContent, looksBinary, preambleLen, splitLines } from './engine.ts';
import { Args, out, resolve, show, writeAtomic } from './files.ts';
import { makePattern, relPath, selectTargets } from './find.ts';

const ValueOpts = new Set(['--path', '--include', '--exclude', '--exclude-dir', '--from', '--expect']);

interface Planned {
	file: string;
	rel: string;
	combo: string;
	count: number;
	bytes: Uint8Array;
	changed: { lineNo: number; before: string; after: string }[];
}

/** --regex の置き換える側を展開する ($$ ・ $& ・ $1〜$99 ・ $<名前>) */
function expand(template: string, m: RegExpExecArray): string {
	return template.replace(/\$(\$|&|(\d{1,2})|<([^>]*)>)/g, (all, kind: string, num?: string, name?: string) => {
		if (kind === '$') { return '$'; }
		if (kind === '&') { return m[0]; }
		if (num !== undefined) {
			const n = Number(num);
			return n >= 1 && n < m.length ? (m[n] ?? '') : all;
		}
		if (name !== undefined && m.groups !== undefined && name in m.groups) { return m.groups[name] ?? ''; }
		return all;
	});
}

export function run(a: string[]): number {
	const args = Args.parse(a, ValueOpts);
	if (args.positional.length < 2) { throw new ToolError(2, '検索語と、置き換える文字列を指定してください。'); }
	const keyword = args.positional[0];
	const replacement = args.positional[1];
	if (keyword.length === 0) { throw new ToolError(2, '検索語が空です。'); }
	const regex = args.flag('--regex', '--regex');
	const ignoreCase = args.flag('-i', '--ignore-case');
	const dryRun = args.flag('--dry-run', '--dry-run');
	const rename = args.flag('--rename', '--rename');
	const from = args.get('--from');
	const expectText = args.get('--expect');
	let expect: number | null = null;
	if (expectText != null) {
		if (!/^\d+$/.test(expectText)) { throw new ToolError(2, '--expect には件数 (0 以上の整数) を渡してください: ' + expectText); }
		expect = Number(expectText);
	}
	const pattern = makePattern(keyword, regex, ignoreCase);
	const { basePath, baseFull, baseIsFile, targets } = selectTargets(args, 2);

	// ---- 1. 全部のファイルを組み立てる (まだ書かない) ----
	const plans: Planned[] = [];
	for (const file of targets) {
		let bytes: Uint8Array;
		try { bytes = new Uint8Array(fs.readFileSync(file)); } catch { continue; }
		const combo = resolve(bytes, from);
		if (looksBinary(bytes, combo.enc)) { continue; }
		const text = decode(bytes, combo.enc);

		const pieces: Uint8Array[] = [];
		let charPos = 0;
		let bytePos = preambleLen(bytes, combo.enc);
		pieces.push(bytes.subarray(0, bytePos));
		let count = 0;
		let newText = '';
		pattern.lastIndex = 0;
		let m: RegExpExecArray | null;
		while ((m = pattern.exec(text)) !== null) {
			if (m[0].length === 0) { pattern.lastIndex++; continue; }
			const rep = regex ? expand(replacement, m) : replacement;
			const bad = findUnmappable(rep, combo.enc);
			if (bad != null) {
				throw new ToolError(5, show(file) + ': ' + combo.enc + ' で表現できない文字です: \'' + bad.ch + '\' (U+'
					+ bad.codePoint.toString(16).toUpperCase().padStart(4, '0') + ')。どのファイルも書き換えていません。');
			}
			// 一致より前は、元のバイト列をそのまま使う (読み直して変わらないように)
			const keepLen = encodeRaw(text.substring(charPos, m.index), combo.enc).length;
			const matchLen = encodeRaw(m[0], combo.enc).length;
			pieces.push(bytes.subarray(bytePos, bytePos + keepLen));
			pieces.push(encodeRaw(rep, combo.enc));
			newText += text.substring(charPos, m.index) + rep;
			bytePos += keepLen + matchLen;
			charPos = m.index + m[0].length;
			count++;
		}
		if (count === 0) { continue; }
		pieces.push(bytes.subarray(bytePos));
		newText += text.substring(charPos);

		const total = pieces.reduce((s, p) => s + p.length, 0);
		const result = new Uint8Array(total);
		let off = 0;
		for (const p of pieces) { result.set(p, off); off += p.length; }

		// 変わった行 (--dry-run で見せる)。行の数が変わらなければ同じ行どうしで、変われば変わった行だけを出す
		const changed: Planned['changed'] = [];
		if (dryRun) {
			const before = splitLines(text).map((l) => lineContent(text, l));
			const after = splitLines(newText).map((l) => lineContent(newText, l));
			if (before.length === after.length) {
				for (let i = 0; i < before.length; i++) {
					if (before[i] !== after[i]) { changed.push({ lineNo: i + 1, before: before[i], after: after[i] }); }
				}
			} else {
				changed.push({ lineNo: 0, before: '(行の数が変わる: ' + before.length + ' → ' + after.length + ')', after: '' });
			}
		}
		const rel = baseIsFile ? path.basename(file) : relPath(baseFull, file);
		plans.push({ file, rel, combo: comboName(combo), count, bytes: result, changed });
	}

	// ---- 1b. --rename: 名前の置き換えを組み立てる (239-A) ----
	const renames = rename ? planRenames(targets, pattern, regex, replacement, baseFull, baseIsFile) : [];
	const renameCount = renames.reduce((s, r) => s + r.count, 0);

	const total = plans.reduce((s, p) => s + p.count, 0) + renameCount;
	const head = '◎"' + show(basePath) + '"  検索="' + keyword + '"  置換="' + replacement + '"'
		+ (regex ? '  正規表現' : '') + (ignoreCase ? '' : '  大小区別') + (rename ? '  名前も' : '') + (dryRun ? '  dry-run (書き換えない)' : '');
	out(head);

	if (total === 0) {
		out('合計 0 件 (一致なし)');
		// --expect 0 は「無いこと」を確かめる指定なので、0 件なら成功 (file-manager #1911 の 1)
		return expect === 0 ? 0 : 1;
	}
	if (expect != null && expect !== total) {
		for (const p of plans) { out('◆"' + p.rel + '" [' + p.combo + '] ' + p.count + ' 件'); }
		throw new ToolError(6, '--expect ' + expect + ' 件と、実際の ' + total + ' 件が違います。どのファイルも書き換えていません。');
	}

	// ---- 2. 書く (--dry-run は書かない) ----
	for (const p of plans) {
		if (!dryRun) { writeAtomic(p.file, p.bytes); }
		out('◆"' + p.rel + '" [' + p.combo + '] ' + p.count + ' 件');
		for (const c of p.changed) {
			if (c.lineNo === 0) { out('    ' + c.before); continue; }
			out(String(c.lineNo).padStart(6, ' ') + ' - ' + c.before);
			out(String(c.lineNo).padStart(6, ' ') + ' + ' + c.after);
		}
	}
	// 中身を書き終えてから名前を変える
	for (const r of renames) {
		if (!dryRun) { moveFile(r.from, r.to); }
		out('→ "' + r.relFrom + '" → "' + r.relTo + '" ' + r.count + ' 件');
	}
	const files = new Set([...plans.map((p) => p.file), ...renames.map((r) => r.from)]).size;
	out('合計 ' + total + ' 件 (' + files + ' ファイル' + (renames.length > 0 ? '、うち名前 ' + renames.length : '') + ')' + (dryRun ? '。dry-run なので書き換えていない' : ''));
	return 0;
}

interface Rename { from: string; to: string; relFrom: string; relTo: string; count: number }

/** 名前の置き換えを組み立て、ぶつかり ・ 使えない文字を調べる。だめなら終了コード 7 (何も書いていない段階) */
function planRenames(targets: string[], pattern: RegExp, regex: boolean, replacement: string, baseFull: string, baseIsFile: boolean): Rename[] {
	const list: Rename[] = [];
	for (const file of targets) {
		const name = path.basename(file);
		let count = 0;
		pattern.lastIndex = 0;
		const newName = name.replace(pattern, (...a: unknown[]) => {
			count++;
			if (!regex) { return replacement; }
			// replace の引数から RegExpExecArray 相当を組み立てる
			const groups = typeof a[a.length - 1] === 'object' ? a[a.length - 1] as Record<string, string> : undefined;
			const nCap = a.length - (groups !== undefined ? 3 : 2);
			const m = a.slice(0, nCap) as string[] as unknown as RegExpExecArray;
			(m as unknown as { groups?: Record<string, string> }).groups = groups;
			return expand(replacement, m);
		});
		if (count === 0 || newName === name) { continue; }
		const to = path.join(path.dirname(file), newName);
		const rel = (p: string) => baseIsFile ? path.basename(p) : relPath(baseFull, p);
		list.push({ from: file, to, relFrom: rel(file), relTo: rel(to), count });
	}
	const seen = new Map<string, string>();
	const fromSet = new Set(list.map((r) => r.from.toLowerCase()));
	for (const r of list) {
		const newName = path.basename(r.to);
		if (newName === '' || newName === '.' || newName === '..' || /[\\/:*?"<>|\x00-\x1f]/.test(newName)) {
			throw new ToolError(7, '名前に使えない文字が入ります: "' + r.relFrom + '" → "' + newName + '"。どのファイルも書き換えていません。');
		}
		const key = r.to.toLowerCase();
		const prev = seen.get(key);
		if (prev !== undefined) {
			throw new ToolError(7, '2 つのファイルが同じ名前になります: "' + prev + '" と "' + r.relFrom + '" → "' + r.relTo + '"。どのファイルも書き換えていません。');
		}
		seen.set(key, r.relFrom);
		// 大小だけを変えるときは、自分自身なのでぶつからない。名前を変える別のファイルの元の名前もぶつからない
		if (key !== r.from.toLowerCase() && fs.existsSync(r.to) && !fromSet.has(key)) {
			throw new ToolError(7, '新しい名前のファイルが既にあります: "' + r.relTo + '"。どのファイルも書き換えていません。');
		}
	}
	return list;
}

/** git の管理下なら git mv、そうでなければ fs.renameSync */
function moveFile(from: string, to: string): void {
	const dir = path.dirname(from);
	const git = (args: string[]) => spawnSync('git', ['-C', dir, ...args], { encoding: 'utf8', windowsHide: true });
	try {
		if (git(['ls-files', '--error-unmatch', '--', path.basename(from)]).status === 0) {
			const mv = git(['mv', '--', path.basename(from), path.basename(to)]);
			if (mv.status === 0) { return; }
			throw new ToolError(2, 'git mv できません: ' + show(from) + ' → ' + path.basename(to) + ': ' + (mv.stderr ?? '').trim());
		}
	} catch (e) {
		if (e instanceof ToolError) { throw e; }
	}
	fs.renameSync(from, to);
}
