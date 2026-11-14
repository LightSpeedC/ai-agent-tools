/*
	src/ を直す前に試験を変えていなければ知らせるフック (tools/10_setup/remind-test-first.ts) の試験。
	課題 i261111-04 (247-A)。決定 266-A (このプロジェクトの .claude/settings.json に置く) ・
	267-A (「試験を変えた」は git status の差分で見る)。

	知らせるだけで止めない。条件は、src/ の Edit ・ Write の前に、tools/40_test/ か tests/ に
	未 commit の変更 (新しいファイルも含む) が無いとき。
	期待値は、決めた仕様から先に手で書いた (実装の出力から作っていない)。
	一時の git リポジトリを tmp/ に作り、フックを標準入力付きで動かす。bun でも node でも流せる。
*/
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..', '..');
const hook = path.join(root, 'tools', '10_setup', 'remind-test-first.ts');
const work = path.join(root, 'tmp', 'remind-test-first-tests');

let pass = 0;
let fail = 0;
function check(name: string, ok: boolean, detail: string = ''): void {
	if (ok) { pass++; console.log('  ✅ [OK] ' + name); }
	else { fail++; console.log('  ❌ [NG] ' + name + (detail ? '  ' + detail : '')); }
}

function git(cwd: string, args: string[]): void {
	const r = spawnSync('git', ['-c', 'user.name=tester', '-c', 'user.email=tester@example.com', '-c', 'core.autocrlf=false', ...args], { cwd, encoding: 'utf8' });
	if (r.status !== 0) { throw new Error('git ' + args.join(' ') + ' が失敗: ' + r.stderr); }
}

function put(repo: string, rel: string, text: string): void {
	const p = path.join(repo, rel);
	fs.mkdirSync(path.dirname(p), { recursive: true });
	fs.writeFileSync(p, text);
}

/** 一時のリポジトリを作る。src ・ tools/40_test ・ tests ・ docs に 1 つずつファイルがある状態で commit 済み */
function repo(name: string): string {
	const dir = path.join(work, name);
	fs.rmSync(dir, { recursive: true, force: true });
	fs.mkdirSync(dir, { recursive: true });
	git(dir, ['init', '-q']);
	put(dir, 'src/a.ts', 'export const a = 1;\n');
	put(dir, 'tools/40_test/x.ts', '// x\n');
	put(dir, 'tests/y.ts', '// y\n');
	put(dir, 'docs/readme.md', '# r\n');
	put(dir, 'src2/b.ts', '// b\n');
	git(dir, ['add', '-A']);
	git(dir, ['commit', '-q', '-m', 'first']);
	return dir;
}

type Result = { code: number; out: string; err: string };
/** フックに、Claude Code が渡す形の JSON を標準入力で渡す */
function run(cwd: string, input: unknown): Result {
	const text = typeof input === 'string' ? input : JSON.stringify(input);
	const r = spawnSync(process.execPath, [hook, ], { cwd, input: text, encoding: 'utf8', timeout: 30000 });
	return { code: r.status ?? -1, out: (r.stdout ?? '').trim(), err: (r.stderr ?? '').trim() };
}
const edit = (cwd: string, rel: string, tool = 'Edit') => ({ tool_name: tool, tool_input: { file_path: path.join(cwd, rel) }, cwd });

/** 知らせが出たか。出たなら、止めずに文脈へ足す形か (permissionDecision が無い) も見る */
function reminded(r: Result): boolean {
	if (r.out === '') { return false; }
	try {
		const o = JSON.parse(r.out) as { hookSpecificOutput?: { hookEventName?: string; additionalContext?: string; permissionDecision?: string } };
		const h = o.hookSpecificOutput;
		return h?.hookEventName === 'PreToolUse' && typeof h.additionalContext === 'string' && h.additionalContext.includes('試験') && h.permissionDecision === undefined;
	} catch { return false; }
}

fs.rmSync(work, { recursive: true, force: true });
fs.mkdirSync(work, { recursive: true });

