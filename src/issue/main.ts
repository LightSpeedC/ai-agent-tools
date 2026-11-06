/*
	issue: 課題管理ツール。計画は p261103-01、仕様は notes/50_spec/課題ファイルの形と検査.html。

		issue check [--root <dir>] [--json]                    課題ファイルと project-id.txt を検査する (読み取り専用)
		issue init [--root <dir>] [--new-id]                   project-id.txt を作る (あれば変えない。--new-id で振り直す)
		issue new --title <題> --group <グループ> [--slug <件名>] [--from <報告元>] [--refs <番号,…>]
		          [--body <本文>] [--root <dir>] [--json]       todo/ に課題を立てる
		issue show <id> [--root <dir>] [--json]                課題を 1 件読む
		issue list [--state 未,着手,済,archived | --all] [--group <g>] [--root <dir>] [--json]
		                                                       課題の一覧 (既定は未・着手)

	状態は、置いてあるフォルダ (todo / doing / done / archived) で持つ。
	終了コード（2 は使わない。Stop フックが 2 を「続ける」と読むため）
		0 成功 (check は、エラーが無い。警告があってもよい)
		1 失敗 (check のエラー ・ 課題が見つからない ・ 重複 ・ 番号を使い切った)
		5 引数の誤り ・ プロジェクトが見つからない

	出力に絶対パスを出さない (ファイルはプロジェクトからの相対パス)。
	更新の操作 (new ・ set ・ todo ・ archive ・ unarchive) は、作業ツリーのファイルを変えるだけで、commit しない。
		issue set <id> --state 未|着手|済 [--root <dir>] [--json]   状態を変える (隣のフォルダへ動かす。追跡中なら git mv)
		issue todo <id> [--add <文> | --done <n> | --doing <n> | --undone <n>] [--root <dir>] [--json]
		issue search <語> [--state … | --all] [--group <g>] [--root <dir>] [--json]
		issue confirm <id> [--undo] [--root <dir>] [--json]         報告元の確認 (confirmed) を直す (その行だけ。フォルダは動かさない)
		issue archive <group> ・ issue unarchive <group> [--root <dir>] [--json]
		issue render [<id>…] [--state … | --all] [--group <g>] [--out <ファイル>] [--standalone] [--root <dir>] [--json]
		                                                            HTML を作る (開かない。既定は _issues.html。渡す用は --standalone --out)
		issue view [--state … | --all] [--group <g>] [--root <dir>] [--json]
		                                                            _issues.html を作り直して、既定のアプリで開く (開けなければパスを出して終了コード 0)
	更新の操作 (new ・ set ・ todo ・ confirm ・ archive ・ unarchive) の最後に、_issues.html を作り直す (失敗しても警告だけ)。
		issue migrate [--dry-run] [--root <dir>] [--json]
		                                                            旧 issues.html (と issues-archive.html) の課題を読み、移す計画を出す。いまは読み取りだけ
	いまはフェーズ 3b まで + migrate の読み取り (check ・ init ・ new ・ show ・ list ・ search ・ set ・ todo ・ confirm ・ archive ・ unarchive ・ render ・ view ・ migrate)。
*/
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { Folders, checkProject, findProjectRoot, hasItems, type Finding, type Folder } from './check.ts';
import { renderHtml, writeIfChanged } from './render.ts';
import {
	Failure, StateOf, UsageError, archiveGroup, editTodo, initProject, listIssues, listTodos, newIssue, searchIssues, setConfirmed, setState, showIssue, unarchiveGroup,
} from './ops.ts';
import { planMigration } from './migrate.ts';

const ExitOk = 0;
const ExitFailed = 1;
const ExitBadArgs = 5;

