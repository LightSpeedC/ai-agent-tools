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
	いまはフェーズ 2 の前半 (check ・ init ・ new ・ show ・ list)。set ・ todo ・ search ・ archive は、まだ無い。
*/
import path from 'node:path';
import { Folders, checkProject, findProjectRoot, hasItems, type Finding, type Folder } from './check.ts';
import { Failure, StateOf, UsageError, initProject, listIssues, newIssue, showIssue } from './ops.ts';

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

// ---- list ----

const StateToFolder: Record<string, Folder> = { 未: 'todo', 着手: 'doing', 済: 'done', archived: 'archived' };

function runList(rest: string[]): number {
	const o = parseOptions(rest, { valued: ['--root', '--state', '--group'], flags: ['--json', '--all'], positionals: 0 });
	let folders: Folder[] = ['todo', 'doing'];
	const stateArg = o.values.get('--state');
	if (stateArg !== undefined && o.flags.has('--all')) throw new UsageError('--state と --all は同時に使えない');
	if (o.flags.has('--all')) {
		folders = [...Folders];
	} else if (stateArg !== undefined) {
		folders = stateArg.split(',').map((s) => s.trim()).map((s) => {
			const folder = StateToFolder[s];
			if (folder === undefined) throw new UsageError(`--state に使えない語: ${s} (未 ・ 着手 ・ 済 ・ archived をカンマで区切る)`);
			return folder;
		});
	}
	const root = existingRoot(o);
	const items = listIssues(root, folders, o.values.get('--group') ?? null, (m) => console.error(m));
	if (o.flags.has('--json')) {
		console.log(JSON.stringify(items));
	} else {
		for (const i of items) console.log(`${i.id}  ${i.folder === 'archived' ? '済 (archived)' : StateOf[i.folder]}  ${i.group}  ${i.title}`);
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
