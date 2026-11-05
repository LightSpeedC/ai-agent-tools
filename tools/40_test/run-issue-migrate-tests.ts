/*
	issue（課題管理ツール）の旧 HTML の読み取り (issue migrate の前半) のテスト:
	  ・parseLegacyIssues: 旧 issues.html の形 (section > h1 のグループ、details > summary > 状態バッジ ・ 番号 ・ 件名、
	    div.issue-body) から課題を読む。読めない形は、推測せず「読めなかった」に出す
	  ・issue migrate (既定は --dry-run): 件数と読めなかった一覧だけを出し、何も書かない
	計画は p261105-01 (ch02 の issue migrate) と p261106-01 (143-A: 済みも移す)。

	期待値は、計画と旧 HTML の形から先に手で書いた (実装の出力から作っていない)。
	本物のプロジェクトには触らない。tmp/ の下に、ケースごとの小さなプロジェクトを作る。
*/
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..', '..');
const work = path.join(root, 'tmp', 'issue-migrate-tests');
const main = path.join(root, 'src', 'issue', 'main.ts');

let pass = 0;
let fail = 0;
function check(name: string, ok: boolean, detail: string = ''): void {
	if (ok) { pass++; console.log('  ✅ [OK] ' + name); }
	else { fail++; console.log('  ❌ [NG] ' + name + (detail ? '  ' + detail : '')); }
}

// 実装がまだ無いとき (❌Red) も、ケースごとに落ちたと報告するため、動的に読む
type LegacyIssue = { id: string; state: string; title: string; group: string; bodyHtml: string };
type LegacyProblem = { where: string; message: string };
type Parsed = { issues: LegacyIssue[]; problems: LegacyProblem[] };
let parseLegacyIssues: ((html: string) => Parsed) | null = null;
try {
	const mod = await import('../../src/issue/migrate.ts');
	parseLegacyIssues = mod.parseLegacyIssues;
} catch { /* 実装が無い */ }

function parse(html: string): Parsed {
	if (parseLegacyIssues === null) { return { issues: [], problems: [{ where: '', message: '実装が無い (migrate.ts を読めない)' }] }; }
	try { return parseLegacyIssues(html); }
	catch (e) { return { issues: [], problems: [{ where: '', message: '例外: ' + (e instanceof Error ? e.message : String(e)) }] }; }
}

// ---- 材料 ----

const Good = [
	'<html><body><div class="titlebar"><h1>x の課題</h1></div>',
	'<section class="ch01" id="ch01"><h1>グループ甲</h1>',
	'<details><summary><span class="badge b-ok">済</span><span class="no">i260101-01</span>件名 <code>a</code> です</summary>',
	'<div class="issue-body"><p>本文 <span class="no">i260101-02</span> を参照</p></div></details>',
	'<p>グループの説明</p>',
	'<details open><summary><span class="badge b-warn">着手</span><span class="no">i260101-02</span>二つ目</summary>',
	'<div class="issue-body"><ul><li><span class="badge b-ok">済</span>やった</li></ul></div></details>',
	'</section>',
	'<section class="ch02" id="ch02"><h1>グループ乙</h1>',
	'<details><summary><span class="badge b-none">未</span><span class="no">i260102-0a</span>三つ目</summary>',
	'<div class="issue-body"><p>x</p></div></details>',
	'</section></body></html>',
].join('\n');

const Archive = [
	'<html><body><section class="ch01" id="ch01"><h1>保管グループ</h1>',
	'<details><summary><span class="badge b-ok">済</span><span class="no">i250101-01</span>古い課題</summary>',
	'<div class="issue-body"><p>古い本文</p></div></details>',
	'</section></body></html>',
].join('\n');

console.log('');
console.log('=== issue migrate (旧 HTML の読み取り) ===');

// ---- parseLegacyIssues ----

