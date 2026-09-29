/*
	PowerShell を呼んで、出力を UTF-8 に直して流す。

	    psh <path.ps1> [引数...]         ps1 を実行する（引数は -File と同じ規則で渡す）
	    psh -c "<式>"                   PowerShell の式を実行する（--command も可）
	    psh --pwsh …                    pwsh（7）で走らせる

	なぜ要るか:
	  Claude Code 2.1.269 の Windows 版から PowerShell ツールが使えなくなり、
	  Bash ツール経由で powershell を呼ぶしかなくなった。そのとき 2 つ困る。

	    1. 出力が CP932 になり、UTF-8 前提の呼び出し側で日本語が化ける
	    2. powershell -Command に文字列を渡すと、クォートが二重に解釈される
	       （エラーにならず、静かに違う内容で動くことがある）

	  ここでは子プロセスを配列で起動して 2 を避け、受け取ったバイト列を
	  CP932 として読み直して 1 を避ける。

	  PowerShell ツールが戻れば要らなくなる当て木。課題は i260912-06。

	決め:
	  ・終了コードは素通しする（呼び元の 0/1/2 の契約を壊さない）
	  ・標準出力は標準出力へ、標準エラーは標準エラーへ。混ぜない
	  ・対象が無い・引数が無いときは 2 で止める。黙って成功しない
*/

import { spawn } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';

/** 引数の誤り・対象が無い。html2md 系の契約に合わせる */
const ExitBadArgs = 2;

/*
	使い方を出す。

	求められて出すとき（--help）は標準出力へ、誤用を指したとき（引数なし）は
	標準エラーへ出す。**読みたくて呼んだものを、エラーの側へ流さない。**
*/
function usage(toStdout: boolean): void {
	const write = toStdout ? console.log : console.error;
	write('PowerShell を呼んで、出力を UTF-8 に直して流します。');
	write('');
	write('  psh <path.ps1> [引数...]     ps1 を実行する');
	write('  psh -c "<式>"               式を実行する（--command も同じ）');
	write('');
	write('  --pwsh                      pwsh（7）で走らせる。既定は powershell（5.1）');
	write('  --help ・ -h                この使い方を出す');
	write('');
	write('既定を 5.1 にしているのは、ps1 を 5.1 で動くように書く決めがあるため。');
	write('厳しい側で動かさないと、7 でしか通らない書き方に気づけません。');
	write('起動も 5.1 のほうが速い（実測 185ms 対 285ms）。');
	write('');
	write('PowerShell は UTF-8（65001）で動かします。ps1 の中で取り込んだ外部コマンドの');
	write('出力は UTF-8 として読まれます（SJIS を出すものは化けます）。');
	write('');
	write('終了コードは PowerShell のものをそのまま返します。');
}

/*
	受け取ったバイト列を読む。

	出力の文字コードは、呼び出しの経路と中身で変わる（いずれも実測）。

	  ・bun から起動した PowerShell 自身の出力は UTF-8
	  ・node ・ Bash ・ cmd から起動した PowerShell 自身の出力は CP932
	  ・PowerShell が呼ぶ .NET 製の exe は、その exe しだい
	    （Console.OutputEncoding を UTF-8 にしていれば UTF-8、既定なら CP932）

	つまり <strong>1 回の実行で両方が混ざる</strong>。
	node から CP932 で出す PowerShell に、UTF-8 で出す exe を呼ばせた形が実例で、
	<strong>全体をまとめて読むと、どちらかが必ず化ける。</strong>

	そこで <strong>行ごとに読み分ける</strong>。まず全体を UTF-8 として厳密に読み、
	読めなければ行に切って 1 行ずつ判定する。行の中で切り替わることは無い
	（1 つの Write-Host ・ 1 つの exe の出力が行をまたいで混ざらないため）。

	WHATWG の shift_jis デコーダは Windows-31J（CP932）のテーブルを使うため、
	日本語 Windows の exe が吐くバイト列をそのまま読める。
	bun ・ node のどちらでも使え、外部の依存が要らない。
*/
const utf8Strict = new TextDecoder('utf-8', { fatal: true });
const cp932 = new TextDecoder('shift_jis');

