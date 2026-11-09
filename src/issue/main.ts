/*
	issue: 課題管理ツール。計画は p261103-01、仕様は notes/50_spec/課題ファイルの形と検査.html。

		issue check [--root <dir>] [--json]                    課題ファイルと project-uuid.txt を検査する (読み取り専用)
		issue init [--root <dir>] [--new-id]                   project-uuid.txt を作る (あれば変えない。古い project-id.txt は移す。--new-id で振り直す)
		issue choice next [--root <dir>] [--json]              選択肢の通し番号を 1 つ予約して出す (計画 p261109-01)
	番号の予約は ~/.ai-agent-tools/numbers/<キー>/ に置き、worktree ・ 別の clone の間でも重ならない (計画 p261109-01)。
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
		issue search <語> [--regex] [--state … | --all] [--group <g>] [--root <dir>] [--json]
		issue confirm <id> [--undo] [--root <dir>] [--json]         報告元の確認 (confirmed) を直す (その行だけ。フォルダは動かさない)
		issue archive --done-before <yyyy-mm-dd> [--dry-run] [--root <dir>] [--json]
		issue archive <group|番号> ・ issue unarchive <group> [--root <dir>] [--json]
		issue render [<id>…] [--state … | --all] [--group <g>] [--out <ファイル>] [--standalone] [--root <dir>] [--json]
		                                                            HTML を作る (開かない。既定は _issues.html。渡す用は --standalone --out)
		issue view [--state … | --all] [--group <g>] [--root <dir>] [--json]
		                                                            _issues.html を作り直して、既定のアプリで開く (開けなければパスを出して終了コード 0)
	更新の操作 (new ・ set ・ todo ・ confirm ・ archive ・ unarchive) の最後に、_issues.html を作り直す (失敗しても警告だけ)。
		issue migrate [--dry-run | --apply] [--state-override <番号=状態,...>] [--root <dir>] [--json]
		                                                            旧 issues.html (と issues-archive.html) の課題を読み、移す計画を出す。いまは読み取りだけ
	いまはフェーズ 3b まで + migrate (check ・ init ・ new ・ show ・ list ・ search ・ set ・ todo ・ confirm ・ archive ・ unarchive ・ render ・ view ・ migrate)。
*/
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { Folders, checkProject, findProjectRoot, hasItems, type Finding, type Folder } from './check.ts';
import { renderHtml, writeIfChanged } from './render.ts';
import {
	Failure, StateOf, UsageError, archiveDoneBefore, archiveGroup, archiveOne, editTodo, initProject, listIssues, listTodos, newIssue, searchIssues, setConfirmed, setState, showIssue, unarchiveGroup,
} from './ops.ts';
import { WrittenListRel, applyMigration, applyOverrides, planMigration, removeWritten, verifyWritten } from './migrate.ts';
import { listDecisions, newDecision, searchDecisions, showDecision } from './decide.ts';
import { DecideWrittenListRel, applyDecideMigration, planDecideMigration, recheckDecisions, removeDecideWritten, verifyDecideWritten } from './decide-migrate.ts';
import { DecisionIdPattern, ParentPattern } from './check.ts';
import { todayJst } from './ops.ts';
import { nextChoice } from './numbers.ts';

const ExitOk = 0;
const ExitFailed = 1;
const ExitBadArgs = 5;

