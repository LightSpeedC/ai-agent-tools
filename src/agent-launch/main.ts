/*
	cc ・ cx ・ ag の入口 (bin/cc.cmd ・ cx.cmd ・ ag.cmd が呼ぶ)。

	  node main.ts <cc | cx | ag> <プロジェクト名の一部>

	起こすフォルダを決め (pick.ts)、そのエージェントの履歴があれば続き、無ければ新規で、
	新しい窓で番人 (keeper.cmd) を動かして、すぐ終わる。常駐しない (90-A)。
	窓のタイトルは <入口のコマンド名> <フォルダ名>。

	試験が差し替えられる環境変数 (本番では指定しない):
	  AGENT_LAUNCH_TEST_ROOT   置き場。未設定のとき W:\
	  AGENT_LAUNCH_TEST_HOME   履歴の置き場 (ホーム)。未設定のとき本物のホーム
	  AGENT_LAUNCH_TEST_HIDE   1 のとき、窓を作らず、非表示のまま番人を動かす (共通ルール
	                           「窓が要る試験は、非表示で裏に回す」)

	計画: notes/10_plan/i261101-02-ag-cmdと起動の共通部.html
*/

import { spawn, spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { hasHistory, type Agent } from './history.ts';
import { keeperEnv, launchSpec, startArgs, windowTitle, type Env } from './launch.ts';
import { pickFolder } from './pick.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const keeperPath = path.join(here, 'keeper.cmd');
const registerMain = path.join(here, '..', 'cc-register', 'main.ts');
const Agents: Agent[] = ['cc', 'cx', 'ag'];

const ExitBadArgs = 2;
const ExitNoRoot = 1;

/** claude 用: フォルダを ~/.claude.json に登録する (初回の信頼の確認を出さない)。失敗しても起動する */
function registerForClaude(dir: string): void {
	spawnSync(process.execPath, [registerMain, dir], { stdio: 'inherit', env: process.env, cwd: dir });
}

function launchKeeper(title: string, dir: string, env: Env): void {
	const hide = process.env.AGENT_LAUNCH_TEST_HIDE === '1';
	if (hide) {
		// 非表示 (試験): 番人に、尋ねずに終わる (KEEPER_NOASK) と渡す。detached でない子は、親が終わるときに
		// 道連れで止められ (Node が Job に入れる)、detached だと choice が答えを待ち続けて残る (どちらも実測)
		const child = spawn('cmd.exe', ['/d', '/c', keeperPath], { cwd: dir, env: { ...env, KEEPER_NOASK: '1' }, detached: true, stdio: 'ignore', windowsHide: true });
		child.unref();
		return;
	}
	const child = spawn('cmd.exe', [startArgs(title, keeperPath)], { cwd: dir, env, detached: true, stdio: 'ignore', windowsHide: true, windowsVerbatimArguments: true });
	child.unref();
}

function main(argv: string[]): number {
	const agent = argv[0] as Agent;
	const name = argv[1];
	if (!Agents.includes(agent)) {
		console.error('[NG] エージェントは cc ・ cx ・ ag のどれかです。');
		return ExitBadArgs;
	}
	if (name == null || name === '') {
		console.error('[NG] プロジェクト名を指定してください。(例: ' + agent + ' 名前)');
		return ExitBadArgs;
	}
	const root = process.env.AGENT_LAUNCH_TEST_ROOT ?? 'W:\\';
	if (!fs.existsSync(root)) {
		console.error('[NG] ' + root + ' が見つかりません');
		return ExitNoRoot;
	}

	const now = new Date();
	const picked = pickFolder(root, name, now);
	const home = process.env.AGENT_LAUNCH_TEST_HOME ?? os.homedir();
	// 新しく作ったフォルダは、必ず履歴が無い。既存のフォルダでも、そのエージェントの履歴が無ければ新規 (別のエージェントが先に作ったとき)
	const history = picked.existing && hasHistory(agent, picked.dir, home);
	console.log(picked.dir + ' で起動します (' + (history ? '続き' : '新規') + ')。');

	if (agent === 'cc') { registerForClaude(picked.dir); }
	const spec = launchSpec(agent, picked.dir, history, now);
	launchKeeper(windowTitle(agent, picked.dir), picked.dir, keeperEnv(agent, process.env, spec));
	return 0;
}

process.exit(main(process.argv.slice(2)));