/** 改行（\n）を含んだまま行に切る。CRLF の \r は行の末尾に残る */
function splitLines(buf: Buffer): Buffer[] {
	const out: Buffer[] = [];
	let start = 0;
	for (let i = 0; i < buf.length; i++) {
		if (buf[i] === 0x0a) {
			out.push(buf.subarray(start, i + 1));
			start = i + 1;
		}
	}
	if (start < buf.length) { out.push(buf.subarray(start)); }
	return out;
}

function decodeOne(b: Uint8Array): string {
	try {
		return utf8Strict.decode(b);
	} catch {
		return cp932.decode(b);
	}
}

function decode(buf: Buffer | null): string {
	if (buf == null || buf.length === 0) { return ''; }
	try {
		// 全体が UTF-8 で読めるなら、それでよい（混ざっていない）
		return utf8Strict.decode(buf);
	} catch {
		// 混ざっている。行ごとに読み分ける
		return splitLines(buf).map(decodeOne).join('');
	}
}

type RunResult = { status: number | null; stdout: Buffer; stderr: Buffer; error?: Error };

/*
	PowerShell を UTF-8（65001）で動かす（計画 p260929-01。利用者の決定）。

	PowerShell は、ps1 の中で外部コマンドの出力を変数に取り込むとき、自分のコンソールの
	コードページで文字列にする。932 だと、このリポジトリのツールが出す UTF-8 が化け、
	65001 だと SJIS が化ける。UTF-8 のほうを取る。取り込んだあとに化けたものは、
	psh の読み分けでは直せない。

	PowerShell は自分専用のコンソール（windowsHide = CREATE_NO_WINDOW）で起動し、
	最初の 1 行でそのコンソールを 65001 にする。呼び出し元の窓には触らない
	（共通ルール「コンソールのコードページを変更しない」の例外「自分専用に作ったコンソール」）。
*/
const Utf8Setup = '[Console]::OutputEncoding = [Console]::InputEncoding = New-Object System.Text.UTF8Encoding($false)';

