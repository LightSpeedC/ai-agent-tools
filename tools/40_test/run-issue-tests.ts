/*
	issue（課題管理ツール）のフェーズ 1 のテスト: 課題ファイルの読み込みと `issue check`。
	計画は p261103-01、仕様は notes/50_spec/課題ファイルの形と検査.html。

	状態は state キーではなく、置いてあるフォルダ (todo / doing / done / archived) で持つ (計画の 126-A)。
	期待値は、仕様から先に手で書いた（実装の出力から作っていない）。
	本物のプロジェクトには触らない。tmp/ の下に、ケースごとの小さなプロジェクトを作る。

	人を表す値は example.com のような仮の値にする（共通ルール「テストのルール」）。
*/
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..', '..');
const work = path.join(root, 'tmp', 'issue-tests');
const main = path.join(root, 'src', 'issue', 'main.ts');

let pass = 0;
let fail = 0;
function check(name: string, ok: boolean, detail: string = ''): void {
	if (ok) { pass++; console.log('  ✅ [OK] ' + name); }
	else { fail++; console.log('  ❌ [NG] ' + name + (detail ? '  ' + detail : '')); }
}

function fwd(p: string): string {
	return p.split('\\').join('/');
}

// ---- 材料 ----

const ProjectIdText = 'schema: 1\nproject_id: 7b0c4e1a9f3d4a62b8d51c2e6f90a3b7\n';
const Items = 'notes/40_issues/items/';
const Todo = Items + 'todo/';
const Doing = Items + 'doing/';
const Done = Items + 'done/';
const Archived = Items + 'archived/';

/** メタ情報の既定の並び（仕様のキー項目の表の順。state は持たない） */
const KeyOrder = ['schema', 'id', 'title', 'group', 'created', 'from', 'confirmed', 'refs'];
const Defaults: Record<string, string> = {
	schema: '1', id: 'i261103-01', title: 'li の中の表を、表のまま出す', group: 'html2md', created: '2026-11-03',
};

/**
 * 課題ファイルの中身を作る。over の値が null ならそのキーを省く。
 * 既定のキーは仕様の順に並べ、知らないキーは最後に足す。
 */
function issueText(over: Record<string, string | null> = {}, body: string = '\n本文\n'): string {
	const all: Record<string, string | null> = { ...Defaults, ...over };
	const keys = [...KeyOrder.filter((k) => k in all), ...Object.keys(all).filter((k) => !KeyOrder.includes(k))];
	const lines = keys.filter((k) => all[k] !== null).map((k) => k + ': ' + all[k]);
	return '---\n' + lines.join('\n') + '\n---\n' + body;
}

/** 課題 1 件の標準のファイル名 (todo/ の中) */
const Name1 = Todo + 'i261103-01-li内の表.md';

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

/** project-id.txt を持つ標準のプロジェクト。files が上書き・追加される */
function std(name: string, files: Record<string, string> = {}): string {
	return mkProject(name, { [Items + 'project-id.txt']: ProjectIdText, ...files });
}

type Result = { code: number; out: string; err: string };

function run(args: string[], cwd: string): Result {
	const r = spawnSync(process.execPath, [main, ...args], { cwd, encoding: 'utf8', timeout: 60000 });
	return { code: r.status ?? -1, out: (r.stdout ?? '').trim(), err: (r.stderr ?? '').trim() };
}

function checkRun(dir: string, extra: string[] = []): Result {
	return run(['check', '--root', dir, ...extra], dir);
}

/** エラーで止まり、指定の種別が出ていること */
function errorWith(r: Result, code: string, file: string = ''): boolean {
	return r.code === 1 && r.out.includes('[NG] ') && r.out.includes('[' + code + ']') && (file === '' || r.out.includes(file));
}

/** エラーは無く、警告に指定の種別が出ていること */
function warnWith(r: Result, code: string): boolean {
	return r.code === 0 && r.out.includes('[警告] ') && r.out.includes('[' + code + ']');
}

