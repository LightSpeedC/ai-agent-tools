/*
	HTML の <style> で、グラデーション・var() で塗る地の前に、色だけの地を直書きで足す (p261031-01、74-A)。
	共通ルール「HTMLデザインルール」の「グラデーション・var() で塗る地の前に、色だけの地を直書きで書く」に合わせる。

	    node tools/40_test/fix-html-bg.ts --all             git の対象の HTML すべて (tests/ と src/ を除く)
	    node tools/40_test/fix-html-bg.ts <path>...         指定した HTML
	    node tools/40_test/fix-html-bg.ts --dry-run ...     書かずに、足す件数だけ出す

	足す色は、その地の最初の色 (var() なら既定値)。冪等で、足し済みなら触らない (中身が同じなら書かない)。
	BOM ・ 改行 ・ <style> の外は、そのまま保つ。最初の色が取れない地は、足さずに挙げる (手で直す)。
	check-html-rules.ts が同じ判定で検査する。
*/
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { fixBgHtml } from './html-bg-lib.ts';

const root = path.resolve(import.meta.dirname, '..', '..');
const argv = process.argv.slice(2);
const dry = argv.includes('--dry-run');
const rest = argv.filter((a) => a !== '--dry-run');

let files: string[];
if (rest.includes('--all')) {
	files = execSync('git -c core.quotepath=false ls-files --cached --others --exclude-standard -- "*.html"', { cwd: root, encoding: 'utf8' })
		.split('\n').filter((f) => f && !f.startsWith('tests/') && !f.startsWith('src/'));
} else {
	files = rest;
}
if (files.length === 0) {
	console.error('対象がありません。--all か、HTML のパスを渡してください。');
	process.exit(2);
}

let wrote = 0;
let same = 0;
let total = 0;
let unresolvedCount = 0;
for (const f of files) {
	const p = path.resolve(root, f);
	const before = fs.readFileSync(p, 'utf8');
	const r = fixBgHtml(before);
	unresolvedCount += r.unresolved.length;
	for (const u of r.unresolved) { console.log('  [手で直す] ' + f + ': ' + u); }
	if (r.html === before) { same++; continue; }
	total += r.added;
	if (!dry) { fs.writeFileSync(p, r.html, 'utf8'); }
	wrote++;
	console.log((dry ? '  [書かない] ' : '  [書いた] ') + f + '  色だけの地を ' + r.added + ' 個足した');
}

console.log('');
console.log('=== ' + (dry ? '(--dry-run) ' : '') + '書いた ' + wrote + ' ・ 変更なし ' + same + ' ・ 足した ' + total + ' 個 ・ 手で直す ' + unresolvedCount + ' 個 ===');
process.exit(unresolvedCount === 0 ? 0 : 1);
