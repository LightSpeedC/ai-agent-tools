/*
	cc ・ cx ・ ag の共通部: 起こすものの決め (窓のタイトル ・ 引数 ・ 環境 ・ start の行)。
	外の状態を持たない関数だけ (試験できるように、main.ts から切り出している)。

	  ・窓のタイトル: <入口のコマンド名> <フォルダ名> (87-B)
	  ・cc: claude.exe [-c] -n "<フォルダ名> <月/日> <時:分>"
	  ・cx: codex-trusted [resume]
	  ・ag: ag-trusted --dangerously-skip-permissions --mode auto [-c]
	  ・続きの引数 (-c ・ resume) は、履歴があるときだけ最初から付ける。番人 (keeper.cmd) が
	    再起動するときは、いつも付ける (起動した時点で、履歴ができているため)
	  ・cc は CLAUDE で始まる環境変数を、CC_KEEP の 2 つ以外、起こすものに渡さない (81-B)
	  ・番人への入力 (KEEPER_*) は、エージェントに渡さない (番人が、起こす前に消す)

	計画: notes/10_plan/i261101-02-ag-cmdと起動の共通部.html
*/

import * as path from 'node:path';
import { datePart } from './pick.ts';
import type { Agent } from './history.ts';

export type Env = Record<string, string | undefined>;

export interface LaunchSpec {
	exe: string;
	/** 最初の起動の引数 (番人が、そのまま渡す文字列) */
	first: string;
	/** 再起動の引数 */
	again: string;
}

/** 窓のタイトル。start の引数を壊さないよう、引用符は取り除く */
export function windowTitle(agent: Agent, dir: string): string {
	return (agent + ' ' + path.win32.basename(dir)).replace(/"/g, '');
}

export function launchSpec(agent: Agent, dir: string, history: boolean, now: Date): LaunchSpec {
	switch (agent) {
		case 'cc': {
			const { md, hm } = datePart(now);
			const name = '-n "' + path.win32.basename(dir) + ' ' + md + ' ' + hm + '"';
			return { exe: 'claude.exe', first: (history ? '-c ' : '') + name, again: '-c ' + name };
		}
		case 'cx':
			return { exe: 'codex-trusted', first: history ? 'resume' : '', again: 'resume' };
		case 'ag': {
			const base = '--dangerously-skip-permissions --mode auto';
			return { exe: 'ag-trusted', first: history ? base + ' -c' : base, again: base + ' -c' };
		}
	}
}

/** cc が、CLAUDE で始まる変数のうち、起こす claude に渡すもの (大文字で書く)。
    CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS は use-lms.cmd が設定する (81-B) */
const CC_KEEP = ['CLAUDE_CODE_USE_POWERSHELL_TOOL', 'CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS'];

/** 起こすものに渡す環境。元のオブジェクトは変えない */
export function agentEnv(agent: Agent, env: Env): Env {
	const out: Env = {};
	for (const [key, value] of Object.entries(env)) {
		const upper = key.toUpperCase();
		if (upper.startsWith('KEEPER_')) { continue; }
		if (agent === 'cc' && upper.startsWith('CLAUDE') && !CC_KEEP.includes(upper)) { continue; }
		out[key] = value;
	}
	return out;
}

/** 番人の窓に渡す環境。エージェントに渡す環境に、番人への入力を足す */
export function keeperEnv(agent: Agent, env: Env, spec: LaunchSpec): Env {
	return { ...agentEnv(agent, env), KEEPER_EXE: spec.exe, KEEPER_FIRST: spec.first, KEEPER_AGAIN: spec.again };
}

/**
 * 番人を起こす行。番人のあとに、エージェント名とフォルダを載せる。番人は使わないが、
 * 起こした親はすぐ終わるので、psls でコマンド行を見たときに、誰の ・ どのプロジェクトの番人かが分かる (i261110-03)
 */
export function keeperCommand(keeper: string, agent: Agent, dir: string): string {
	return '"' + keeper + '" ' + agent + ' "' + dir.replace(/"/g, '') + '"';
}

/**
 * 新しい窓で番人の行を動かす cmd の引数。start は、最初の引用符つきの引数をタイトルとして扱うため、
 * タイトルは必ず引用符で囲む。cmd /s は先頭と末尾の引用符を 1 組外すので、外側と番人の行の両方をもう一組で囲む
 */
export function startArgs(title: string, command: string): string {
	return '/d /s /c "start "' + title + '" cmd /d /s /c "' + command + '""';
}
