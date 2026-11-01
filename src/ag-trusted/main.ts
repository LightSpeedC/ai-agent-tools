/*
	ag-trusted — 現在のフォルダを agy の信頼に書き足してから、agy を起動する (codex-trusted と同じ形)。

	  ag-trusted                                       現在のフォルダを信頼して agy を起動
	  ag-trusted --dangerously-skip-permissions -c     agy の引数をそのまま渡す

	書く先は ~/.gemini/antigravity-cli/settings.json の trustedWorkspaces。
	試験が差し替えられるよう、環境変数 AG_TRUSTED_TEST_FILE で設定ファイルを指せる。
	設定ファイルが無い・壊れている・更新され続けているときは、書かずに終了コード 3 で止まる。
	それ以外の終了コードは agy のものをそのまま返す。

	計画: notes/10_plan/i261101-02-ag-cmdと起動の共通部.html (83-B)
*/

import * as os from 'node:os';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';
import { ensureTrusted } from './trust.ts';

const ExitStopped = 3;

function settingsFile(): string {
	return process.env.AG_TRUSTED_TEST_FILE ?? path.join(os.homedir(), '.gemini', 'antigravity-cli', 'settings.json');
}

function main(args: string[]): number {
	const dir = process.cwd();
	const file = settingsFile();
	const r = ensureTrusted(file, dir);
	switch (r.status) {
		case 'added':
			console.log('信頼設定を追加しました。');
			break;
		case 'already':
			console.log('信頼設定は既にあります。');
			break;
		case 'no-file':
			console.error('[NG] agy の設定ファイルが見つかりません。先に agy を 1 度起動して、設定を作ってください。');
			return ExitStopped;
		case 'broken':
			console.error('[NG] agy の設定ファイルが JSON として読めません。書き換えずに止めました。');
			return ExitStopped;
		case 'busy':
			console.error('[NG] agy の設定ファイルが更新され続けているため、書かずに止めました。agy を終了してから、もう一度実行してください。');
			return ExitStopped;
	}

	const child = spawnSync('agy', args, { stdio: 'inherit', cwd: dir });
	if (child.error != null) {
		console.error('[NG] agy を起動できません: ' + child.error.message);
		return 1;
	}
	return child.status ?? 1;
}

process.exit(main(process.argv.slice(2)));
