/*
	HTML の文字色と背景色のコントラストを、ブラウザで実測して確かめる。

	CSS を読み返しても「白背景に白文字」は見つからない。変数が未定義で
	background だけが無効化され、color だけが生き残る事故は、宣言を
	眺めても気づけないため。

	実際の計測は contrast/check-contrast.cjs が Playwright で行う。
	ここは対象を集めて渡し、返ってきた結果を並べるところを持つ。

	判定は「読めない」箇所の検出に絞る。WCAG AA（4.5:1）で判定すると、
	文字が 1 文字も乗っていないグラデーションの端まで拾い、誤検出で
	本当の問題が埋もれる。

	PowerShell 版（check-contrast.ps1）からの移植。出力と終了コードは揃える。
*/

import { spawn } from 'node:child_process';
import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs, type OptionSpec } from '../lib/args.ts';
import { collect, relativeTo } from '../lib/walk.ts';

/** 引数の誤り・前提が揃わない・検証できなかった */
const ExitBadArgs = 2;

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..', '..');

const Specs: OptionSpec[] = [
	{ name: 'path', kind: 'string', short: 'p', aliases: ['-Path'], positional: true },
	{ name: 'recurse', kind: 'boolean', short: 'r', aliases: ['-Recurse'] },
	{ name: 'min', kind: 'number', short: 'm', aliases: ['-Min'] },
	{ name: 'exclude', kind: 'string', short: 'e', aliases: ['-Exclude'] },
	{ name: 'playwright-root', kind: 'string', aliases: ['-PlaywrightRoot'] },
	{ name: 'timeout', kind: 'number' },
];

const Defaults = {
	path: '.',
	recurse: false,
	min: 1.5,
	exclude: '\\\\(tmp|etc|node_modules|\\.git|contrast)\\\\',
	'playwright-root': 'N:/PlayWright',
	// 待ち時間の上限（秒）。ブラウザの起動を含むので長めに取る
	timeout: 300,
};

function usage(toStdout: boolean): void {
	const write = toStdout ? console.log : console.error;
	write('HTML の文字色と背景色のコントラストを、ブラウザで実測して確かめます。');
	write('');
	write('  check-contrast [対象] [オプション]');
	write('');
	write('  -p, --path <対象>         フォルダかファイル。既定はカレント');
	write('  -r, --recurse             サブフォルダも見る');
	write('  -m, --min <比>            これを下回るものを報告する。既定 1.5');
	write('  -e, --exclude <正規表現>  除外するパス');
	write('      --playwright-root <パス>  Playwright 共有環境の置き場');
	write('      --timeout <秒>        計測の待ち時間の上限。既定 300');
	write('  -h, --help                この使い方を出す');
	write('');
	write('対象はオプション名を付けずに置いてもかまいません（check-contrast . -r）。');
	write('古い -Path 形式も受けます。');
}

/** 幅をそろえて並べる。日本語は 2 桁として数える */
function pad(s: string, width: number): string {
	let w = 0;
	for (const ch of s) { w += ch.charCodeAt(0) > 0x7f ? 2 : 1; }
	return s + ' '.repeat(Math.max(0, width - w));
}

type Issue = { ratio: number; tag: string; cls: string; color: string; background: string; text: string };
type Result = { file: string; issues?: Issue[]; error?: string };

type RunResult = { status: number | null; timedOut: boolean; stdout: string; stderr: string };