const Usage = [
	'使い方:',
	'  issue check [--root <dir>] [--json]                   課題ファイルと project-id.txt を検査する',
	'  issue init [--root <dir>] [--new-id]                  project-id.txt を作る',
	'  issue new --title <題> --group <グループ> [--slug <件名>] [--from <報告元>] [--refs <番号,…>] [--body <本文>] [--root <dir>] [--json]',
	'  issue show <id> [--root <dir>] [--json]               課題を 1 件読む',
	'  issue list [--state 未,着手,済,archived | --all] [--group <g>] [--root <dir>] [--json]',
	'  issue search <語> [--state 未,着手,済,archived | --all] [--group <g>] [--root <dir>] [--json]',
	'  issue set <id> --state 未|着手|済 [--root <dir>] [--json]       状態を変える (隣のフォルダへ動かす)',
	'  issue todo <id> [--add <文> | --done <n> | --doing <n> | --undone <n>] [--root <dir>] [--json]',
	'  issue confirm <id> [--undo] [--root <dir>] [--json]            報告元の確認 (confirmed) を true にする (--undo で false)',
	'  issue render [<id>…] [--state … | --all] [--group <g>] [--out <ファイル>] [--standalone] [--root <dir>] [--json]',
	'                                                                 HTML を作る (開かない)。既定は notes/40_issues/_issues.html',
	'  issue view [--state … | --all] [--group <g>] [--root <dir>] [--json]',
	'                                                                 _issues.html を作り直して、既定のアプリで開く',
	'  issue archive <group> [--root <dir>] [--json]                  グループの全件が済なら、archived/ へ動かす',
	'  issue unarchive <group> [--root <dir>] [--json]                archived/ のグループを、done/ へ戻す',
	'  issue migrate [--dry-run] [--root <dir>] [--json]              旧 issues.html の課題を読み、移す計画を出す (いまは読み取りだけ。何も書かない)',
].join('\n');

// ---- 引数 ----

type Spec = { valued: string[]; flags: string[]; positionals: number };
type Options = { values: Map<string, string>; flags: Set<string>; positionals: string[] };

function parseOptions(rest: string[], spec: Spec): Options {
	const values = new Map<string, string>();
	const flags = new Set<string>();
	const positionals: string[] = [];
	for (let i = 0; i < rest.length; i++) {
		const a = rest[i];
		if (spec.flags.includes(a)) {
			flags.add(a);
		} else if (spec.valued.includes(a)) {
			const value = rest[i + 1];
			if (value === undefined) throw new UsageError(`${a} に値を渡してください`);
			values.set(a, value);
			i++;
		} else if (!a.startsWith('--') && positionals.length < spec.positionals) {
			positionals.push(a);
		} else {
			throw new UsageError('知らない引数: ' + a);
		}
	}
	return { values, flags, positionals };
}

/** 既にある items/ を持つプロジェクトの root。--root があればそれ、無ければ作業フォルダから親をたどる */
function existingRoot(o: Options): string {
	const rootArg = o.values.get('--root');
	if (rootArg !== undefined) {
		const resolved = path.resolve(rootArg);
		if (!hasItems(resolved)) throw new UsageError('--root で指したフォルダに、notes/40_issues/items/ が無い');
		return resolved;
	}
	const found = findProjectRoot(process.cwd());
	if (found === null) throw new UsageError('作業フォルダから親をたどっても、notes/40_issues/items/ を持つプロジェクトが見つからない (--root で指せる。始めるなら issue init)');
	return found;
}

// ---- check ----

function label(f: Finding): string {
	return (f.level === 'error' ? '[NG] ' : '[警告] ') + f.file + ' [' + f.code + '] ' + f.message;
}

function runCheck(rest: string[]): number {
	const o = parseOptions(rest, { valued: ['--root'], flags: ['--json'], positionals: 0 });
	const root = existingRoot(o);
	const result = checkProject(root);
	const errors = result.findings.filter((f) => f.level === 'error').length;
	const warnings = result.findings.length - errors;

	if (o.flags.has('--json')) {
		console.log(JSON.stringify({
			ok: errors === 0,
			errors,
			warnings,
			issues: result.issues,
			todo: result.todo,
			doing: result.doing,
			done: result.done,
			archived: result.archived,
			findings: result.findings,
		}));
	} else {
		for (const f of result.findings) console.log(label(f));
		const count = `課題 ${result.issues} 件 (未 ${result.todo} 件 ・ 着手 ${result.doing} 件 ・ 済 ${result.done} 件 ・ archived ${result.archived} 件)`;
		if (errors > 0) console.log(`[NG] ${count}。エラー ${errors} 件 ・ 警告 ${warnings} 件`);
		else if (warnings > 0) console.log(`[OK] ${count}。エラー 0 件 ・ 警告 ${warnings} 件`);
		else console.log(`[OK] ${count}。問題なし`);
	}
	return errors > 0 ? ExitFailed : ExitOk;
}