// ---- ケース ----

console.log('--- 正しいプロジェクト');
{
	const dir = std('ok-one', { [Name1]: issueText() });
	const r = checkRun(dir);
	check('正しい課題 1 件 (todo/) は、終了コード 0 で「問題なし」', r.code === 0 && r.out.includes('[OK] 課題 1 件 (未 1 件 ・ 着手 0 件 ・ 済 0 件 ・ archived 0 件)。問題なし'), r.out);
	check('出力に絶対パスを出さない', !r.out.includes(dir) && !r.out.includes(fwd(dir)), r.out);
}
{
	const dir = std('ok-empty');
	const r = checkRun(dir);
	check('課題が 0 件でも、project-id.txt があれば終了コード 0', r.code === 0 && r.out.includes('課題 0 件'), r.out);
}
{
	const dir = std('ok-colon', { [Name1]: issueText({ title: '直す: 表の中の # と : の扱い #1737' }) });
	check('題に ": " や "#" を含んでも読める (最初の ": " で分けるだけで、コメントは無い)', checkRun(dir).code === 0);
}
{
	const dir = std('ok-36', { [Todo + 'i261103-0L-大文字のエル.md']: issueText({ id: 'i261103-0L' }) });
	check('連番の 36 進数で、l は大文字の L (0L) なら読める', checkRun(dir).code === 0);
}
{
	const dir = std('ok-doing', { [Doing + 'i261103-01-着手中.md']: issueText() });
	const r = checkRun(dir);
	check('doing/ の課題は読める (着手として数える)', r.code === 0 && r.out.includes('未 0 件 ・ 着手 1 件'), r.out);
}
{
	const dir = std('ok-done', {
		[Done + 'i261103-01-済.md']: issueText({ from: 'project-a #1', confirmed: 'true' }, '\n本文\n\n## やること\n- [済] a\n- [済] b\n'),
	});
	const r = checkRun(dir);
	check('done/ で、やることが全部済で、報告元の確認が true なら読める (済として数える)', r.code === 0 && r.out.includes('済 1 件'), r.out);
}
{
	const dir = std('ok-archived', { [Archived + 'i261103-01-old.md']: issueText({ group: 'less' }) });
	const r = checkRun(dir);
	check('archived/ の課題は読める (archived として数える)', r.code === 0 && r.out.includes('課題 1 件 (未 0 件 ・ 着手 0 件 ・ 済 0 件 ・ archived 1 件)'), r.out);
}
{
	const dir = std('ok-counts', {
		[Todo + 'i261103-01-a.md']: issueText({ id: 'i261103-01' }),
		[Doing + 'i261103-02-b.md']: issueText({ id: 'i261103-02' }),
		[Doing + 'i261103-03-c.md']: issueText({ id: 'i261103-03' }),
		[Done + 'i261103-04-d.md']: issueText({ id: 'i261103-04' }),
		[Archived + 'i261103-05-e.md']: issueText({ id: 'i261103-05' }),
	});
	const r = checkRun(dir);
	check('4 つのフォルダの件数を、それぞれ数える (未 1 ・ 着手 2 ・ 済 1 ・ archived 1)', r.code === 0 && r.out.includes('課題 5 件 (未 1 件 ・ 着手 2 件 ・ 済 1 件 ・ archived 1 件)'), r.out);
}

