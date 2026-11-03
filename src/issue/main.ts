/*
	issue: 課題管理ツール。計画は p261103-01、仕様は notes/50_spec/課題ファイルの形と検査.html。

		issue check                  作業フォルダから親をたどって、プロジェクトを探して検査する
		issue check --root <dir>     プロジェクトのフォルダを指す
		issue check --json           結果を JSON で出す

	終了コード（2 は使わない。Stop フックが 2 を「続ける」と読むため）
		0 エラーが無い（警告があってもよい）
		1 エラーが 1 件以上ある
		5 引数の誤り ・ プロジェクトが見つからない

	読み取り専用。出力に絶対パスを出さない（ファイルはプロジェクトからの相対パス）。
	いまはフェーズ 1（読み込みと check）まで。new ・ list ・ set 等は、まだ無い。
*/
import path from 'node:path';
import { checkProject, findProjectRoot, hasItems, type Finding } from './check.ts';

const ExitOk = 0;
const ExitErrors = 1;
const ExitBadArgs = 5;

const Usage = [
	'使い方:',
	'  issue check [--root <dir>] [--json]   課題ファイルと project-id.txt を検査する',
].join('\n');

function badArgs(message: string): never {
	console.error('[NG] ' + message);
	console.error(Usage);
	process.exit(ExitBadArgs);
}

function label(f: Finding): string {
	return (f.level === 'error' ? '[NG] ' : '[警告] ') + f.file + ' [' + f.code + '] ' + f.message;
}

function runCheck(rest: string[]): void {
	let rootArg: string | null = null;
	let json = false;
	for (let i = 0; i < rest.length; i++) {
		const a = rest[i];
		if (a === '--json') {
			json = true;
		} else if (a === '--root') {
			const value = rest[i + 1];
			if (value === undefined || value.startsWith('--')) badArgs('--root にフォルダを渡してください');
			rootArg = value;
			i++;
		} else {
			badArgs('知らない引数: ' + a);
		}
	}

	let root: string | null;
	if (rootArg !== null) {
		const resolved = path.resolve(rootArg);
		root = hasItems(resolved) ? resolved : null;
		if (root === null) {
			console.error('[NG] --root で指したフォルダに、notes/40_issues/items/ が無い');
			process.exit(ExitBadArgs);
		}
	} else {
		root = findProjectRoot(process.cwd());
		if (root === null) {
			console.error('[NG] 作業フォルダから親をたどっても、notes/40_issues/items/ を持つプロジェクトが見つからない (--root で指せる)');
			process.exit(ExitBadArgs);
		}
	}

	const result = checkProject(root);
	const errors = result.findings.filter((f) => f.level === 'error').length;
	const warnings = result.findings.length - errors;

	if (json) {
		console.log(JSON.stringify({
			ok: errors === 0,
			errors,
			warnings,
			issues: result.issues,
			archived: result.archived,
			findings: result.findings,
		}));
	} else {
		for (const f of result.findings) console.log(label(f));
		const count = `課題 ${result.issues} 件 (進行中 ${result.issues - result.archived} 件 ・ archived ${result.archived} 件)`;
		if (errors > 0) console.log(`[NG] ${count}。エラー ${errors} 件 ・ 警告 ${warnings} 件`);
		else if (warnings > 0) console.log(`[OK] ${count}。エラー 0 件 ・ 警告 ${warnings} 件`);
		else console.log(`[OK] ${count}。問題なし`);
	}
	process.exit(errors > 0 ? ExitErrors : ExitOk);
}

const args = process.argv.slice(2);
if (args.length === 0) badArgs('サブコマンドを指定してください');
if (args[0] === '--help' || args[0] === '-h') {
	console.log(Usage);
	process.exit(ExitOk);
}
if (args[0] === 'check') runCheck(args.slice(1));
else badArgs('知らないサブコマンド: ' + args[0] + ' (いまあるのは check だけ)');