// ---- init ----

function runInit(rest: string[]): number {
	const o = parseOptions(rest, { valued: ['--root'], flags: ['--new-id'], positionals: 0 });
	const rootArg = o.values.get('--root');
	const root = rootArg !== undefined ? path.resolve(rootArg) : (findProjectRoot(process.cwd()) ?? process.cwd());
	const r = initProject(root, o.flags.has('--new-id'));
	if (r.result === 'created') console.log(`[OK] ${r.rel} を作った`);
	else if (r.result === 'replaced') console.log(`[OK] ${r.rel} の project_id を振り直した`);
	else console.log(`[OK] ${r.rel} は既にある (変えない。振り直すなら --new-id)`);
	return ExitOk;
}

// ---- new ----

function runNew(rest: string[]): number {
	const o = parseOptions(rest, { valued: ['--root', '--title', '--group', '--slug', '--from', '--refs', '--body'], flags: ['--json'], positionals: 0 });
	const title = o.values.get('--title');
	const group = o.values.get('--group');
	if (title === undefined) throw new UsageError('--title (題) が要る');
	if (group === undefined) throw new UsageError('--group (グループ) が要る');
	const rootArg = o.values.get('--root');
	let root: string;
	if (rootArg !== undefined) {
		root = path.resolve(rootArg);
	} else {
		const found = findProjectRoot(process.cwd());
		if (found === null) throw new UsageError('作業フォルダから親をたどっても、notes/40_issues/items/ を持つプロジェクトが見つからない (先に issue init を実行するか、--root で指す)');
		root = found;
	}
	const r = newIssue(root, { title, group, slug: o.values.get('--slug'), from: o.values.get('--from'), refs: o.values.get('--refs'), body: o.values.get('--body') });
	if (o.flags.has('--json')) console.log(JSON.stringify({ id: r.id, file: r.rel }));
	else {
		console.log(`[OK] ${r.rel} を作った (${r.id})`);
		if (r.createdProjectId) console.log('     project-id.txt も作った');
	}
	autoRender(root);
	return ExitOk;
}

// ---- show ----

function runShow(rest: string[]): number {
	const o = parseOptions(rest, { valued: ['--root'], flags: ['--json'], positionals: 1 });
	const id = o.positionals[0];
	if (id === undefined) throw new UsageError('id が要る (issue show <id>)');
	if (!/^i\d{6}-[0-9a-kLm-z]{2}$/.test(id)) throw new UsageError(`id の形が違う: ${id} (例: i261103-01)`);
	const root = existingRoot(o);
	const v = showIssue(root, id);
	if (o.flags.has('--json')) {
		console.log(JSON.stringify({ id: v.id, state: v.state, folder: v.folder, file: v.file, meta: v.meta, body: v.body, todos: v.todos }));
	} else {
		console.log(`${v.id}  ${v.state} (${v.folder}/)  ${v.file}`);
		console.log(v.text.replace(/\n+$/, ''));
	}
	return ExitOk;
}

// ---- list ・ search ----

const StateToFolder: Record<string, Folder> = { 未: 'todo', 着手: 'doing', 済: 'done', archived: 'archived' };

/** --state / --all から、読むフォルダを決める。既定は未・着手 */
function foldersFrom(o: Options): Folder[] {
	const stateArg = o.values.get('--state');
	if (stateArg !== undefined && o.flags.has('--all')) throw new UsageError('--state と --all は同時に使えない');
	if (o.flags.has('--all')) return [...Folders];
	if (stateArg === undefined) return ['todo', 'doing'];
	return stateArg.split(',').map((s) => s.trim()).map((s) => {
		const folder = StateToFolder[s];
		if (folder === undefined) throw new UsageError(`--state に使えない語: ${s} (未 ・ 着手 ・ 済 ・ archived をカンマで区切る)`);
		return folder;
	});
}