const Usage = [
	'使い方:',
	'  issue check [--root <dir>] [--json]                   課題ファイルと project-uuid.txt を検査する',
	'  issue init [--root <dir>] [--new-id]                  project-uuid.txt を作る (古い project-id.txt があれば移す)',
	'  issue new --title <題> --group <グループ> [--slug <件名>] [--from <報告元>] [--refs <番号,…>] [--body <本文>] [--root <dir>] [--json]',
	'  issue show <id> [--root <dir>] [--json]               課題を 1 件読む',
	'  issue list [--state 未,着手,済,archived | --all] [--group <g>] [--root <dir>] [--json]',
	'  issue search <語> [--regex] [--state 未,着手,済,archived | --all] [--group <g>] [--root <dir>] [--json]',
	'  issue set <id> --state 未|着手|済 [--root <dir>] [--json]       状態を変える (隣のフォルダへ動かす)',
	'  issue todo <id> [--add <文> | --done <n> | --doing <n> | --undone <n>] [--root <dir>] [--json]',
	'  issue confirm <id> [--undo] [--root <dir>] [--json]            報告元の確認 (confirmed) を true にする (--undo で false)',
	'  issue render [<id>…] [--state … | --all] [--group <g>] [--out <ファイル>] [--standalone] [--root <dir>] [--json]',
	'                                                                 HTML を作る (開かない)。既定は notes/40_issues/_issues.html',
	'  issue view [--state … | --all] [--group <g>] [--root <dir>] [--json]',
	'                                                                 _issues.html を作り直して、既定のアプリで開く',
	'  issue archive <group|番号> [--root <dir>] [--json]             グループの全件が済なら、archived/ へ動かす。番号なら済の課題 1 件だけを動かす',
	'  issue archive --done-before <yyyy-mm-dd> [--dry-run] [--root <dir>] [--json]   その日より前に立てた済の課題を、グループを問わずまとめて動かす',
	'  issue unarchive <group> [--root <dir>] [--json]                archived/ のグループを、done/ へ戻す',
	'  issue decide new --parent <番号> --title <問い> --option <文> [--option <文> …] --chosen <A|B|…|A,C>',
	'                  [--slug <件名>] [--refs <番号,…>] [--replaces <id,…>] [--legacy <:名前:旧番号,…>] [--body <本文>] [--root <dir>] [--json]',
	'                                                                 決定を decisions/ に記録する (id は <親>-d<連番>)',
	'  issue decide list [--parent <番号>] [--root <dir>] [--json]    決定の一覧',
	'  issue decide show <id> [--root <dir>] [--json]                 決定を 1 件読む',
	'  issue decide migrate [--dry-run [--recheck] | --apply | --undo] [--root <dir>] [--json]',
	'                                                                 資料と課題の過去の決定 (96-A 等) を decisions/ へ移す (既定は --dry-run。--apply は書いたあとに確かめ、だめなら戻す)',
	'  issue choice next [--root <dir>] [--json]                      選択肢の通し番号を 1 つ予約して出す (worktree の間でも重ならない)',
	'  issue migrate [--dry-run | --apply] [--root <dir>] [--json]    旧 issues.html の課題を読み、移す計画を出す (既定は --dry-run。--apply で items/ へ書く。すでにある番号は飛ばす。旧の記録が食い違うものは、--state-override で状態を決めるまで書かない)',
].join('\n');

// ---- 引数 ----

/** repeated: 何度でも書ける、値を取る引数 (decide new の --option) */
type Spec = { valued: string[]; flags: string[]; positionals: number; repeated?: string[] };
type Options = { values: Map<string, string>; flags: Set<string>; positionals: string[]; repeated: Map<string, string[]> };