{
	const r = parse(Good);
	check('良い形: 課題を 3 件読み、読めなかったものは 0 件',
		r.issues.length === 3 && r.problems.length === 0,
		'件数 ' + r.issues.length + ' / 問題 ' + JSON.stringify(r.problems));
	check('番号と状態を読む (済 ・ 着手 ・ 未)',
		JSON.stringify(r.issues.map((i) => [i.id, i.state])) === JSON.stringify([['i260101-01', '済'], ['i260101-02', '着手'], ['i260102-0a', '未']]),
		JSON.stringify(r.issues.map((i) => [i.id, i.state])));
	check('件名はタグを除いた 1 行 (code の中身は残る)', r.issues[0]?.title === '件名 a です', JSON.stringify(r.issues[0]?.title));
	check('グループは、直前の章 (section) の h1',
		JSON.stringify(r.issues.map((i) => i.group)) === JSON.stringify(['グループ甲', 'グループ甲', 'グループ乙']),
		JSON.stringify(r.issues.map((i) => i.group)));
	check('本文は issue-body の中身 (本文の中の番号は課題として数えない)',
		(r.issues[0]?.bodyHtml ?? '').includes('本文') && (r.issues[0]?.bodyHtml ?? '').includes('i260101-02'),
		JSON.stringify(r.issues[0]?.bodyHtml));
	check('details の open 属性があっても読める', r.issues[1]?.title === '二つ目', JSON.stringify(r.issues[1]?.title));
}

{
	const html = '<section class="ch01"><h1>甲</h1>'
		+ '<details><summary><span class="badge b-ok">済</span>番号が無い件名</summary><div class="issue-body"><p>x</p></div></details>'
		+ '</section>';
	const r = parse(html);
	check('番号が無い課題は、読めなかったに出す (新しい番号を勝手に振らない)',
		r.issues.length === 0 && r.problems.length === 1 && r.problems[0].message.includes('番号'),
		JSON.stringify(r));
	check('読めなかったには、どの課題かが分かる手がかり (グループ ・ 件名) が付く',
		r.problems[0]?.where.includes('甲') && r.problems[0]?.where.includes('番号が無い件名'),
		JSON.stringify(r.problems[0]));
}

{
	const html = '<section class="ch01"><h1>甲</h1>'
		+ '<details><summary><span class="badge b-ps51">PS5.1</span><span class="no">i260101-03</span>状態が読めない</summary><div class="issue-body"></div></details>'
		+ '</section>';
	const r = parse(html);
	check('状態が 未 ・ 着手 ・ 済 のどれでもなければ、読めなかったに出す',
		r.issues.length === 0 && r.problems.length === 1 && r.problems[0].message.includes('状態'),
		JSON.stringify(r));
}

{
	const html = '<section class="ch01"><h1>甲</h1>'
		+ '<details><summary><span class="badge b-ok">済</span><span class="no">i260101-04</span>同じ番号 1</summary><div class="issue-body"></div></details>'
		+ '<details><summary><span class="badge b-ok">済</span><span class="no">i260101-04</span>同じ番号 2</summary><div class="issue-body"></div></details>'
		+ '</section>';
	const r = parse(html);
	check('同じ番号が 2 回出たら、2 件目を読めなかったに出す (黙って上書きしない)',
		r.issues.length === 1 && r.problems.length === 1 && r.problems[0].message.includes('重複'),
		JSON.stringify(r));
}

{
	const html = '<section class="ch01"><h1>甲</h1>'
		+ '<details><summary><span class="badge b-ok">済</span><span class="no">i260101-05</span>親'
		+ '</summary><div class="issue-body"><details><summary>入れ子の折りたたみ</summary><p>中</p></details><p>後ろ</p></div></details>'
		+ '</section>';
	const r = parse(html);
	check('本文の中の details (入れ子) は課題として数えず、本文に残る',
		r.issues.length === 1 && r.problems.length === 0 && (r.issues[0]?.bodyHtml ?? '').includes('入れ子の折りたたみ') && (r.issues[0]?.bodyHtml ?? '').includes('後ろ'),
		JSON.stringify(r));
}

// ---- issue migrate (既定は --dry-run) ----

const ProjectIdText = 'schema: 1\nproject_id: 7b0c4e1a9f3d4a62b8d51c2e6f90a3b7\n';
const Items = 'notes/40_issues/items/';
const Legacy = 'notes/40_issues/issues-legacy.html';
const ArchiveFile = 'notes/40_issues/issues-archive.html';

function mkProject(name: string, files: Record<string, string>): string {
	const dir = path.join(work, name);
	fs.rmSync(dir, { recursive: true, force: true });
	fs.mkdirSync(dir, { recursive: true });
	for (const [rel, text] of Object.entries(files)) {
		const full = path.join(dir, rel);
		fs.mkdirSync(path.dirname(full), { recursive: true });
		fs.writeFileSync(full, text);
	}
	return dir;
}