function stateLabel(folder: Folder): string {
	return folder === 'archived' ? '済 (archived)' : StateOf[folder];
}

function runSearch(rest: string[]): number {
	const o = parseOptions(rest, { valued: ['--root', '--state', '--group'], flags: ['--json', '--all'], positionals: 1 });
	const term = o.positionals[0];
	if (term === undefined || term === '') throw new UsageError('探す語が要る (issue search <語>)');
	const folders = foldersFrom(o);
	const root = existingRoot(o);
	const hits = searchIssues(root, term, folders, o.values.get('--group') ?? null, (m) => console.error(m));
	if (o.flags.has('--json')) {
		console.log(JSON.stringify(hits));
	} else {
		for (const h of hits) {
			console.log(`${h.id}  ${stateLabel(h.folder)}  ${h.group}  ${h.title}`);
			for (const m of h.matches.slice(0, 3)) console.log(`    L${m.line}: ${m.text}`);
		}
		console.log(`${hits.length} 件`);
	}
	return ExitOk;
}

// ---- set ・ todo ・ archive ・ unarchive ----

const IdPattern = /^i\d{6}-[0-9a-kLm-z]{2}$/;

function requireId(o: Options, usage: string): string {
	const id = o.positionals[0];
	if (id === undefined) throw new UsageError(`id が要る (${usage})`);
	if (!IdPattern.test(id)) throw new UsageError(`id の形が違う: ${id} (例: i261103-01)`);
	return id;
}

function runSet(rest: string[]): number {
	const o = parseOptions(rest, { valued: ['--root', '--state'], flags: ['--json'], positionals: 1 });
	const id = requireId(o, 'issue set <id> --state 未|着手|済');
	const state = o.values.get('--state');
	if (state === undefined) throw new UsageError('--state (未 ・ 着手 ・ 済) が要る');
	const root = existingRoot(o);
	const r = setState(root, id, state);
	if (o.flags.has('--json')) {
		console.log(JSON.stringify({ id: r.id, state: r.state, folder: r.folder, from: r.from, file: r.file }));
	} else if (!r.moved) {
		console.log(`[OK] ${id} は既に ${r.state} (${r.folder}/)。動かさない`);
	} else {
		console.log(`[OK] ${id} を ${r.from.state} から ${r.state} へ動かした (${r.from.folder}/ → ${r.folder}/)`);
	}
	autoRender(root);
	return ExitOk;
}

function runTodo(rest: string[]): number {
	const o = parseOptions(rest, { valued: ['--root', '--add', '--done', '--doing', '--undone'], flags: ['--json'], positionals: 1 });
	const id = requireId(o, 'issue todo <id> [--add <文> | --done <n> | --doing <n> | --undone <n>]');
	const actions = ['--add', '--done', '--doing', '--undone'].filter((k) => o.values.has(k));
	if (actions.length > 1) throw new UsageError(`操作は 1 つだけ: ${actions.join(' ・ ')}`);
	const root = existingRoot(o);
	const json = o.flags.has('--json');
	if (actions.length === 0) {
		const todos = listTodos(root, id);
		if (json) console.log(JSON.stringify({ id, todos }));
		else if (todos.length === 0) console.log('やることは 0 件');
		else for (const t of todos) console.log(`${t.n} [${t.state}] ${t.text}`);
		return ExitOk;
	}
	const action = actions[0];
	const value = o.values.get(action) ?? '';
	if (action === '--add') {
		const r = editTodo(root, id, { kind: 'add', text: value });
		if (json) console.log(JSON.stringify({ id, todos: r.todos, changed: r.changed }));
		else console.log(`[OK] ${id} にやることを足した (${r.changed.n}): ${r.changed.text}`);
		autoRender(root);
		return ExitOk;
	}
	const n = /^\d+$/.test(value) ? Number(value) : NaN;
	if (Number.isNaN(n)) throw new UsageError(`${action} には、やることの番号 (整数) を渡す: ${value}`);
	const state = action === '--done' ? '済' : action === '--doing' ? '着手' : '未';
	const r = editTodo(root, id, { kind: 'set', n, state });
	if (json) console.log(JSON.stringify({ id, todos: r.todos, changed: r.changed }));
	else console.log(`[OK] ${id} のやること ${r.changed.n} を ${r.changed.state} にした: ${r.changed.text}`);
	autoRender(root);
	return ExitOk;
}