console.log('--- project-id.txt');
{
	const dir = mkProject('pid-missing', { [Name1]: issueText() });
	check('project-id.txt が無ければエラー (project-id)', errorWith(checkRun(dir), 'project-id', 'project-id.txt'));
}
{
	const dir = mkProject('pid-bad', { [Items + 'project-id.txt']: 'schema: 1\nproject_id: ZZZ\n' });
	check('project_id が小文字 32 桁の 16 進数でなければエラー', errorWith(checkRun(dir), 'project-id'));
}
{
	const dir = mkProject('pid-upper', { [Items + 'project-id.txt']: 'schema: 1\nproject_id: 7B0C4E1A9F3D4A62B8D51C2E6F90A3B7\n' });
	check('project_id が大文字の 16 進数ならエラー (小文字だけ)', errorWith(checkRun(dir), 'project-id'));
}
{
	const dir = mkProject('pid-schema', { [Items + 'project-id.txt']: 'schema: 2\nproject_id: 7b0c4e1a9f3d4a62b8d51c2e6f90a3b7\n' });
	check('project-id.txt の schema が 1 でなければエラー', errorWith(checkRun(dir), 'project-id'));
}
{
	const dir = mkProject('pid-nokey', { [Items + 'project-id.txt']: 'schema: 1\n' });
	check('project_id のキーが無ければエラー', errorWith(checkRun(dir), 'project-id'));
}

console.log('--- 置き場 (状態のフォルダ)');
{
	const dir = std('place-root', { [Items + 'i261103-01-直下.md']: issueText() });
	check('items/ 直下に課題があればエラー (place)', errorWith(checkRun(dir), 'place', 'i261103-01-直下.md'));
}
{
	const dir = std('place-other', { [Items + 'other/i261103-01-別.md']: issueText() });
	check('todo / doing / done / archived 以外のフォルダに課題があればエラー (place)', errorWith(checkRun(dir), 'place'));
}
{
	const dir = std('place-state-key', { [Name1]: issueText({ state: '未' }) });
	check('state キーが残っていればエラー (state-key。状態はフォルダで持つ)', errorWith(checkRun(dir), 'state-key'));
}

console.log('--- ファイル名');
{
	const dir = std('name-nonissue', { [Todo + 'memo.md']: '# メモ\n' });
	check('状態のフォルダの中に、i で始まらない .md があればエラー (name)', errorWith(checkRun(dir), 'name', 'memo.md'));
}
{
	const dir = std('name-space', { [Todo + 'i261103-01-a b.md']: issueText() });
	check('件名に空白があればエラー (name)', errorWith(checkRun(dir), 'name'));
}
{
	const dir = std('name-lowerl', { [Todo + 'i261103-0l-小文字のエル.md']: issueText({ id: 'i261103-0l' }) });
	check('連番に小文字の l を使えばエラー (L と書く決め)', errorWith(checkRun(dir), 'name'));
}
{
	const dir = std('name-noslug', { [Todo + 'i261103-01.md']: issueText() });
	check('件名の無いファイル名 (<id>.md) はエラー (name)', errorWith(checkRun(dir), 'name'));
}
{
	const dir = std('name-long', { [Todo + 'i261103-01-' + 'あ'.repeat(31) + '.md']: issueText() });
	check('件名が 30 文字を超えれば警告 (slug-long)。エラーではない', warnWith(checkRun(dir), 'slug-long'));
}
{
	const dir = std('name-id-mismatch', { [Todo + 'i261103-02-x.md']: issueText({ id: 'i261103-01' }) });
	check('id キーがファイル名の先頭と違えばエラー (value)', errorWith(checkRun(dir), 'value', 'i261103-02-x.md'));
}

