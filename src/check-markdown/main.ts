/*
	Markdown が GitHub のレンダラで意図どおりに表示されるかを実測する。

	ローカルで正しく見えても GitHub 上で壊れることがある。日本語では
	`**` が強調にならず記号のまま残ることがあり、CommonMark が前後の文字で
	開閉を決めるため。**推測で「直った」と判断しない。**

	Markdown を https://api.github.com/markdown に投げ、返る HTML に `**` が
	残っていないかを見る。コードブロックとコードスパンは対象外。

	PowerShell 版（check-markdown.ps1）からの移植。出力と終了コードは揃える。
*/

import * as fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import { parseArgs, type OptionSpec } from '../lib/args.ts';
import { collect, relativeTo } from '../lib/walk.ts';

/** 引数の誤り・検証できなかった。ほかの道具に合わせる */
const ExitBadArgs = 2;

const Specs: OptionSpec[] = [
	{ name: 'path', kind: 'string', short: 'p', aliases: ['-Path'], positional: true },
	{ name: 'recurse', kind: 'boolean', short: 'r', aliases: ['-Recurse'] },
	{ name: 'token', kind: 'string', short: 't', aliases: ['-Token'] },
	{ name: 'exclude', kind: 'string', short: 'e', aliases: ['-Exclude'] },
	{ name: 'delay-ms', kind: 'number', aliases: ['-DelayMs'] },
];

const Defaults = {
	path: '.',
	recurse: false,
	token: '',
	exclude: '\\\\(tmp|etc|node_modules|\\.git)\\\\',
	'delay-ms': 300,
};

function usage(toStdout: boolean): void {
	const write = toStdout ? console.log : console.error;
	write('Markdown が GitHub のレンダラで意図どおりに表示されるかを実測します。');
	write('');
	write('  check-markdown [対象] [オプション]');
	write('');
	write('  -p, --path <対象>         フォルダかファイル。既定はカレント');
	write('  -r, --recurse             サブフォルダも見る');
	write('  -e, --exclude <正規表現>  除外するパス');
	write('      --delay-ms <ミリ秒>   1 ファイルごとの待ち。既定 300');
	write('  -h, --help                この使い方を出す');
	write('');
	write('対象はオプション名を付けずに置いてもかまいません（check-markdown . -r）。');
	write('古い -Path 形式も受けます。');
	write('');
	write('GitHub のトークンは、環境変数 GITHUB_TOKEN ・ GH_TOKEN か、gh auth token から読みます (5000 回/時)。');
	write('無ければ認証なし (60 回/時)。引数では受けません (履歴やプロセスの一覧に残るため)。');
}

/** トークンの読み先。値は返すが、画面には読み先の名前だけを出す (234-A) */
function envToken(): { token: string; source: string } | null {
	for (const name of ['GITHUB_TOKEN', 'GH_TOKEN']) {
		const v = process.env[name];
		if (v !== undefined && v.trim() !== '') { return { token: v.trim(), source: '環境変数 ' + name }; }
	}
	return null;
}

function ghToken(): { token: string; source: string } {
	try {
		const r = spawnSync('gh', ['auth', 'token'], { encoding: 'utf8', windowsHide: true, timeout: 15000 });
		const v = (r.stdout ?? '').trim();
		if (r.status === 0 && v !== '') { return { token: v, source: 'gh auth token' }; }
	} catch { /* gh が無い */ }
	return { token: '', source: 'なし (60 回/時)' };
}

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

/** 幅をそろえて並べる。日本語は 2 桁として数える */
function pad(s: string, width: number): string {
	let w = 0;
	for (const ch of s) { w += ch.charCodeAt(0) > 0x7f ? 2 : 1; }
	return s + ' '.repeat(Math.max(0, width - w));
}

