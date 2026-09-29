/*
	このリポジトリの HTML が、共通ルール「HTMLデザインルール」などの機械で確かめられる項目に
	沿っているかを見る。git の対象の HTML（まだ追跡していない新しいものを含む）のうち、tests/ を除くものが対象。

	    node tools/40_test/check-html-rules.ts

	見る項目:
	  ・BOM
	  ・本文（.wrap）の先頭とフッターに、ホーム（README。README は親サイト ../）へ戻るリンクがあり、
	    ⌂ のアイコンだけの紺のバッジ（navy1 → navy2 ・ 角丸 6px）になっているか。フッターに日付が無いか
	  ・目次のバッジ（角丸 6px ・ 幅 310px ＋ max-width 100%）、章の見出し（角丸 8px）、h3 の定義
	  ・タイトルバーの「📅 作成: … / 更新: …」
	  ・表を tablewrap で包んでいるか（数だけ比べる）、var() のフォールバック
	  ・README からリンクされているか（issues-archive は README からリンクしない）、issues と
	    issues-archive の相互リンク、issues ・ status のタイトルにプロジェクト名があるか

	終了コードは 0（外れなし）・ 1（外れあり）。
*/
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';

// tools/40_test/ に置くため、2 階層上がプロジェクトルート
const root = path.resolve(import.meta.dirname, '..', '..');
// 追跡していない新しいファイルも見る（.gitignore で外したものは除く）
const files = execSync('git -c core.quotepath=false ls-files --cached --others --exclude-standard -- "*.html"', { cwd: root, encoding: 'utf8' })
	.split('\n').filter((f) => f && !f.startsWith('tests/'));

const readme = fs.readFileSync(path.join(root, 'README.html'), 'utf8');
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
let bad = 0;

for (const f of files) {
	const raw = fs.readFileSync(path.join(root, f));
	const s = raw.toString('utf8');
	const ng: string[] = [];
	if (!(raw[0] === 0xef && raw[1] === 0xbb && raw[2] === 0xbf)) { ng.push('BOM が無い'); }
	const isReadme = f === 'README.html';
	const homeHref = isReadme ? '../' : path.posix.relative(path.posix.dirname(f), 'README.html');
	const homeRe = new RegExp('<a\\b[^>]*href="' + escapeRe(homeHref) + '"[^>]*>([\\s\\S]*?)</a>');
	const iconOnly = (a: string) => /<svg\b/.test(a) && a.replace(/<svg[\s\S]*?<\/svg>/g, '').trim() === '';

	// 本文（.wrap）の先頭のリンク
	const wrapAt = s.indexOf('<div class="wrap">');
	const firstEl = wrapAt < 0 ? '' : (s.slice(wrapAt + 18, wrapAt + 18 + 1200).trim().split('\n')[0] ?? '');
	if (wrapAt < 0) { ng.push('.wrap が無い'); }
	else {
		const a = homeRe.exec(firstEl);
		if (a == null) { ng.push('.wrap の先頭に ' + homeHref + ' へのリンクが無い'); }
		else if (!iconOnly(a[1])) { ng.push('先頭の戻るリンクがアイコン（⌂ の SVG）だけになっていない'); }
	}

	// フッター
	const foot = /<footer>([\s\S]*?)<\/footer>/.exec(s)?.[1] ?? '';
	if (foot === '') { ng.push('footer が無い'); }
	else {
		const a = homeRe.exec(foot);
		if (a == null) { ng.push('footer に ' + homeHref + ' へのリンクが無い'); }
		else if (!iconOnly(a[1])) { ng.push('footer の戻るリンクがアイコン（⌂ の SVG）だけになっていない'); }
		if (/\d{4}-\d{2}-\d{2}/.test(foot)) { ng.push('footer に日付がある'); }
	}

	const css = /<style>([\s\S]*?)<\/style>/.exec(s)?.[1] ?? '';
	const back = /a\.home[^{]*\{([^}]*)\}/.exec(css)?.[1] ?? '';
	if (!/navy1[\s\S]*navy2/.test(back) || !/border-radius:\s*6px/.test(back)) { ng.push('戻るリンクが紺のバッジ（navy1→navy2 ・ border-radius 6px）になっていない'); }

	const tocA = /\.toc ol a\{([^}]*)\}/.exec(css)?.[1] ?? '';
	if (s.includes('<div class="toc">')) {
		if (!/border-radius:\s*6px/.test(tocA)) { ng.push('目次のバッジが border-radius 6px でない'); }
		if (!/width:\s*310px/.test(tocA) || !/max-width:\s*100%/.test(tocA)) { ng.push('目次のバッジが width 310px ＋ max-width 100% でない'); }
	}
	const secH1 = /section h1\{([^}]*)\}/.exec(css)?.[1] ?? '';
	if (s.includes('<section class="ch') && !/border-radius:\s*8px/.test(secH1)) { ng.push('section h1 が border-radius 8px でない'); }
	if (/<h3\b/.test(s.replace(/<style>[\s\S]*?<\/style>/, '')) && !/(^|\n)\s*(section )?h3\{/.test(css)) { ng.push('h3 を使っているのに h3 の定義が無い'); }
	if (!/📅 作成: \d{4}-\d{2}-\d{2} \/ 更新: \d{4}-\d{2}-\d{2}/.test(s)) { ng.push('タイトルバーに「📅 作成: … / 更新: …」が無い'); }
	const tables = (s.match(/<table\b/g) ?? []).length;
	const wraps = (s.match(/class="tablewrap"/g) ?? []).length;
	if (tables > wraps) { ng.push('tablewrap で包んでいない表がある（表 ' + tables + ' ／ 包み ' + wraps + '）'); }
	const noFallback = [...css.matchAll(/var\(--[\w-]+\)/g)].map((m) => m[0]);
	if (noFallback.length > 0) { ng.push('フォールバックの無い var(): ' + [...new Set(noFallback)].slice(0, 4).join(' ')); }

	const isArchive = f.endsWith('issues-archive.html');
	if (!isReadme && !isArchive && !readme.includes('href="' + f + '"')) { ng.push('README からリンクされていない'); }
	if (isArchive && readme.includes('issues-archive.html')) { ng.push('README が issues-archive にリンクしている'); }
	if (f.endsWith('issues.html') && !s.includes('href="issues-archive.html"')) { ng.push('issues-archive へのリンクが無い'); }
	if (isArchive && !s.includes('href="issues.html"')) { ng.push('issues へのリンクが無い'); }
	if (/(^|\/)(issues|status)/.test(path.posix.basename(f)) && !/<title>[^<]*ai-agent-tools/.test(s)) { ng.push('タイトルにプロジェクト名（ai-agent-tools）が無い'); }

	if (ng.length > 0) { bad++; }
	console.log((ng.length === 0 ? '[OK] ' : '[NG] ') + f);
	for (const n of ng) { console.log('      - ' + n); }
}

console.log('');
console.log(bad === 0 ? '=== ' + files.length + ' 件すべて外れなし ===' : '=== ' + bad + ' 件に外れがある（' + files.length + ' 件中）===');
process.exit(bad === 0 ? 0 : 1);