console.log('\n[知らせる]');
{
	const d = repo('clean');
	const r = run(d, edit(d, 'src/a.ts'));
	check('試験を変えていないで src/ を Edit すると、知らせる (止めない。終了 0)', r.code === 0 && reminded(r), r.out + r.err);
	check('知らせに、共通ルール「テストを先に書く」と、課題の番号を書く', r.out.includes('テストを先に書く') && r.out.includes('i261111-04'), r.out);
	check('Write でも知らせる', reminded(run(d, edit(d, 'src/a.ts', 'Write'))));
	check('src/ の下の深い所 (src/lib/z.ts) でも知らせる', reminded(run(d, edit(d, 'src/lib/z.ts'))));
	const win = run(d, { tool_name: 'Edit', tool_input: { file_path: path.join(d, 'src', 'a.ts').replace(/\//g, '\\') }, cwd: d });
	check('パスの区切りが \\ でも知らせる', reminded(win), win.out + win.err);
	const up = run(d, { tool_name: 'Edit', tool_input: { file_path: path.join(d, 'SRC', 'a.ts') }, cwd: d });
	check('Windows は大小を区別しないので、SRC/a.ts でも知らせる', reminded(up), up.out + up.err);
}
{
	const d = repo('src-only');
	put(d, 'src/a.ts', 'export const a = 2;\n');
	check('src/ だけが変わっていても (試験は変わっていない)、知らせる', reminded(run(d, edit(d, 'src/a.ts'))));
}
{
	const d = repo('docs-only');
	put(d, 'docs/readme.md', '# changed\n');
	check('資料だけが変わっていても、知らせる (試験を変えたことにはならない)', reminded(run(d, edit(d, 'src/a.ts'))));
}

console.log('\n[知らせない]');
{
	const d = repo('tests-changed');
	put(d, 'tools/40_test/x.ts', '// x changed\n');
	check('tools/40_test/ に未 commit の変更があれば、知らせない', run(d, edit(d, 'src/a.ts')).out === '');
}
{
	const d = repo('tests-dir-changed');
	put(d, 'tests/y.ts', '// y changed\n');
	check('tests/ に未 commit の変更があれば、知らせない', run(d, edit(d, 'src/a.ts')).out === '');
}
{
	const d = repo('tests-new');
	put(d, 'tests/new.test.ts', '// new\n');
	check('新しい試験のファイル (未追跡) を足していれば、知らせない', run(d, edit(d, 'src/a.ts')).out === '');
}
{
	const d = repo('tests-staged');
	put(d, 'tools/40_test/x.ts', '// x staged\n');
	git(d, ['add', 'tools/40_test/x.ts']);
	check('試験の変更を git add していても (ステージ済み)、知らせない', run(d, edit(d, 'src/a.ts')).out === '');
}
{
	const d = repo('tests-committed');
	put(d, 'tools/40_test/x.ts', '// x committed\n');
	git(d, ['add', 'tools/40_test/x.ts']);
	git(d, ['commit', '-q', '-m', 'tests']);
	check('試験の変更を commit したあと (差分が無い) は、また知らせる', reminded(run(d, edit(d, 'src/a.ts'))));
}
{
	const d = repo('not-src');
	check('src/ でないファイル (docs/readme.md) の Edit は、知らせない', run(d, edit(d, 'docs/readme.md')).out === '');
	check('試験そのもの (tools/40_test/x.ts) の Edit は、知らせない', run(d, edit(d, 'tools/40_test/x.ts')).out === '');
	check('src2/ のように src で始まるだけの別のフォルダは、知らせない', run(d, edit(d, 'src2/b.ts')).out === '');
	check('置き場の外のファイルの Edit は、知らせない', run(d, { tool_name: 'Edit', tool_input: { file_path: path.join(work, 'elsewhere', 'src', 'q.ts') }, cwd: d }).out === '');
	check('Edit ・ Write 以外の道具 (Bash) は、知らせない', run(d, { tool_name: 'Bash', tool_input: { command: 'ls src/a.ts' }, cwd: d }).out === '');
	check('Read は、知らせない', run(d, edit(d, 'src/a.ts', 'Read')).out === '');
}

console.log('\n[壊れた入力・git の外では黙って通す]');
{
	const d = repo('broken');
	for (const bad of ['', 'これは JSON ではない', '{}', '{"tool_name":"Edit"}', '{"tool_name":"Edit","tool_input":{}}']) {
		const r = run(d, bad);
		check(`入力が ${JSON.stringify(bad)} でも、終了 0 で何も出さない (フックの不具合で編集を止めない)`, r.code === 0 && r.out === '', r.out + r.err);
	}
	const outside = path.join(work, 'no-git');
	fs.mkdirSync(path.join(outside, 'src'), { recursive: true });
	const r = run(outside, edit(outside, 'src/a.ts'));
	check('git の外では、終了 0 で何も出さない', r.code === 0 && r.out === '', r.out + r.err);
}

console.log('\n[登録 (.claude/settings.json)]');
{
	const file = path.join(root, '.claude', 'settings.json');
	let json: any = null;
	try { json = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { /* 下で落とす */ }
	const groups: any[] = json?.hooks?.PreToolUse ?? [];
	const mine = groups.find((g) => String(g?.matcher ?? '').split('|').includes('Edit') && JSON.stringify(g).includes('remind-test-first'));
	check('.claude/settings.json の PreToolUse に、Edit ・ Write でこのフックを動かす登録がある', mine !== undefined && String(mine.matcher).split('|').includes('Write'), JSON.stringify(groups));
	check('登録は $CLAUDE_PROJECT_DIR から相対で指す (フルパスを書かない)', mine !== undefined && JSON.stringify(mine).includes('$CLAUDE_PROJECT_DIR') && !/[A-Za-z]:[\\/]/.test(JSON.stringify(mine)), JSON.stringify(mine));
	check('登録は、止める形 (permissionDecision) を持たず、時間の上限 (timeout) がある', mine !== undefined && typeof mine.hooks?.[0]?.timeout === 'number', JSON.stringify(mine));
}

fs.rmSync(work, { recursive: true, force: true });
console.log(`\n=== remind-test-first: ${pass} 件成功 ・ ${fail} 件失敗 ===`);
process.exit(fail === 0 ? 0 : 1);
