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
		issue archive <group> ・ issue unarchive <group> [--root <dir>] [--json]
	いまはフェーズ 2 まで (check ・ init ・ new ・ show ・ list ・ search ・ set ・ todo ・ archive ・ unarchive)。view は、まだ無い。
*/
import path from 'node:path';
import { Folders, checkProject, findProjectRoot, hasItems, type Finding, type Folder } from './check.ts';
import {
	Failure, StateOf, UsageError, archiveGroup, editTodo, initProject, listIssues, listTodos, newIssue, searchIssues, setState, showIssue, unarchiveGroup,
} from './ops.ts';

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
	'  issue archive <group> [--root <dir>] [--json]                  グループの全件が済なら、archived/ へ動かす',
	'  issue unarchive <group> [--root <dir>] [--json]                archived/ のグループを、done/ へ戻す',
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
		return ExitOk;
	}
	const n = /^\d+$/.test(value) ? Number(value) : NaN;
	if (Number.isNaN(n)) throw new UsageError(`${action} には、やることの番号 (整数) を渡す: ${value}`);
	const state = action === '--done' ? '済' : action === '--doing' ? '着手' : '未';
	const r = editTodo(root, id, { kind: 'set', n, state });
	if (json) console.log(JSON.stringify({ id, todos: r.todos, changed: r.changed }));
	else console.log(`[OK] ${id} のやること ${r.changed.n} を ${r.changed.state} にした: ${r.changed.text}`);
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
	archive: (rest) => runGroupMove(rest, 'archive'),
	unarchive: (rest) => runGroupMove(rest, 'unarchive'),
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
