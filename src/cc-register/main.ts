/*
	cc-register: プロジェクトのフォルダを ~/.claude.json の projects に足す。

	    node main.ts <プロジェクトのフォルダ>

	bin/cc.cmd が、claude を起こす前に呼ぶ。登録しておくと、初回の「このフォルダを信頼するか」の
	確認が出ない。内部の道具なので、使い方の資料には載せない。

	決め:
	  ・キーは W:/… の形（区切りは /、末尾の区切りは落とす）。Claude Code が書くキーと同じ形
	  ・信頼の確認を済みにした最小の項目を足す
	  ・登録済みなら何もしない。ファイルを書き直さない（開いている Claude が書き続けているため、
	    読んでから書くまでの間に、その書き込みを消す危険を、足すときだけに限る）
	  ・失敗（ファイルが無い・壊れている・書けない）は、登録を飛ばして終了コード 0。
	    cc は起動できなくなるより、確認が出るほうが軽い。飛ばしたことを 1 行だけ出す
	  ・書くときは同じフォルダに一時ファイルを書いて、名前を変える（途中で止まっても壊れない）

	環境変数 CC_CLAUDE_JSON があれば、~/.claude.json の代わりにそのファイルを使う（テスト用）。
*/

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

/** 信頼の確認を済みにした、最小の項目 */
function newEntry(): Record<string, unknown> {
	return {
		allowedTools: [],
		mcpContextUris: [],
		mcpServers: {},
		enabledMcpjsonServers: [],
		disabledMcpjsonServers: [],
		hasTrustDialogAccepted: true,
		hasClaudeMdExternalIncludesApproved: false,
		hasClaudeMdExternalIncludesWarningShown: false,
	};
}

/** W:\2026\a\ → W:/2026/a */
function toKey(dir: string): string {
	let key = dir.split('\\').join('/');
	while (key.length > 1 && key.endsWith('/') && !/^[A-Za-z]:\/$/.test(key)) {
		key = key.slice(0, -1);
	}
	return key;
}

/** 表示用。ホームの下なら ~ にする */
function show(p: string): string {
	const home = os.homedir();
	return p.split(home.split('\\').join('/')).join('~').split(home).join('~');
}

function skip(reason: string): never {
	console.log('[登録を飛ばしました] ' + reason);
	process.exit(0);
}

function main(): void {
	const dir = process.argv[2];
	if (dir === undefined || dir.length === 0) {
		console.error('使い方: cc-register <プロジェクトのフォルダ>');
		process.exit(2);
	}
	const key = toKey(dir);
	const file = process.env.CC_CLAUDE_JSON ?? path.join(os.homedir(), '.claude.json');
	const shown = show(file.split('\\').join('/'));

	let text: string;
	try {
		text = fs.readFileSync(file, 'utf8');
	} catch {
		skip(shown + ' を読めません (無ければ Claude Code が最初に作ります)');
	}

	let json: any;
	try {
		json = JSON.parse(text);
	} catch {
		skip(shown + ' が JSON として読めません。書き換えません');
	}
	if (json === null || typeof json !== 'object' || Array.isArray(json)) {
		skip(shown + ' の形が想定と違います。書き換えません');
	}

	if (json.projects !== undefined && (json.projects === null || typeof json.projects !== 'object' || Array.isArray(json.projects))) {
		skip(shown + ' の projects の形が想定と違います。書き換えません');
	}
	if (json.projects !== undefined && Object.prototype.hasOwnProperty.call(json.projects, key)) {
		return;
	}

	json.projects = json.projects ?? {};
	json.projects[key] = newEntry();

	// 元の字下げ（タブ・空白の数）に合わせる。見つからなければ 2 空白
	const m = /\n([ \t]+)"/.exec(text);
	const indent = m !== null ? m[1] : '  ';
	const out = JSON.stringify(json, null, indent) + (text.endsWith('\n') ? '\n' : '');

	const tmp = file + '.cc-register.' + process.pid + '.tmp';
	try {
		fs.writeFileSync(tmp, out);
		fs.renameSync(tmp, file);
	} catch (e) {
		try { fs.rmSync(tmp, { force: true }); } catch { /* 残っても害は無い */ }
		skip(shown + ' に書けません: ' + (e instanceof Error ? e.message : String(e)));
	}
	console.log('[登録しました] ' + key);
}

main();