function run(args: string[], dir: string): { code: number; out: string; err: string } {
	const e = { ...process.env, ISSUE_TEST_TODAY: '2026-11-05', ISSUE_TEST_NOW: '2026/11/05 12:34:56' } as Record<string, string>;
	const r = spawnSync(process.execPath, [main, ...args, '--root', dir], { cwd: dir, env: e, encoding: 'utf8', timeout: 60000 });
	return { code: r.status ?? -1, out: (r.stdout ?? '').trim(), err: (r.stderr ?? '').trim() };
}

function listAll(dir: string): string[] {
	const out: string[] = [];
	const walk = (d: string): void => {
		for (const n of fs.readdirSync(d, { withFileTypes: true })) {
			const full = path.join(d, n.name);
			if (n.isDirectory()) { walk(full); } else { out.push(path.relative(dir, full).replace(/\\/g, '/')); }
		}
	};
	walk(dir);
	return out.sort();
}

const existing = '---\nschema: 1\nid: i260101-02\ntitle: 二つ目\ngroup: グループ甲\ncreated: 2026-01-01\n---\n\n本文\n';

{
	const dir = mkProject('dry', {
		[Items + 'project-id.txt']: ProjectIdText,
		[Items + 'doing/i260101-02-二つ目.md']: existing,
		[Legacy]: Good,
		[ArchiveFile]: Archive,
	});
	const before = listAll(dir);
	const r = run(['migrate'], dir);
	check('既定は --dry-run: 終了コード 0', r.code === 0, 'code=' + r.code + ' err=' + r.err);
	check('旧 HTML から読んだ件数 (4 件) と内訳を出す',
		r.out.includes('課題 4 件を読んだ') && r.out.includes('issues-legacy.html 3 件') && r.out.includes('issues-archive.html 1 件'), r.out);
	check('移す件数 (3 件) と、移し先の内訳 (済 1 ・ 着手 0 ・ 未 1 ・ 保管 1) を出す',
		r.out.includes('移す: 3 件') && r.out.includes('済 1') && r.out.includes('着手 0') && r.out.includes('未 1') && r.out.includes('保管 1'), r.out);
	check('すでに items/ にある番号は、移さない件数に数える', r.out.includes('すでに items/ にある (移さない): 1 件'), r.out);
	check('読めなかったは 0 件', r.out.includes('読めなかった: 0 件'), r.out);
	check('何も書かない (ファイルの一覧が変わらない)', JSON.stringify(listAll(dir)) === JSON.stringify(before), JSON.stringify(listAll(dir)));
	const j = run(['migrate', '--dry-run', '--json'], dir);
	let parsed: { read?: number; move?: { id: string; folder: string }[]; exists?: string[]; unreadable?: unknown[] } = {};
	try { parsed = JSON.parse(j.out); } catch { /* 下で落とす */ }
	check('--json: read 4 ・ move 3 件 (済は done ・ 未は todo ・ 保管は archived) ・ exists 1 件 ・ unreadable 0 件',
		parsed.read === 4 && parsed.move?.length === 3 && parsed.exists?.length === 1 && parsed.unreadable?.length === 0
		&& JSON.stringify(parsed.move?.map((m) => [m.id, m.folder])) === JSON.stringify([['i260101-01', 'done'], ['i260102-0a', 'todo'], ['i250101-01', 'archived']]),
		j.out);
}

{
	const bad = Good.replace('<span class="no">i260102-0a</span>', '');
	const dir = mkProject('unreadable', {
		[Items + 'project-id.txt']: ProjectIdText,
		[Legacy]: bad,
	});
	const r = run(['migrate', '--dry-run'], dir);
	check('読めなかった課題があれば、終了コード 1 (件数と手がかりを出す)',
		r.code === 1 && r.out.includes('読めなかった: 1 件') && r.out.includes('三つ目'),
		'code=' + r.code + ' ' + r.out);
}

{
	const dir = mkProject('nosource', { [Items + 'project-id.txt']: ProjectIdText });
	const r = run(['migrate'], dir);
	check('旧 HTML が無ければ、終了コード 1 (見つからないと言う)', r.code === 1 && (r.err + r.out).includes('旧 HTML'), 'code=' + r.code + ' ' + r.err + r.out);
}

fs.rmSync(work, { recursive: true, force: true });
console.log('');
console.log(fail === 0 ? '=== ' + pass + ' 件すべて成功 ===' : '=== ' + fail + ' 件失敗 (成功 ' + pass + ' 件) ===');
process.exit(fail === 0 ? 0 : 1);