/** 単一引用符の文字列にする。中の ' は '' にする。$ などは展開されない */
function psQuote(s: string): string {
	return "'" + s.replace(/'/g, "''") + "'";
}

/*
	ps1 を呼ぶ 1 行を組み立てる。

	最初の 1 行を実行してから ps1 を呼ぶため、-File が使えず -Command の中から呼ぶ。
	-File と同じく、- で始まる語（-Name ・ -Flag）は引数の名前、それ以外は値として並べる。
	値はすべて単一引用符で囲むので、空白 ・ 引用符 ・ $ ・ ; を含んでも 1 つの値のまま届き、
	展開もされない（-File との突き合わせで確かめた）。-Name:値 は名前と値に分けて値だけ囲む。

	trap { break } を置く。引数の結び付けに失敗したとき、-File は 1 で終わるが、& は
	止まらないエラーとして続けて 0 で終わってしまうため。trap はこの 1 行の範囲の
	止まるエラーだけに効き、ps1 の中のエラーの扱いは変えない（突き合わせで確かめた）。

	-File との違い: exit を書かない ps1 の最後で外部コマンドが失敗すると、-File では 0、
	ここではその終了コードになる（ps1 が exit したのか、外部コマンドの値が残っているだけかを
	見分けられないため）。

	パスは絶対パスにする。& は区切りを含まない名前をカレントから探さないため
*/
function buildFileCall(script: string, rest: string[]): string {
	const parts = ['&', psQuote(path.resolve(script))];
	for (const a of rest) {
		const named = /^(-[A-Za-z_][\w-]*)(:(.*))?$/s.exec(a);
		if (named == null) { parts.push(psQuote(a)); }
		else if (named[2] == null) { parts.push(named[1]); }
		else { parts.push(named[1] + ':' + psQuote(named[3])); }
	}
	return Utf8Setup + '; trap { break }; $global:LASTEXITCODE = 0; ' + parts.join(' ') + '; exit $LASTEXITCODE';
}

/*
	PowerShell を走らせて、出た分をすべて受け取る。

	shell: false（既定）で起動する。配列のまま渡るので、空白や記号を含む
	引数が割れたり、別の意味に解釈されたりしない。

	**同期版（spawnSync）は使わない。**返るまでこのプロセスの非同期処理が
	1 つも進まないため。

	標準入力はすぐ閉じる。**閉じないと、相手が入力を待って止まったままになる。**
	Claude Code の Bash ツールは対話的な入力を返せないので、待たれても答えが無い
	（ai-chat-lite 側で、入力待ちのプロセスが 10 時間残った例がある）。
*/
function run(exe: string, args: string[]): Promise<RunResult> {
	return new Promise((resolve) => {
		// 自分専用のコンソールで起動する（上の Utf8Setup の説明を参照）
		const child = spawn(exe, args, { windowsHide: true });
		const out: Buffer[] = [];
		const err: Buffer[] = [];

		child.stdin.end();
		child.stdout.on('data', (d: Buffer) => { out.push(d); });
		child.stderr.on('data', (d: Buffer) => { err.push(d); });

		child.on('error', (e: Error) => {
			resolve({ status: null, stdout: Buffer.concat(out), stderr: Buffer.concat(err), error: e });
		});
		child.on('close', (code: number | null) => {
			resolve({ status: code, stdout: Buffer.concat(out), stderr: Buffer.concat(err) });
		});
	});
}

async function main(): Promise<number> {
	let args = process.argv.slice(2);

	/*
		どちらの PowerShell を呼ぶか。

		既定は powershell（Windows PowerShell 5.1）。pwsh（7）ではない。
		ps1 は 5.1 で動くように書く決めがあり、厳しい側で動かさないと
		7 でしか通らない書き方に気づけないため。起動も 5.1 のほうが速い
		（実測 185ms 対 285ms。7 は .NET Core の起動コストが乗る）。
	*/
	let exe = 'powershell';
	if (args[0] === '--pwsh') {
		exe = 'pwsh';
		args = args.slice(1);
	}

	if (args.length === 0) {
		usage(false);
		return ExitBadArgs;
	}

	/*
		使い方の要求。ほかの 3 つ（html2md ・ text ・ convert-encoding）に合わせる。
		見るのは先頭だけ。`psh script.ps1 --help` の --help は
		**呼ばれる ps1 のもの**なので、こちらで食べない
	*/
	if (args[0] === '--help' || args[0] === '-h') {
		usage(true);
		return 0;
	}

	const base = ['-NoProfile', '-ExecutionPolicy', 'Bypass'];
	let pwshArgs: string[];

	// -c は --command の短縮（sh -c ・ bash -c と同じ慣習）
	if (args[0] === '--command' || args[0] === '-c') {
		if (args.length < 2) {
			console.error('[NG] ' + args[0] + ' に式がありません。');
			return ExitBadArgs;
		}
		// 式は 1 つの引数として渡す。シェルを挟まないので、
		// ここで引用符を足す必要はない（足すと式の一部になってしまう）。
		// 前に UTF-8 にする 1 行を置く
		pwshArgs = base.concat(['-Command', Utf8Setup + '; ' + args[1]]);
	} else {
		const script = args[0];
		if (!fs.existsSync(script)) {
			console.error('[NG] ファイルが見つかりません: ' + script);
			return ExitBadArgs;
		}
		pwshArgs = base.concat(['-Command', buildFileCall(script, args.slice(1))]);
	}

	const r = await run(exe, pwshArgs);

	if (r.error != null) {
		console.error('[NG] ' + exe + ' を起動できません: ' + r.error.message);
		return ExitBadArgs;
	}

	const out = decode(r.stdout);
	const err = decode(r.stderr);
	if (out.length > 0) { process.stdout.write(out); }
	if (err.length > 0) { process.stderr.write(err); }

	// シグナルで落ちた場合は status が null になる
	return r.status == null ? ExitBadArgs : r.status;
}

main().then((code) => process.exit(code));