console.log('--- メタ情報の形');
{
	const dir = std('meta-nofence', { [Name1]: 'id: i261103-01\n\n本文\n' });
	check('先頭が --- でなければエラー (meta)', errorWith(checkRun(dir), 'meta'));
}
{
	const dir = std('meta-unclosed', { [Name1]: '---\nschema: 1\nid: i261103-01\n' });
	check('閉じの --- が無ければエラー (meta)', errorWith(checkRun(dir), 'meta'));
}
{
	const dir = std('meta-empty-value', { [Name1]: issueText({ group: '' }) });
	check('値が空のキーはエラー (meta)', errorWith(checkRun(dir), 'meta'));
}
{
	const dir = std('meta-dup', { [Name1]: issueText().replace('group: html2md\n', 'group: html2md\ngroup: less\n') });
	check('キーが重複すればエラー (meta)', errorWith(checkRun(dir), 'meta'));
}
{
	const dir = std('meta-badline', { [Name1]: issueText().replace('group: html2md\n', 'group: html2md\nこれはキーではない\n') });
	check('キー: 値の形でない行があればエラー (meta)', errorWith(checkRun(dir), 'meta'));
}
{
	const dir = std('meta-blankline', { [Name1]: issueText().replace('group: html2md\n', 'group: html2md\n\n') });
	check('メタ情報の中の空行はエラー (meta)', errorWith(checkRun(dir), 'meta'));
}
{
	const dir = std('enc-bom', { [Name1]: '\uFEFF' + issueText() });
	check('BOM があればエラー (encoding)', errorWith(checkRun(dir), 'encoding'));
}
{
	const dir = std('enc-crlf', { [Name1]: issueText().split('\n').join('\r\n') });
	check('CRLF があればエラー (encoding)', errorWith(checkRun(dir), 'encoding'));
}

console.log('--- 必須キーと値');
for (const key of ['schema', 'id', 'title', 'group', 'created']) {
	const dir = std('key-' + key, { [Name1]: issueText({ [key]: null }) });
	check('必須の ' + key + ' が無ければエラー (key)', errorWith(checkRun(dir), 'key'));
}
{
	const dir = std('value-schema', { [Name1]: issueText({ schema: '2' }) });
	check('schema が 1 以外ならエラー (value)', errorWith(checkRun(dir), 'value'));
}
{
	const dir = std('value-created-format', { [Name1]: issueText({ created: '2026/11/03' }) });
	check('created が yyyy-mm-dd でなければエラー (value)', errorWith(checkRun(dir), 'value'));
}
{
	const dir = std('value-created-real', { [Name1]: issueText({ created: '2026-02-30' }) });
	check('created が実在しない日付ならエラー (value)', errorWith(checkRun(dir), 'value'));
}
{
	const dir = std('value-confirmed', { [Name1]: issueText({ from: 'project-a #1', confirmed: 'yes' }) });
	check('confirmed が true / false 以外ならエラー (value)', errorWith(checkRun(dir), 'value'));
}
{
	const dir = std('value-refs', { [Name1]: issueText({ refs: '123, ' }) });
	check('refs の形が違えばエラー (value)', errorWith(checkRun(dir), 'value'));
}

console.log('--- 警告で済むもの');
{
	const text = issueText().replace('title: li の中の表を、表のまま出す\ngroup: html2md\n', 'group: html2md\ntitle: li の中の表を、表のまま出す\n');
	const dir = std('warn-order', { [Name1]: text });
	check('キーの順が仕様と違えば警告 (key-order)。エラーではない', warnWith(checkRun(dir), 'key-order'));
}
{
	const dir = std('warn-unknown', { [Name1]: issueText({ priority: 'high' }) });
	check('知らないキーは警告 (unknown-key)。エラーではない', warnWith(checkRun(dir), 'unknown-key'));
}
{
	const dir = std('warn-confirmed', { [Name1]: issueText({ confirmed: 'false' }) });
	check('from が無いのに confirmed があれば警告 (confirmed)', warnWith(checkRun(dir), 'confirmed'));
}
{
	const dir = std('warn-group', {
		[Items + 'groups.txt']: 'less\nhtml2md\n',
		[Name1]: issueText({ group: 'check-public' }),
	});
	check('groups.txt があり、課題の group が載っていなければ警告 (group)', warnWith(checkRun(dir), 'group'));
}
{
	const dir = std('ok-group', {
		[Items + 'groups.txt']: 'less\nhtml2md\n',
		[Name1]: issueText({ group: 'html2md' }),
	});
	check('groups.txt に載っている group は警告にならない', checkRun(dir).code === 0 && !checkRun(dir).out.includes('[警告]'));
}
{
	const dir = std('err-group-dup', { [Items + 'groups.txt']: 'less\nless\n' });
	check('groups.txt に同じ名前が 2 度あればエラー (group)', errorWith(checkRun(dir), 'group', 'groups.txt'));
}

