/*
	HTML ドキュメントから Markdown を生成する（プロジェクト共通）。

	C# 版（src/Html2MdCs/Program.cs）の移植。

	HTML を正とし、Markdown はこのツールの生成物として扱う。
	内容を更新するときは HTML を直してこのツールを再実行する。
	生成された .md を直接編集しても次回実行で上書きされる。
*/

import * as fs from 'node:fs';
import * as path from 'node:path';
import { Converter, buildAnchorsFromHtml, isMdSkipPage } from './converter.ts';
import type { ConvertResult } from './context.ts';
import { testExtraText, testHtmlLinks, testMdLinks, testUpdatedDate } from './checks.ts';
import { maskHome } from '../lib/paths.ts';

const Usage =
	'HTML → Markdown 変換\n'
	+ '\n'
	+ '  html2md [オプション]\n'
	+ '\n'
	+ '    --root <パス>     対象のプロジェクトフォルダ（既定: カレントフォルダ）\n'
	+ '    --dir <名前>      探索するフォルダ。複数回指定できる（既定: notes）\n'
	+ '    --exclude <名前>  変換しないファイル名。複数回指定できる（既定: index.html）\n'
	+ '    --extra <名前>    ルート直下の追加ファイル。複数回指定できる\n'
	+ '    --no-readme       ルート直下の README.html を対象から外す\n'
	+ '    --dry-run         書き出さず、変換結果と検査結果だけを表示する\n'
	+ '    --help            この説明を表示する\n'
	+ '\n'
	+ '  HTML 側で除外する場合は head に <meta name="md-skip"> を置く\n'
	+ '\n'
	+ '  終了コード  0=指摘なし  1=指摘あり  2=引数や対象の誤り\n';

function out(s: string): void {
	process.stdout.write(s + '\n');
}

function fail(message: string): number {
	process.stderr.write(message + '\n\n' + Usage + '\n');
	return 2;
}

function readText(p: string): string {
	let s = new TextDecoder('utf-8').decode(fs.readFileSync(p));
	if (s.charCodeAt(0) === 0xfeff) { s = s.substring(1); }
	return s;
}

function main(argv: string[]): number {
	let root: string | null = null;
	const dirs: string[] = [];
	const excludes: string[] = [];
	const extras: string[] = [];
	let noReadme = false;
	let dryRun = false;

	for (let i = 0; i < argv.length; i++) {
		const a = argv[i];
		switch (a) {
			case '--root':
				if (i + 1 >= argv.length) { return fail('--root にフォルダを指定してください。'); }
				root = argv[++i];
				break;
			case '--dir':
				if (i + 1 >= argv.length) { return fail('--dir にフォルダ名を指定してください。'); }
				dirs.push(argv[++i]);
				break;
			case '--exclude':
				if (i + 1 >= argv.length) { return fail('--exclude にファイル名を指定してください。'); }
				excludes.push(argv[++i]);
				break;
			case '--extra':
				if (i + 1 >= argv.length) { return fail('--extra にファイル名を指定してください。'); }
				extras.push(argv[++i]);
				break;
			case '--no-readme':
				noReadme = true;
				break;
			case '--dry-run':
				dryRun = true;
				break;
			case '--help':
			case '-h':
			case '/?':
				out(Usage);
				return 0;
			default:
				return fail('知らないオプションです: ' + a);
		}
	}

	if (root == null || root.length === 0) { root = process.cwd(); }
	if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) {
		return fail('フォルダが見つかりません: ' + root);
	}
	root = path.resolve(root);
	if (dirs.length === 0) { dirs.push('notes'); }
	// index.html は README.html へのリダイレクト専用なので既定で外す
	if (excludes.length === 0) { excludes.push('index.html'); }

	out('');
	out('=== HTML → Markdown 変換 ===');
	if (dryRun) { out('（--dry-run: ファイルは書き出しません）'); }
	out('対象ルート: ' + maskHome(root));
	out('探索フォルダ: ' + dirs.join(', ') + (noReadme ? '' : ' と README.html'));

	const targets = collectTargets(root, dirs, excludes, noReadme, extras);
	if (targets.length === 0) {
		out('');
		out('変換対象の HTML が見つかりませんでした。');
		return 2;
	}

	const converter = new Converter();
	const results: ConvertResult[] = [];

	// head に <meta name="md-skip"> があるページは Markdown にしない。
	//
	// 変換より先に、この実行で .md ができるページを確定させる。
	// リンクの置き換えがこの一覧を見て、載っていないものは .html のまま残す。
	const mdSkipPages = new Set<string>();
	const convertedPages = new Set<string>();
	// 他ファイルへのアンカー付きリンクを、リンク先の見出しアンカーへ張り替えるための
	// 事前パス。変換対象すべての見出しアンカーマップを先に作っておく
	const crossAnchors = new Map<string, Map<string, string>>();
	for (const t of targets) {
		const full = path.resolve(t);
		const text = readText(t);
		if (isMdSkipPage(text)) {
			mdSkipPages.add(full.toLowerCase());
		} else {
			convertedPages.add(full.toLowerCase());
			crossAnchors.set(full.toLowerCase(), buildAnchorsFromHtml(text));
		}
	}
	converter.convertedPages = convertedPages;
	converter.crossFileAnchors = crossAnchors;

	out('');
	for (const t of targets) {
		if (mdSkipPages.has(path.resolve(t).toLowerCase())) {
			out('[' + rel(root, t) + ']');
			out('    -- md-skip の指定により変換しません');
			continue;
		}

		let res: ConvertResult;
		try {
			res = converter.convertFile(t, !dryRun);
		} catch (ex) {
			out('[' + rel(root, t) + ']');
			out('    ★変換に失敗しました: ' + (ex as Error).message);
			return 2;
		}
		const lines = res.markdown.split('\n').length;
		const size = new TextEncoder().encode(res.markdown).length;
		out('[' + rel(root, t) + ']');
		out('    -> ' + rel(root, res.mdPath) + '  (' + lines + ' 行 / '
			+ (size / 1024.0).toFixed(1) + ' KB)');
		if (res.images.length > 0) {
			out('    画像: ' + res.images.map(i => 'images/' + i).join(', '));
		}
		results.push(res);
	}

	// この実行で生成するファイル。--dry-run では書き出さないので、
	// これを実在扱いにしないと相互リンクと画像が全部リンク切れになる
	const expected = new Set<string>();
	// 他ファイルへのアンカー付きリンクの検査用。--dry-run でも読めるよう、
	// 書き出す前の Markdown をメモリ上に持っておく
	const markdownByPath = new Map<string, string>();
	for (const r of results) {
		const full = path.resolve(r.mdPath);
		expected.add(full.toLowerCase());
		markdownByPath.set(full.toLowerCase(), r.markdown);
		const imgDir = path.join(path.dirname(r.mdPath), 'images');
		for (const img of r.images) {
			expected.add(path.resolve(path.join(imgDir, img)).toLowerCase());
		}
	}

	out('');
	out('=== 検査 ===');
	let problems = 0;
	let warnings = 0;

	for (const r of results) {
		out('[' + rel(root, r.htmlPath) + ']');

		const htmlBad = testHtmlLinks(r.htmlPath);
		if (htmlBad.length > 0) {
			problems += htmlBad.length;
			for (const b of htmlBad) { out('    ★HTML 側: ' + b); }
		} else {
			out('    HTML 側のリンク: すべて .html で参照先も実在');
		}

		const mdBad = testMdLinks(r, expected, markdownByPath);
		if (mdBad.length > 0) {
			problems += mdBad.length;
			for (const b of mdBad) { out('    ★Markdown 側: ' + b); }
		} else {
			out('    Markdown 側のリンク: リンク切れ・アンカー切れなし');
		}

		const extra = testExtraText(r);
		if (extra.length > 0) {
			problems += extra.length;
			out('    ★HTML に無い文言 ' + extra.length + ' 件:');
			for (const e of extra) { out('        ' + e); }
		} else {
			out('    HTML に無い文言なし');
		}

		const dateNg = testUpdatedDate(r.htmlPath);
		if (dateNg.length > 0) {
			warnings++;
			out('    ▲' + dateNg);
		}
	}

	out('');
	if (problems > 0) {
		out('=== 変換完了。' + problems + ' 件の指摘あり ===');
		if (warnings > 0) { out('（ほかに警告 ' + warnings + ' 件）'); }
		return 1;
	}
	if (warnings > 0) {
		out('=== 変換完了。警告 ' + warnings + ' 件（指摘なし） ===');
	} else {
		out('=== 変換完了。指摘なし ===');
	}
	out('');
	out('生成した Markdown が GitHub で意図どおりに表示されるかは check-markdown で確かめる。');
	return 0;
}