function parseOptions(rest: string[], spec: Spec): Options {
	const values = new Map<string, string>();
	const flags = new Set<string>();
	const positionals: string[] = [];
	const repeated = new Map<string, string[]>();
	for (let i = 0; i < rest.length; i++) {
		const a = rest[i];
		if (spec.flags.includes(a)) {
			flags.add(a);
		} else if (spec.repeated?.includes(a)) {
			const value = rest[i + 1];
			if (value === undefined) throw new UsageError(`${a} に値を渡してください`);
			repeated.set(a, [...(repeated.get(a) ?? []), value]);
			i++;
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
	return { values, flags, positionals, repeated };
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
			decisions: result.decisions,
			findings: result.findings,
		}));
	} else {
		for (const f of result.findings) console.log(label(f));
		const count = `課題 ${result.issues} 件 (未 ${result.todo} 件 ・ 着手 ${result.doing} 件 ・ 済 ${result.done} 件 ・ archived ${result.archived} 件)`
			+ (result.decisions > 0 ? ` ・ 決定 ${result.decisions} 件` : '');
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
	else if (r.result === 'moved') console.log(`[OK] 古い project-id.txt を ${r.rel} に移した (project_uuid は同じ値。project_id にフォルダ名を書いた)`);
	else if (r.result === 'replaced') console.log(`[OK] ${r.rel} の project_uuid を振り直した`);
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
		if (r.createdProjectId) console.log('     project-uuid.txt も作った');
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
	const o = parseOptions(rest, { valued: ['--root', '--state', '--group'], flags: ['--json', '--all', '--regex'], positionals: 1 });
	const term = o.positionals[0];
	const regex = o.flags.has('--regex');
	if (term === undefined || term === '') throw new UsageError('探す語が要る (issue search <語>)');
	const folders = foldersFrom(o);
	const root = existingRoot(o);
	const group = o.values.get('--group') ?? null;
	const hits = searchIssues(root, term, folders, group, (m) => console.error(m), regex);
	// 決定も探す (196-A)。--state は課題だけに効く。--group はグループが課題の持ち物なので、付けたら決定は探さない
	const decisionHits = group !== null ? [] : searchDecisions(root, term, regex);
	if (o.flags.has('--json')) {
		console.log(JSON.stringify([...hits, ...decisionHits]));
	} else {
		for (const h of hits) {
			console.log(`${h.id}  ${stateLabel(h.folder)}  ${h.group}  ${h.title}`);
			for (const m of h.matches.slice(0, 3)) console.log(`    L${m.line}: ${m.text}`);
		}
		for (const d of decisionHits) {
			console.log(`${d.id}  決定 (親 ${d.parent})  ${d.title}`);
			for (const m of d.matches.slice(0, 3)) console.log(`    L${m.line}: ${m.text}`);
		}
		console.log(`${hits.length + decisionHits.length} 件`);
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

/** archive --done-before <yyyy-mm-dd> [--dry-run] (216-A) */
function runArchiveBefore(rest: string[]): number {
	const o = parseOptions(rest, { valued: ['--root', '--done-before'], flags: ['--json', '--dry-run'], positionals: 0 });
	const before = o.values.get('--done-before') ?? '';
	if (!/^\d{4}-\d{2}-\d{2}$/.test(before)) throw new UsageError(`--done-before の日付は yyyy-mm-dd で渡す: ${before}`);
	const root = existingRoot(o);
	const dryRun = o.flags.has('--dry-run');
	const r = archiveDoneBefore(root, before, dryRun);
	if (o.flags.has('--json')) {
		console.log(JSON.stringify({ before, dryRun, moved: r.moved, count: r.moved.length, skipped: r.skipped }));
	} else {
		const verb = dryRun ? '動かす (--dry-run。まだ動かしていない)' : 'archived/ へ動かした';
		console.log(`[OK] ${before} より前に立てた済の課題 ${r.moved.length} 件を${verb}${r.moved.length > 0 ? ': ' + r.moved.join(' ・ ') : ''}`);
		for (const s of r.skipped) console.log(`[飛ばした] ${s.id}: ${s.reason}`);
	}
	if (!dryRun && r.moved.length > 0) autoRender(root, true);
	return ExitOk;
}

/** 課題の番号 (i + yymmdd-nn)。archive に渡されたのが番号かグループ名かを分ける */
const IdArgPattern = /^i\d{6}-[0-9a-zA-Z]{2}$/;

function runGroupMove(rest: string[], kind: 'archive' | 'unarchive'): number {
	if (kind === 'archive' && rest.includes('--done-before')) return runArchiveBefore(rest);
	const o = parseOptions(rest, { valued: ['--root'], flags: ['--json'], positionals: 1 });
	const group = o.positionals[0];
	if (group === undefined || group === '') throw new UsageError(`グループが要る (issue ${kind} <group>)`);
	const root = existingRoot(o);
	// 番号を渡したときは、その課題 1 件だけを保管する (214-A)
	if (kind === 'archive' && IdArgPattern.test(group)) {
		const one = archiveOne(root, group);
		if (o.flags.has('--json')) console.log(JSON.stringify({ id: group, group: one.group, moved: one.moved, count: one.moved.length }));
		else if (one.moved.length === 0) console.log(`[OK] ${group} は既に archived/ にある。動かさない`);
		else console.log(`[OK] ${group} を archived/ へ動かした (グループ ${one.group})`);
		autoRender(root, true);
		return ExitOk;
	}
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
	const o = parseOptions(rest, { valued: ['--root', '--state-override'], flags: ['--json', '--dry-run', '--apply', '--undo'], positionals: 0 });
	if ([o.flags.has('--apply'), o.flags.has('--dry-run'), o.flags.has('--undo')].filter((x) => x).length > 1) throw new UsageError('--apply ・ --dry-run ・ --undo は一緒に使えない');
	const root = existingRoot(o);
	const listFile = path.join(root, ...WrittenListRel.split('/'));

	// --undo: --apply が書いたファイル (一覧にあるもの) だけを消す (183-A)
	if (o.flags.has('--undo')) {
		if (!fs.existsSync(listFile)) throw new Failure(`${WrittenListRel} が無い (--apply で書いた記録が無いので、戻せるものが無い)`);
		const rels = fs.readFileSync(listFile, 'utf8').split('\n').map((s) => s.trim()).filter((s) => s !== '');
		const removed = removeWritten(root, rels);
		fs.rmSync(listFile);
		autoRender(root, true);
		if (o.flags.has('--json')) console.log(JSON.stringify({ listed: rels.length, removed }));
		else {
			console.log(`[undo] --apply で書いた ${rels.length} 件のうち ${removed} 件を消した (一覧に無いファイルには触らない)`);
			console.log('  旧 HTML を issues-legacy.html へ改名していたら、git mv で issues.html へ戻す');
		}
		return ExitOk;
	}

	const plan = planMigration(root);
	const override = o.values.get('--state-override');
	if (override !== undefined) applyOverrides(plan, override);
	const inFolder = (folder: Folder): number => plan.move.filter((m) => m.folder === folder).length;
	const printConflicts = (): void => {
		console.log(`  確かめが要る: ${plan.conflicts.length} 件 (旧 HTML の記録が食い違っている)`);
		for (const c of plan.conflicts) console.log(`    - ${c.id} ${c.where}: ${c.message}`);
		if (plan.conflicts.length > 0) {
			console.log('  どの状態で移すかを決めて、--state-override で渡す (例: --state-override ' + plan.conflicts.map((c) => c.id + '=着手').join(',') + ')');
		}
	};
	const printSize = (): void => {
		const s = plan.size;
		console.log(`  中身の比較: 本文の文字数 ${s.sourceChars} → ${s.convertedChars} ・ やること ${s.sourceTodos} → ${s.convertedTodos} ・ 食い違い ${plan.mismatches.length} 件`);
		for (const m of plan.mismatches) console.log(`    - ${m.id} ${m.where}: ${m.message}`);
	};
	if (o.flags.has('--apply')) {
		// 確かめが要るもの ・ 中身の食い違いが残っていれば、1 件も書かない (169-A ・ 183-A)
		if (plan.conflicts.length > 0 || plan.mismatches.length > 0) {
			if (o.flags.has('--json')) {
				console.log(JSON.stringify({ read: plan.read, written: [], exists: plan.exists, unreadable: plan.unreadable, conflicts: plan.conflicts, mismatches: plan.mismatches, size: plan.size }));
			} else {
				console.log(`[apply] 何も書かずに止めた。旧 HTML から課題 ${plan.read} 件を読んだ`);
				printConflicts();
				printSize();
			}
			return ExitFailed;
		}
		const r = applyMigration(root, plan);
		// 書いたものの一覧を残す (--undo が読む)。既に一覧があれば足す
		const before = fs.existsSync(listFile) ? fs.readFileSync(listFile, 'utf8') : '';
		fs.writeFileSync(listFile, before + r.written.map((w) => w.rel + '\n').join(''));
		// 書いたあとに、読み直して比べ、issue check を流す。だめなら書いたものを全部消して戻す (183-A)
		const after = verifyWritten(root, plan, r.written);
		const checked = checkProject(root);
		const errors = checked.findings.filter((f) => f.level === 'error');
		if (after.length > 0 || errors.length > 0) {
			const removed = removeWritten(root, r.written.map((w) => w.rel));
			if (before === '') fs.rmSync(listFile, { force: true });
			else fs.writeFileSync(listFile, before);
			if (o.flags.has('--json')) {
				console.log(JSON.stringify({ read: plan.read, written: [], rolledBack: removed, mismatches: after, checkErrors: errors }));
			} else {
				console.log(`[apply] 書いたあとの確かめで食い違いが出たので、書いた ${removed} 件を消して元に戻した`);
				for (const a of after) console.log(`    - ${a.id}: ${a.message}`);
				for (const e of errors) console.log('    - ' + label(e));
			}
			autoRender(root, true);
			return ExitFailed;
		}
		if (o.flags.has('--json')) {
			console.log(JSON.stringify({ read: plan.read, written: r.written, exists: plan.exists, unreadable: plan.unreadable, size: plan.size }));
		} else {
			console.log(`[apply] 旧 HTML から課題 ${plan.read} 件を読んだ`);
			console.log(`  書いた: ${r.written.length} 件 (済 ${inFolder('done')} ・ 着手 ${inFolder('doing')} ・ 未 ${inFolder('todo')} ・ 保管 ${inFolder('archived')})`);
			console.log(`  すでに items/ にある (移さない): ${plan.exists.length} 件`);
			console.log(`  読めなかった (書いていない。旧 HTML を見て手で書き写す): ${plan.unreadable.length} 件`);
			for (const p of plan.unreadable) console.log(`    - ${p.where}: ${p.message}`);
		}
		autoRender(root, true);
		return plan.unreadable.length > 0 ? ExitFailed : ExitOk;
	}
	if (o.flags.has('--json')) {
		console.log(JSON.stringify({
			read: plan.read,
			sources: plan.sources,
			move: plan.move.map((m) => ({ id: m.id, legacyId: m.legacyId, state: m.state, folder: m.folder, group: m.group, title: m.title, source: m.source })),
			exists: plan.exists,
			unreadable: plan.unreadable,
			conflicts: plan.conflicts,
			mismatches: plan.mismatches,
			size: plan.size,
		}));
	} else {
		console.log(`[dry-run] 旧 HTML から課題 ${plan.read} 件を読んだ`);
		console.log('  ' + plan.sources.map((s) => `${s.file} ${s.count} 件`).join(' ・ '));
		console.log(`  移す: ${plan.move.length} 件 (済 ${inFolder('done')} ・ 着手 ${inFolder('doing')} ・ 未 ${inFolder('todo')} ・ 保管 ${inFolder('archived')})`);
		const renamed = plan.move.filter((m) => m.legacyId !== undefined);
		if (renamed.length > 0) console.log(`  番号を直して書く (連番の l → L): ${renamed.map((m) => `${m.legacyId} → ${m.id}`).join(' ・ ')}`);
		console.log(`  すでに items/ にある (移さない): ${plan.exists.length} 件`);
		console.log(`  読めなかった: ${plan.unreadable.length} 件`);
		for (const p of plan.unreadable) console.log(`    - ${p.where}: ${p.message}`);
		printConflicts();
		printSize();
	}
	return plan.unreadable.length > 0 || plan.conflicts.length > 0 || plan.mismatches.length > 0 ? ExitFailed : ExitOk;
}

// ---- decide (決定の記録。計画 p261108-01) ----

function runDecide(rest: string[]): number {
	const sub = rest[0];
	const args = rest.slice(1);
	if (sub === 'new') {
		const o = parseOptions(args, {
			valued: ['--root', '--parent', '--title', '--chosen', '--slug', '--refs', '--replaces', '--legacy', '--body'], flags: ['--json'], positionals: 0, repeated: ['--option'],
		});
		const parent = o.values.get('--parent');
		const title = o.values.get('--title');
		const chosen = o.values.get('--chosen');
		if (parent === undefined) throw new UsageError('--parent (親の番号) が要る');
		if (title === undefined) throw new UsageError('--title (問い) が要る');
		if (chosen === undefined) throw new UsageError('--chosen (選んだ案の字) が要る');
		const root = existingRoot(o);
		const r = newDecision(root, {
			parent, title, chosen, options: o.repeated.get('--option') ?? [], slug: o.values.get('--slug'),
			refs: o.values.get('--refs'), replaces: o.values.get('--replaces'), legacy: o.values.get('--legacy'), body: o.values.get('--body'),
		});
		if (o.flags.has('--json')) console.log(JSON.stringify({ id: r.id, file: r.rel }));
		else console.log(`[OK] ${r.rel} を作った (${r.id})`);
		return ExitOk;
	}
	if (sub === 'list') {
		const o = parseOptions(args, { valued: ['--root', '--parent'], flags: ['--json'], positionals: 0 });
		const parent = o.values.get('--parent') ?? null;
		if (parent !== null && !ParentPattern.test(parent)) throw new UsageError(`--parent の形が違う: ${parent}`);
		const root = existingRoot(o);
		const items = listDecisions(root, parent, (m) => console.error(m));
		if (o.flags.has('--json')) console.log(JSON.stringify(items));
		else {
			for (const d of items) console.log(`${d.id}  ${d.chosen}  ${d.decided}  ${d.title}`);
			console.log(`${items.length} 件`);
		}
		return ExitOk;
	}
	if (sub === 'show') {
		const o = parseOptions(args, { valued: ['--root'], flags: ['--json'], positionals: 1 });
		const id = o.positionals[0];
		if (id === undefined) throw new UsageError('id が要る (issue decide show <id>)');
		if (!DecisionIdPattern.test(id)) throw new UsageError(`決定の id の形が違う: ${id} (例: i261103-01-d1)`);
		const root = existingRoot(o);
		const v = showDecision(root, id);
		if (o.flags.has('--json')) console.log(JSON.stringify({ id: v.id, file: v.file, meta: v.meta, options: v.options, body: v.body }));
		else {
			console.log(`${v.id}  ${v.file}`);
			console.log(v.text.replace(/\n+$/, ''));
		}
		return ExitOk;
	}
	if (sub === 'migrate') return runDecideMigrate(args);
	throw new UsageError(sub === undefined ? 'decide の操作が要る (new ・ list ・ show ・ migrate)' : '知らない decide の操作: ' + sub);
}

// ---- decide migrate (過去の決定の移行。計画 p261108-03) ----

function runDecideMigrate(rest: string[]): number {
	const o = parseOptions(rest, { valued: ['--root'], flags: ['--json', '--dry-run', '--apply', '--undo', '--recheck'], positionals: 0 });
	if ([o.flags.has('--apply'), o.flags.has('--dry-run'), o.flags.has('--undo')].filter((x) => x).length > 1) throw new UsageError('--apply ・ --dry-run ・ --undo は一緒に使えない');
	if (o.flags.has('--recheck') && (o.flags.has('--apply') || o.flags.has('--undo'))) throw new UsageError('--recheck は --dry-run とだけ使える (何も書かない)');
	const root = existingRoot(o);
	const json = o.flags.has('--json');
	const listFile = path.join(root, ...DecideWrittenListRel.split('/'));

	// --undo: --apply が書いたファイル (一覧にあるもの) だけを消す (190-A)
	if (o.flags.has('--undo')) {
		if (!fs.existsSync(listFile)) throw new Failure(`${DecideWrittenListRel} が無い (--apply で書いた記録が無いので、戻せるものが無い)`);
		const rels = fs.readFileSync(listFile, 'utf8').split('\n').map((s) => s.trim()).filter((s) => s !== '');
		const removed = removeDecideWritten(root, rels);
		fs.rmSync(listFile);
		autoRender(root, true);
		if (json) console.log(JSON.stringify({ listed: rels.length, removed }));
		else console.log(`[undo] --apply で書いた ${rels.length} 件のうち ${removed} 件を消した (一覧に無いファイルには触らない)`);
		return ExitOk;
	}

	const plan = planDecideMigration(root);
	const fromTable = plan.move.filter((m) => m.from === 'table').length;
	const printLists = (): void => {
		console.log(`  表から: ${fromTable} 件 ・ 本文から拾った: ${plan.fromText.length} 件 ・ 既にある (飛ばした): ${plan.skipped.length} 件`);
		console.log(`  A とみなした (本文に記録なし。192-A): ${plan.assumedA.length > 0 ? plan.assumedA.join(' ・ ') : 'なし'}`);
		console.log(`  本文から拾った番号 (問いと案は記録なし。193-A): ${plan.fromText.length > 0 ? plan.fromText.join(' ・ ') : 'なし'}`);
		if (plan.split.length > 0) console.log(`  字が割れた: ${plan.split.map((x) => `${x.number} (${x.letters})`).join(' ・ ')}`);
		console.log(`  読めなかった: ${plan.unreadable.length} 件`);
		for (const u of plan.unreadable) console.log(`    - ${u.where}: ${u.message}`);
	};
	if (o.flags.has('--apply')) {
		let written: { id: string; rel: string; legacy: string }[] = [];
		const before = fs.existsSync(listFile) ? fs.readFileSync(listFile, 'utf8') : '';
		let problems: { id: string; message: string }[] = [];
		let errors: ReturnType<typeof checkProject>['findings'] = [];
		try {
			written = applyDecideMigration(root, plan).written;
		} catch (e) {
			problems.push({ id: '-', message: e instanceof Error ? e.message : String(e) });
		}
		if (written.length > 0) {
			fs.mkdirSync(path.dirname(listFile), { recursive: true });
			fs.writeFileSync(listFile, before + written.map((w) => w.rel + '\n').join(''));
		}
		// 書いたあとに読み直して比べ、issue check を流す。だめなら書いたものを全部消して戻す (190-A)
		if (problems.length === 0) problems = verifyDecideWritten(root, plan, written);
		errors = checkProject(root).findings.filter((f) => f.level === 'error');
		if (problems.length > 0 || errors.length > 0) {
			const removed = removeDecideWritten(root, written.map((w) => w.rel));
			if (before === '') fs.rmSync(listFile, { force: true });
			else fs.writeFileSync(listFile, before);
			if (json) console.log(JSON.stringify({ written: [], rolledBack: removed, mismatches: problems, checkErrors: errors }));
			else {
				console.log(`[apply] 書いたあとの確かめで食い違いが出たので、書いた ${removed} 件を消して元に戻した`);
				for (const p of problems) console.log(`    - ${p.id}: ${p.message}`);
				for (const e of errors) console.log('    - ' + label(e));
			}
			return ExitFailed;
		}
		if (json) console.log(JSON.stringify({ written, skipped: plan.skipped, assumedA: plan.assumedA, fromText: plan.fromText, split: plan.split, unreadable: plan.unreadable }));
		else {
			console.log(`[apply] 決定を ${written.length} 件書いた (一覧: ${DecideWrittenListRel}。戻すときは --undo)`);
			printLists();
		}
		autoRender(root, true);
		return ExitOk;
	}
	// --recheck (218-A): 移し済みの決定で、chosen と違う字が資料に出てくるものを出す
	const recheck = o.flags.has('--recheck') ? recheckDecisions(root) : undefined;
	if (json) {
		console.log(JSON.stringify({
			move: plan.move.map((m) => ({ parent: m.parent, legacy: m.legacy, title: m.title, chosen: m.chosen, options: m.options.length, from: m.from, source: m.source })),
			skipped: plan.skipped, assumedA: plan.assumedA, fromText: plan.fromText, split: plan.split, unreadable: plan.unreadable,
			...(recheck !== undefined ? { recheck } : {}),
		}));
	} else {
		console.log(`[dry-run] 移す: ${plan.move.length} 件 (何も書いていない)`);
		printLists();
		if (recheck !== undefined) {
			console.log(`  見直しが要る (移し済みで、選んだ字と違う字が資料に出てくる。218-A): ${recheck.length} 件`);
			for (const h of recheck) console.log(`    - ${h.id} (旧 ${h.legacy}): 選んだ字 ${h.chosen} ・ 資料に出てくる字 ${h.letters}`);
			if (recheck.length > 0) console.log('  両方を選んでいたなら、issue decide new --parent <親> --chosen A,B --replaces <id> … で置き換える');
		}
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
	confirm: runConfirm,
	render: runRender,
	view: runView,
	archive: (rest) => runGroupMove(rest, 'archive'),
	unarchive: (rest) => runGroupMove(rest, 'unarchive'),
	migrate: runMigrate,
	decide: runDecide,
	choice: runChoice,
};

// ---- choice (選択肢の番号。計画 p261109-01 の 201-A) ----

function runChoice(rest: string[]): number {
	const sub = rest[0];
	if (sub !== 'next') throw new UsageError(sub === undefined ? 'choice の操作が要る (next)' : '知らない choice の操作: ' + sub);
	const o = parseOptions(rest.slice(1), { valued: ['--root'], flags: ['--json'], positionals: 0 });
	const root = existingRoot(o);
	const n = nextChoice(root, todayJst());
	if (n === null) throw new Failure('選択肢の番号を取れなかった (project-uuid.txt が無いなら issue init で作る)');
	if (o.flags.has('--json')) console.log(JSON.stringify({ number: n }));
	else console.log(String(n));
	return ExitOk;
}

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