async function main(): Promise<number> {
	const parsed = parseArgs(process.argv.slice(2), Specs, Defaults);
	if (parsed.help) {
		usage(true);
		return 0;
	}
	if (parsed.error != null) {
		console.error('[NG] ' + parsed.error);
		usage(false);
		return ExitBadArgs;
	}

	const target = String(parsed.values['path']);
	const recurse = parsed.values['recurse'] === true;
	// 234-A: トークンを引数で受けない。値は出さない
	if (String(parsed.values['token']) !== '') {
		console.error('[NG] トークンは引数で受けません (シェルの履歴やプロセスの一覧に残るため)。');
		console.error('     環境変数 GITHUB_TOKEN か GH_TOKEN に入れるか、gh auth login を済ませてください (gh auth token から読みます)。');
		return ExitBadArgs;
	}
	const exclude = String(parsed.values['exclude']);
	const delayMs = Number(parsed.values['delay-ms']);

	console.log('=== Markdown の表示チェック（GitHub のレンダラ） ===');
	const fromEnv = envToken();
	if (fromEnv !== null) { console.log('  認証: ' + fromEnv.source); }

	const found = collect(target, '.md', recurse, exclude);
	if (found.missing) {
		console.log('パスが見つかりません: ' + target);
		return ExitBadArgs;
	}
	if (found.excluded > 0) {
		console.log('  除外 ' + found.excluded + ' 件');
	}
	if (found.files.length === 0) {
		console.log('対象の .md がありません');
		return 0;
	}

	console.log('  対象: ' + found.files.length + ' ファイル');
	const auth = fromEnv ?? ghToken();
	const token = auth.token;
	if (fromEnv === null) { console.log('  認証: ' + auth.source); }
	console.log('');

	const headers: Record<string, string> = {
		'User-Agent': 'check-markdown',
		'Accept': 'application/vnd.github+json',
		'Content-Type': 'application/json',
	};
	if (token.length > 0) { headers['Authorization'] = 'Bearer ' + token; }

	let ngTotal = 0;
	let ngFiles = 0;
	let errFiles = 0;

	for (const file of found.files) {
		const md = fs.readFileSync(file, 'utf8');
		const rel = relativeTo(found.root, file);

		let html: string;
		try {
			const res = await fetch('https://api.github.com/markdown', {
				method: 'POST',
				headers,
				body: JSON.stringify({ text: md, mode: 'gfm' }),
			});
			if (!res.ok) {
				throw new Error(res.status + ' ' + res.statusText);
			}
			html = await res.text();
		}
		catch (e) {
			const msg = e instanceof Error ? e.message : String(e);
			console.log('  ' + pad(rel, 34) + ' 検証できません: ' + msg);
			errFiles++;
			continue;
		}

		/*
			コードブロックとコードスパンは対象外。
			GitHub は <code class="notranslate"> のように class を付けるため、
			<code> 決め打ちの式では拾えない。属性も許す形にする
		*/
		let body = html.replace(/<pre[^>]*>[\s\S]*?<\/pre>/g, '');
		body = body.replace(/<code[^>]*>[\s\S]*?<\/code>/g, '');
		// 残りのタグも落とす。img の alt や a の title に ** があっても画面には出ない
		body = body.replace(/<[^>]+>/g, ' ');

		const hits = body.match(/.{0,45}\*\*.{0,45}/g) ?? [];

		if (hits.length === 0) {
			console.log('  ' + pad(rel, 34) + ' OK');
		}
		else {
			ngFiles++;
			ngTotal += hits.length;
			console.log('  ' + pad(rel, 34) + ' ' + hits.length + ' 箇所');
			for (const h of hits) {
				console.log('      ' + h.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim());
			}
		}

		await sleep(delayMs);
	}

	console.log('');

	// 検証できなかったファイルがあるなら「問題なし」とは言えない
	if (errFiles > 0) {
		console.log('=== ' + errFiles + ' ファイルを検証できませんでした ===');
		console.log('レート制限（認証なしで 60 回/時）に達した可能性があります。');
		console.log('時間をおくか、環境変数 GITHUB_TOKEN を入れるか gh auth login を済ませて、再実行してください。');
		if (ngTotal > 0) {
			console.log('あわせて ' + ngFiles + ' ファイルに ' + ngTotal + ' 箇所の問題が見つかっています。');
		}
		return ExitBadArgs;
	}

	if (ngTotal === 0) {
		console.log('=== 問題なし。すべて正しく表示されます ===');
		return 0;
	}

	console.log('=== ' + ngFiles + ' ファイルに ' + ngTotal + ' 箇所の問題があります ===');
	console.log('');
	console.log('日本語では ** が強調にならないことがあります。該当箇所を');
	console.log('<strong>〜</strong> に置き換えてください（html2md が機械的に行います）。');
	return 1;
}

main().then((code) => process.exit(code));