// ---- render ・ view ・ 自動の作り直し ----

/** _issues.html の既定の範囲は、未・着手・済 (archived/ は --all のとき) */
const DefaultRenderFolders: Folder[] = ['todo', 'doing', 'done'];

function defaultOutFile(root: string): string {
	return path.join(root, 'notes', '40_issues', '_issues.html');
}

/** 保管 (archived/) の全件を置く HTML (159-A) */
function archiveOutFile(root: string): string {
	return path.join(root, 'notes', '40_issues', '_issues-archive.html');
}

/** _issues.html から見た、互いにリンクする相手 */
function peerOfMain(root: string): { file: string; label: string } {
	return { file: archiveOutFile(root), label: '保管の課題' };
}

function relShown(root: string, file: string): string {
	const rel = path.relative(root, file);
	return rel.startsWith('..') || path.isAbsolute(rel) ? path.basename(file) : rel.split(path.sep).join('/');
}

/**
 * 更新の操作の最後に、_issues.html を既定の範囲で作り直す (131-A)。
 * 失敗しても、主な操作は成功のまま、標準エラーに警告を出すだけ。標準出力は増やさない
 */
function autoRender(root: string, withArchive: boolean = false): void {
	try {
		// 保管の HTML を先に作る。_issues.html からのリンクは、相手が在るときだけ張るため
		if (withArchive) {
			const archiveFile = archiveOutFile(root);
			const a = renderHtml({
				root, outFile: archiveFile, standalone: false, folders: ['archived'], group: null, ids: [], warn: () => {},
				peer: { file: defaultOutFile(root), label: '未・着手・済の課題', always: true },
			});
			writeIfChanged(archiveFile, a.html);
		}
		const outFile = defaultOutFile(root);
		const r = renderHtml({ root, outFile, standalone: false, folders: DefaultRenderFolders, group: null, ids: [], warn: () => {}, peer: peerOfMain(root) });
		writeIfChanged(outFile, r.html);
	} catch (e) {
		console.error('[警告] _issues.html を作り直せなかった (主な操作は済んでいる): ' + (e instanceof Error ? e.message : String(e)));
	}
}

/** 既定のアプリで開く。開けたら true。試験では ISSUE_TEST_OPEN_LOG (開くパスを追記) ・ ISSUE_TEST_OPEN_FAIL=1 (開けない扱い) で差し替える */
function openWithDefaultApp(file: string): boolean {
	const logFile = process.env.ISSUE_TEST_OPEN_LOG;
	if (process.env.ISSUE_TEST_OPEN_FAIL === '1') return false;
	if (logFile !== undefined && logFile !== '') {
		fs.appendFileSync(logFile, file + '\n');
		return true;
	}
	let r;
	if (process.platform === 'win32') {
		r = spawnSync('cmd.exe', ['/c', 'start', '', file], { timeout: 15000, windowsHide: true, stdio: 'ignore' });
	} else if (process.platform === 'darwin') {
		r = spawnSync('open', [file], { timeout: 15000, stdio: 'ignore' });
	} else {
		// 画面の無い環境 (クラウドの Linux 等) では、開けない
		if (!process.env.DISPLAY && !process.env.WAYLAND_DISPLAY) return false;
		r = spawnSync('xdg-open', [file], { timeout: 15000, stdio: 'ignore' });
	}
	return r.error === undefined && r.status === 0;
}

