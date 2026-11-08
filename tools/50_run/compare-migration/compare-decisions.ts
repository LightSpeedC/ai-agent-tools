/*
	issue decide migrate を、元のプロジェクトの写しで往復させて確かめる (計画 p261108-03)。
	元のプロジェクトには書かない。notes/ を tmp/compare-decisions/<名前>/ へ写し、そこで流す。

		node tools/50_run/compare-migration/compare-decisions.ts <プロジェクトのフォルダ> [...]

	見るもの: 計画の件数 ・ --apply の後の読み直し (旧番号 ・ 選んだ字 ・ 親 ・ 案の数) ・ issue check のエラー ・
	render の HTML に出た決定の数 ・ --undo の後に、書いた決定が残っていないこと。
*/
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { applyDecideMigration, planDecideMigration, removeDecideWritten, verifyDecideWritten } from '../../../src/issue/decide-migrate.ts';
import { checkProject } from '../../../src/issue/check.ts';
import { renderHtml } from '../../../src/issue/render.ts';
import { applyMigration, planMigration } from '../../../src/issue/migrate.ts';
import { initProject } from '../../../src/issue/ops.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '..', '..', '..');

function compareProject(src: string): void {
	const name = path.basename(src);
	const work = path.join(repo, 'tmp', 'compare-decisions', name);
	fs.rmSync(work, { recursive: true, force: true });
	fs.mkdirSync(work, { recursive: true });
	// .gitignore で外したもの (先頭 _) は写さない
	fs.cpSync(path.join(src, 'notes'), path.join(work, 'notes'), { recursive: true, filter: (p) => !path.basename(p).startsWith('_') });

	// 決定の移行は、課題の移行が前提。写しで課題がまだ移っていなければ、先に issue migrate と同じことをする
	const issues = path.join(work, 'notes', '40_issues');
	let issueStep = '課題は移行済み';
	if (fs.existsSync(path.join(issues, 'issues.html')) || !fs.existsSync(path.join(issues, 'items', 'project-id.txt'))) {
		initProject(work, false);
		const ip = planMigration(work);
		if (ip.conflicts.length > 0 || ip.mismatches.length > 0) throw new Error(`課題の移行で止まった (確かめが要る ${ip.conflicts.length} ・ 食い違い ${ip.mismatches.length})`);
		const iw = applyMigration(work, ip).written.length;
		if (fs.existsSync(path.join(issues, 'issues.html'))) fs.renameSync(path.join(issues, 'issues.html'), path.join(issues, 'issues-legacy.html'));
		issueStep = `課題を先に移した (${iw} 件)`;
	}
	const plan = planDecideMigration(work);
	fs.mkdirSync(path.join(work, 'notes', '40_issues', 'decisions'), { recursive: true });
	const before =fs.readdirSync(path.join(work, 'notes', '40_issues', 'decisions'), { withFileTypes: true }).length;
	let written: { id: string; rel: string; legacy: string }[] = [];
	let failed = '';
	try { written = applyDecideMigration(work, plan).written; } catch (e) { failed = e instanceof Error ? e.message : String(e); }
	const problems = verifyDecideWritten(work, plan, written);
	const errors = checkProject(work).findings.filter((f) => f.level === 'error' && f.file.includes('decisions'));
	const r = renderHtml({ root: work, outFile: path.join(work, 'notes', '40_issues', '_issues.html'), standalone: false, folders: ['todo', 'doing', 'done', 'archived'], group: null, ids: [], warn: () => {} });
	const shown = (r.html.match(/<details class="decision/g) ?? []).length;
	const removed = removeDecideWritten(work, written.map((w) => w.rel));
	const after = fs.readdirSync(path.join(work, 'notes', '40_issues', 'decisions'), { withFileTypes: true }).length;

	const ok = failed === '' && problems.length === 0 && errors.length === 0 && written.length === plan.move.length && removed === written.length && after === before;
	console.log(`${ok ? '✅' : '❌'} ${name}: ${issueStep} ・ 決定を移す ${plan.move.length} 件 (表 ${plan.move.length - plan.fromText.length} ・ 本文 ${plan.fromText.length}) ・ 既にある ${plan.skipped.length} ・ A とみなした ${plan.assumedA.length} ・ 字が割れた ${plan.split.length} ・ 読めない ${plan.unreadable.length}`);
	console.log(`    書いた ${written.length} ・ 読み直しの食い違い ${problems.length} ・ check のエラー ${errors.length} ・ render に出た決定 ${shown} ・ undo で消した ${removed} (残り ${after - before})`);
	if (failed !== '') console.log(`    書く途中で失敗: ${failed}`);
	for (const p of problems.slice(0, 5)) console.log(`    - ${p.id}: ${p.message}`);
	for (const e of errors.slice(0, 5)) console.log(`    - ${e.file}: ${e.message}`);
	for (const u of plan.unreadable.slice(0, 5)) console.log(`    読めない: ${u.where}: ${u.message}`);
	fs.rmSync(work, { recursive: true, force: true });
}

for (const p of process.argv.slice(2)) {
	try {
		compareProject(path.resolve(p));
	} catch (e) {
		console.log(`❌ ${path.basename(p)}: 失敗: ${e instanceof Error ? e.message : String(e)}`);
	}
}