/**
 * 変換対象を集める。ルート直下の README.html と --extra で挙げたファイル、
 * および指定フォルダ配下の *.html。
 *
 * ルート直下を名指しにしているのは、作業用に置いた HTML まで拾わないため。
 */
function collectTargets(root: string, dirs: string[], excludes: string[],
	noReadme: boolean, extras: string[]): string[] {
	const targets: string[] = [];
	if (!noReadme) {
		const readme = path.join(root, 'README.html');
		if (fs.existsSync(readme)) { targets.push(readme); }
	}
	for (const name of extras) {
		const extra = path.join(root, name);
		if (fs.existsSync(extra) && !targets.includes(extra)) { targets.push(extra); }
	}
	for (const d of dirs) {
		const full = path.join(root, d);
		if (!fs.existsSync(full) || !fs.statSync(full).isDirectory()) { continue; }
		const found: string[] = [];
		collectHtml(full, found);
		found.sort((a, b) => {
			const x = a.toLowerCase();
			const y = b.toLowerCase();
			return x < y ? -1 : x > y ? 1 : 0;
		});
		for (const f of found) {
			if (isExcluded(f, excludes)) { continue; }
			if (!targets.includes(f)) { targets.push(f); }
		}
	}
	return targets;
}

function collectHtml(dir: string, found: string[]): void {
	let entries: fs.Dirent[];
	try {
		entries = fs.readdirSync(dir, { withFileTypes: true });
	} catch {
		return;
	}
	for (const ent of entries) {
		const p = path.join(dir, ent.name);
		if (ent.isDirectory()) { collectHtml(p, found); }
		else if (ent.isFile() && ent.name.toLowerCase().endsWith('.html')) { found.push(p); }
	}
}

function isExcluded(p: string, excludes: string[]): boolean {
	const name = path.basename(p).toLowerCase();
	for (const e of excludes) {
		if (name === e.toLowerCase()) { return true; }
	}
	return false;
}

function rel(root: string, p: string): string {
	if (p.toLowerCase().startsWith(root.toLowerCase())) {
		return p.substring(root.length).replace(/^[\\/]+/, '');
	}
	return p;
}

process.exit(main(process.argv.slice(2)));