console.log('--- refs');
{
	const dir = std('refs-missing', { [Name1]: issueText({ refs: 'i261103-99' }) });
	check('refs の課題が見つからなければ警告 (refs)', warnWith(checkRun(dir), 'refs'));
}
{
	const dir = std('refs-issue', {
		[Name1]: issueText({ refs: 'i261103-02' }),
		[Done + 'i261103-02-b.md']: issueText({ id: 'i261103-02' }),
	});
	check('refs の課題が、どの状態のフォルダにあっても警告にならない', checkRun(dir).code === 0 && !checkRun(dir).out.includes('[refs]'), checkRun(dir).out);
}
{
	const dir = std('refs-plan', {
		[Name1]: issueText({ refs: 'p261103-01, r261025-01' }),
		'notes/10_plan/p261103-01-課題管理ツール.html': '<html></html>\n',
		'notes/01_research/r261025-01-失敗の振り返り.html': '<html></html>\n',
	});
	check('refs の計画 ・ 調査が notes/ にあれば警告にならない', checkRun(dir).code === 0 && !checkRun(dir).out.includes('[refs]'), checkRun(dir).out);
}
{
	const dir = std('refs-other-project', { [Name1]: issueText({ refs: 'ai-chat-lite:i261101-04' }) });
	check('refs の プロジェクト名:番号 は、外を読まないので確かめない', checkRun(dir).code === 0 && !checkRun(dir).out.includes('[refs]'), checkRun(dir).out);
}

console.log('--- 重複');
{
	const dir = std('dup-same-folder', {
		[Todo + 'i261103-01-a.md']: issueText(),
		[Todo + 'i261103-01-b.md']: issueText(),
	});
	check('同じ id が 2 つのファイルにあればエラー (duplicate)。別の PC で件名違いに立った場合', errorWith(checkRun(dir), 'duplicate'));
}
{
	const dir = std('dup-folders', {
		[Todo + 'i261103-01-a.md']: issueText(),
		[Archived + 'i261103-01-b.md']: issueText(),
	});
	check('todo/ と archived/ のように、フォルダをまたいで同じ id があればエラー (duplicate)', errorWith(checkRun(dir), 'duplicate'));
}

console.log('--- やること ・ 報告元の確認 (済は done/ ・ archived/ に置く)');
{
	const dir = std('todo-open-done', { [Done + 'i261103-01-a.md']: issueText({}, '\n## やること\n- [済] a\n- [着手] b\n') });
	check('done/ にあるのに、着手のやることが残っていればエラー (todo)', errorWith(checkRun(dir), 'todo'));
}
{
	const dir = std('todo-open-archived', { [Archived + 'i261103-01-a.md']: issueText({}, '\n## やること\n- [未] a\n') });
	check('archived/ にあるのに、未のやることが残っていればエラー (todo)', errorWith(checkRun(dir), 'todo'));
}
{
	const dir = std('todo-badstate', { [Name1]: issueText({}, '\n## やること\n- [x] a\n') });
	check('やることの状態が 未 / 着手 / 済 以外ならエラー (todo)', errorWith(checkRun(dir), 'todo'));
}
{
	const dir = std('todo-fine', { [Name1]: issueText({}, '\n## やること\n- [未] a\n- [着手] b\n- [済] c\n') });
	check('todo/ の課題に、未・着手・済のやることが混ざっていてもよい', checkRun(dir).code === 0);
}
{
	const dir = std('confirmed-missing', { [Name1]: issueText({ from: 'project-a #1' }) });
	check('from があるのに confirmed が無ければエラー (confirmed)', errorWith(checkRun(dir), 'confirmed'));
}
{
	const dir = std('confirmed-false-done', { [Done + 'i261103-01-a.md']: issueText({ from: 'project-a #1', confirmed: 'false' }) });
	check('報告元の確認が true でないのに done/ にあればエラー (confirmed)', errorWith(checkRun(dir), 'confirmed'));
}
{
	const dir = std('confirmed-false-archived', { [Archived + 'i261103-01-a.md']: issueText({ from: 'project-a #1', confirmed: 'false' }) });
	check('報告元の確認が true でないのに archived/ にあればエラー (confirmed)', errorWith(checkRun(dir), 'confirmed'));
}
{
	const dir = std('confirmed-false-todo', { [Name1]: issueText({ from: 'project-a #1', confirmed: 'false' }) });
	check('報告元の確認が false でも、todo/ ・ doing/ にあれば問題ない (済にしなければよい)', checkRun(dir).code === 0, checkRun(dir).out);
}