function runView(rest: string[]): number {
	const o = parseOptions(rest, { valued: ['--root', '--state', '--group'], flags: ['--json', '--all'], positionals: 0 });
	const folders: Folder[] = o.values.has('--state') || o.flags.has('--all') ? foldersFrom(o) : DefaultRenderFolders;
	const root = existingRoot(o);
	const outFile = defaultOutFile(root);
	let warnings = 0;
	const r = renderHtml({
		root, outFile, standalone: false, folders, group: o.values.get('--group') ?? null, ids: [],
		warn: (m) => { warnings++; console.error(m); }, peer: peerOfMain(root),
	});
	const written = writeIfChanged(outFile, r.html);
	const shown = relShown(root, outFile);
	const opened = openWithDefaultApp(outFile);
	if (o.flags.has('--json')) {
		console.log(JSON.stringify({ file: shown, issues: r.count, written, warnings, opened }));
	} else if (opened) {
		console.log(`[OK] ${shown} を${written === 'unchanged' ? '(変更なし)' : written === 'created' ? '作って' : '作り直して'}開いた (課題 ${r.count} 件)`);
	} else {
		console.log(`[OK] ${shown} を${written === 'unchanged' ? '(変更なし)' : written === 'created' ? '作った' : '作り直した'} (課題 ${r.count} 件)。開けなかったので、自分で開く: ${shown}`);
	}
	return ExitOk;
}

function runRender(rest: string[]): number {
	const o = parseOptions(rest, { valued: ['--root', '--out', '--state', '--group'], flags: ['--json', '--all', '--standalone'], positionals: 1000 });
	for (const id of o.positionals) {
		if (!IdPattern.test(id)) throw new UsageError(`id の形が違う: ${id} (例: i261103-01)`);
	}
	const standalone = o.flags.has('--standalone');
	const outArg = o.values.get('--out');
	if (standalone && outArg === undefined) throw new UsageError('--standalone は --out と一緒に使う (_issues.html は、ローカルで見る版のため。渡す用は tmp/ などへ出す)');
	const folders: Folder[] = o.values.has('--state') || o.flags.has('--all') ? foldersFrom(o) : DefaultRenderFolders;
	const root = existingRoot(o);
	const outFile = outArg !== undefined ? path.resolve(outArg) : defaultOutFile(root);
	let warnings = 0;
	const r = renderHtml({
		root, outFile, standalone, folders, group: o.values.get('--group') ?? null, ids: o.positionals,
		warn: (m) => { warnings++; console.error(m); },
		peer: outArg === undefined ? peerOfMain(root) : undefined,
	});
	const written = writeIfChanged(outFile, r.html);
	const relToRoot = path.relative(root, outFile);
	const shown = relToRoot.startsWith('..') || path.isAbsolute(relToRoot) ? path.basename(outFile) : relToRoot.split(path.sep).join('/');
	if (o.flags.has('--json')) {
		console.log(JSON.stringify({ file: shown, issues: r.count, written, warnings }));
	} else if (written === 'unchanged') {
		console.log(`[OK] ${shown} は変更なし (課題 ${r.count} 件)`);
	} else {
		console.log(`[OK] ${shown} を${written === 'created' ? '作った' : '作り直した'} (課題 ${r.count} 件)`);
	}
	return ExitOk;
}

function runConfirm(rest: string[]): number {
	const o = parseOptions(rest, { valued: ['--root'], flags: ['--json', '--undo'], positionals: 1 });
	const id = requireId(o, 'issue confirm <id> [--undo]');
	const root = existingRoot(o);
	const value = !o.flags.has('--undo');
	const r = setConfirmed(root, id, value);
	if (o.flags.has('--json')) {
		console.log(JSON.stringify({ id: r.id, confirmed: r.confirmed, from: r.from, changed: r.changed, file: r.file }));
	} else if (!r.changed) {
		console.log(`[OK] ${id} は既に confirmed: ${r.confirmed}。変えない (報告元: ${r.from})`);
	} else if (value) {
		console.log(`[OK] ${id} の報告元の確認 (confirmed) を true にした (報告元: ${r.from})`);
	} else {
		console.log(`[OK] ${id} の報告元の確認 (confirmed) を false に戻した (報告元: ${r.from})`);
	}
	autoRender(root);
	return ExitOk;
}