/*
	子プロセスを走らせて、出た分をすべて受け取る。

	**同期版（spawnSync）は使わない。**返るまでこのプロセスの非同期処理が
	1 つも進まないため。いまは待つ相手が 1 本だけだが、同期で書くと
	並行して計測する形へ進むときに全部書き直すことになる。

	上限を付ける。ブラウザが返らなくなったときに止まったままにしないため。
	実際に ai-chat-lite 側で、入力待ちのプロセスが 10 時間残った例がある。
*/
function runCjs(cjs: string, inputPath: string, timeoutSec: number): Promise<RunResult> {
	return new Promise((resolve) => {
		const child = spawn('node', [cjs, inputPath]);
		let stdout = '';
		let stderr = '';
		let timedOut = false;

		const timer = setTimeout(() => {
			timedOut = true;
			child.kill();
		}, timeoutSec * 1000);

		child.stdout.setEncoding('utf8');
		child.stderr.setEncoding('utf8');
		child.stdout.on('data', (d: string) => { stdout += d; });
		child.stderr.on('data', (d: string) => { stderr += d; });

		// node が起動できないなど、走らせる前に失敗した
		child.on('error', (e: Error) => {
			clearTimeout(timer);
			resolve({ status: null, timedOut, stdout, stderr: stderr + e.message });
		});

		child.on('close', (code: number | null) => {
			clearTimeout(timer);
			resolve({ status: code, timedOut, stdout, stderr });
		});
	});
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
	const min = Number(parsed.values['min']);
	const exclude = String(parsed.values['exclude']);
	const playwrightRoot = String(parsed.values['playwright-root']);
	const timeoutSec = Number(parsed.values['timeout']);

	console.log('=== HTML のコントラスト実測（ブラウザで描画して計測） ===');

	// ---- 前提の確認 ----
	const cjs = path.join(root, 'contrast', 'check-contrast.cjs');
	if (!fs.existsSync(cjs)) {
		console.log('検査スクリプトが見つかりません: ' + cjs);
		return ExitBadArgs;
	}
	if (!fs.existsSync(path.join(playwrightRoot, 'node_modules', 'playwright'))) {
		console.log('Playwright の共有環境が見つかりません: ' + playwrightRoot);
		console.log('--playwright-root で場所を指定してください。');
		return ExitBadArgs;
	}

	// ---- 対象を集める ----
	const found = collect(target, '.html', recurse, exclude);
	if (found.missing) {
		console.log('パスが見つかりません: ' + target);
		return ExitBadArgs;
	}
	if (found.files.length === 0) {
		console.log('対象の .html がありません');
		return 0;
	}

	// リダイレクトページは転送先を二重に検査してしまうので外す
	const targets: string[] = [];
	let redirects = 0;
	for (const f of found.files) {
		const html = fs.readFileSync(f, 'utf8');
		if (/http-equiv\s*=\s*["']?refresh/i.test(html) || /location\.replace\s*\(/.test(html)) {
			redirects++;
		}
		else { targets.push(f); }
	}

	if (targets.length === 0) {
		console.log('対象がすべてリダイレクトページでした');
		return 0;
	}

	console.log('  対象: ' + targets.length + ' ファイル（しきい値 ' + min + ':1）');
	if (redirects > 0) {
		console.log('  リダイレクトページ ' + redirects + ' 件は除外しました');
	}
	console.log('');

	// ---- 計測する ----
	// ファイル名は実行ごとに変える。固定名だと、同時に 2 つ動かしたとき
	// 片方の入力をもう片方が上書きしてしまう（i260908-04 の安全性 5）
	const tmpDir = path.join(root, 'tmp');
	if (!fs.existsSync(tmpDir)) { fs.mkdirSync(tmpDir, { recursive: true }); }
	const inputPath = path.join(tmpDir, 'contrast-input.' + crypto.randomUUID().replace(/-/g, '') + '.json');

	fs.writeFileSync(inputPath, JSON.stringify({
		files: targets,
		min,
		playwrightRoot: playwrightRoot.split('\\').join('/'),
	}), 'utf8');

	// cjs は CommonJS のため node で走らせる（bun でも動くが、揃えて node にする）
	const r = await runCjs(cjs, inputPath, timeoutSec);
	try { fs.unlinkSync(inputPath); } catch { /* 消せなくても計測結果には影響しない */ }

	if (r.timedOut) {
		console.log('計測が ' + timeoutSec + ' 秒で終わりませんでした');
		console.log('  --timeout で延ばせます。ブラウザが起動できているかも確かめてください。');
		return ExitBadArgs;
	}

	if (r.status !== 0 || r.stdout.length === 0) {
		console.log('計測に失敗しました');
		for (const line of r.stderr.split('\n')) {
			if (line.trim().length > 0) { console.log('  ' + line.trimEnd()); }
		}
		return ExitBadArgs;
	}

	let results: Result[];
	try {
		results = JSON.parse(r.stdout) as Result[];
	}
	catch {
		console.log('計測の結果を読めませんでした');
		return ExitBadArgs;
	}

	// ---- 報告する ----
	let ngTotal = 0;
	let ngFiles = 0;
	let errFiles = 0;

	for (const res of results) {
		const rel = relativeTo(found.root, res.file);

		if (res.error != null) {
			console.log('  ' + pad(rel, 38) + ' 検証できません: ' + res.error);
			errFiles++;
			continue;
		}

		const issues = res.issues ?? [];
		if (issues.length === 0) {
			console.log('  ' + pad(rel, 38) + ' OK');
			continue;
		}

		ngFiles++;
		ngTotal += issues.length;
		console.log('  ' + pad(rel, 38) + ' ' + issues.length + ' 箇所');
		for (const i of issues) {
			const sel = i.cls.length > 0 ? i.tag + '.' + i.cls.trim().split(/\s+/).join('.') : i.tag;
			console.log('      ' + String(i.ratio).padStart(5) + ':1  ' + sel);
			console.log('             文字色 ' + i.color + ' / 背景 ' + i.background);
			console.log('             "' + i.text + '"');
		}
	}

	console.log('');

	if (errFiles > 0) {
		console.log('=== ' + errFiles + ' ファイルを検証できませんでした ===');
		return ExitBadArgs;
	}

	if (ngTotal === 0) {
		console.log('=== 問題なし。読めない配色はありません ===');
		return 0;
	}

	console.log('=== ' + ngFiles + ' ファイルに ' + ngTotal + ' 箇所の問題があります ===');
	console.log('');
	console.log('文字色と背景色がほぼ同じになっています。次のいずれかが原因のことが多いです。');
	console.log('  ・color を書いた宣言に background が無い（またはその逆）');
	console.log('  ・var() にフォールバックが無く、変数が未定義で色が消えた');
	console.log('  ・濃い背景の中の code ・ a ・ strong に色を指定していない');
	return 1;
}

main().then((code) => process.exit(code));