console.log('--- 呼び方 ・ 出力');
{
	const dir = std('find-up', { [Name1]: issueText() });
	const r = run(['check'], path.join(dir, 'notes', '40_issues'));
	check('--root が無ければ、作業フォルダから親をたどってプロジェクトを見つける', r.code === 0 && r.out.includes('課題 1 件'), r.out);
}
{
	const lonely = fs.mkdtempSync(path.join(os.tmpdir(), 'issue-tests-'));
	try {
		const r = run(['check'], lonely);
		check('プロジェクトが見つからなければ終了コード 5', r.code === 5, 'code=' + r.code);
	} finally {
		fs.rmSync(lonely, { recursive: true, force: true });
	}
}
{
	const dir = mkProject('no-items', { 'README.md': '# x\n' });
	check('items/ が無いプロジェクトを --root で指せば、終了コード 5', checkRun(dir).code === 5);
}
{
	const dir = std('args', {});
	check('知らないサブコマンドは終了コード 5', run(['frobnicate'], dir).code === 5);
	check('引数が無ければ終了コード 5 (使い方を出す)', run([], dir).code === 5);
	check('知らないオプションは終了コード 5', run(['check', '--bogus'], dir).code === 5);
	check('終了コードに 2 を使わない (Stop フックが 2 を「続ける」と読むため)', ![run(['frobnicate'], dir).code, run([], dir).code, run(['check', '--bogus'], dir).code].includes(2));
}
{
	const dir = std('json', {
		[Name1]: issueText({ state: '未' }),
		[Doing + 'i261103-02-b.md']: issueText({ id: 'i261103-02', priority: 'x' }),
		[Done + 'i261103-03-c.md']: issueText({ id: 'i261103-03' }),
	});
	const r = checkRun(dir, ['--json']);
	let parsed: { ok?: boolean; errors?: number; warnings?: number; issues?: number; todo?: number; doing?: number; done?: number; archived?: number; findings?: { level: string; code: string; file: string; message: string }[] } = {};
	try { parsed = JSON.parse(r.out); } catch { /* 下で失敗にする */ }
	check('--json は 1 つの JSON を出す (ok ・ errors ・ warnings ・ issues ・ todo ・ doing ・ done ・ archived ・ findings)',
		parsed.ok === false && parsed.errors === 1 && parsed.warnings === 1 && parsed.issues === 3 && parsed.todo === 1 && parsed.doing === 1 && parsed.done === 1 && parsed.archived === 0 && Array.isArray(parsed.findings), r.out);
	check('--json でも、エラーがあれば終了コード 1', r.code === 1);
	check('--json の findings に、重さ ・ 種別 ・ ファイル ・ 文を持つ', (parsed.findings ?? []).every((f) => f.level && f.code && f.file && f.message), r.out);
}
{
	const dir = std('readonly', { [Name1]: issueText({ state: '未' }) });
	const before = fs.readFileSync(path.join(dir, Name1), 'utf8');
	checkRun(dir);
	check('検査は何も書き換えない', fs.readFileSync(path.join(dir, Name1), 'utf8') === before);
}

console.log('');
console.log(`=== issue: ${pass} 件成功 ・ ${fail} 件失敗 ===`);
fs.rmSync(work, { recursive: true, force: true });
process.exit(fail === 0 ? 0 : 1);