function runGroupMove(rest: string[], kind: 'archive' | 'unarchive'): number {
	const o = parseOptions(rest, { valued: ['--root'], flags: ['--json'], positionals: 1 });
	const group = o.positionals[0];
	if (group === undefined || group === '') throw new UsageError(`グループが要る (issue ${kind} <group>)`);
	const root = existingRoot(o);
	const r = kind === 'archive' ? archiveGroup(root, group) : unarchiveGroup(root, group);
	if (o.flags.has('--json')) {
		console.log(JSON.stringify({ group: r.group, moved: r.moved, count: r.moved.length }));
	} else if (r.moved.length === 0) {
		console.log(`[OK] グループ ${group} は既に全件が archived/ にある。動かさない`);
	} else if (kind === 'archive') {
		console.log(`[OK] グループ ${group} の ${r.moved.length} 件を archived/ へ動かした: ${r.moved.join(' ・ ')}`);
	} else {
		console.log(`[OK] グループ ${group} の ${r.moved.length} 件を done/ へ戻した: ${r.moved.join(' ・ ')}`);
	}
	autoRender(root, true);
	return ExitOk;
}

// ---- list ----

function runList(rest: string[]): number {
	const o = parseOptions(rest, { valued: ['--root', '--state', '--group'], flags: ['--json', '--all'], positionals: 0 });
	const folders = foldersFrom(o);
	const root = existingRoot(o);
	const items = listIssues(root, folders, o.values.get('--group') ?? null, (m) => console.error(m));
	if (o.flags.has('--json')) {
		console.log(JSON.stringify(items));
	} else {
		for (const i of items) console.log(`${i.id}  ${stateLabel(i.folder)}  ${i.group}  ${i.title}`);
		console.log(`${items.length} 件`);
	}
	return ExitOk;
}

// ---- migrate ----

function runMigrate(rest: string[]): number {
	const o = parseOptions(rest, { valued: ['--root'], flags: ['--json', '--dry-run'], positionals: 0 });
	const root = existingRoot(o);
	const plan = planMigration(root);
	const inFolder = (folder: Folder): number => plan.move.filter((m) => m.folder === folder).length;
	if (o.flags.has('--json')) {
		console.log(JSON.stringify({
			read: plan.read,
			sources: plan.sources,
			move: plan.move.map((m) => ({ id: m.id, state: m.state, folder: m.folder, group: m.group, title: m.title, source: m.source })),
			exists: plan.exists,
			unreadable: plan.unreadable,
		}));
	} else {
		console.log(`[dry-run] 旧 HTML から課題 ${plan.read} 件を読んだ`);
		console.log('  ' + plan.sources.map((s) => `${s.file} ${s.count} 件`).join(' ・ '));
		console.log(`  移す: ${plan.move.length} 件 (済 ${inFolder('done')} ・ 着手 ${inFolder('doing')} ・ 未 ${inFolder('todo')} ・ 保管 ${inFolder('archived')})`);
		console.log(`  すでに items/ にある (移さない): ${plan.exists.length} 件`);
		console.log(`  読めなかった: ${plan.unreadable.length} 件`);
		for (const p of plan.unreadable) console.log(`    - ${p.where}: ${p.message}`);
	}
	return plan.unreadable.length > 0 ? ExitFailed : ExitOk;
}

// ---- 入口 ----

const commands: Record<string, (rest: string[]) => number> = {
	check: runCheck,
	init: runInit,
	new: runNew,
	show: runShow,
	list: runList,
	search: runSearch,
	set: runSet,
	todo: runTodo,
	confirm: runConfirm,
	render: runRender,
	view: runView,
	archive: (rest) => runGroupMove(rest, 'archive'),
	unarchive: (rest) => runGroupMove(rest, 'unarchive'),
	migrate: runMigrate,
};

function mainEntry(): number {
	const args = process.argv.slice(2);
	if (args.length === 0) throw new UsageError('サブコマンドを指定してください');
	if (args[0] === '--help' || args[0] === '-h') {
		console.log(Usage);
		return ExitOk;
	}
	const command = commands[args[0]];
	if (command === undefined) throw new UsageError('知らないサブコマンド: ' + args[0]);
	return command(args.slice(1));
}

try {
	process.exit(mainEntry());
} catch (e) {
	if (e instanceof UsageError) {
		console.error('[NG] ' + e.message);
		console.error(Usage);
		process.exit(ExitBadArgs);
	}
	if (e instanceof Failure) {
		console.error('[NG] ' + e.message);
		process.exit(ExitFailed);
	}
	throw e;
}
