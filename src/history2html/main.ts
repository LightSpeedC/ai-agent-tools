/*
	history2html の入口。会話ログ（JSONL）から、公開用の静的なページを作る。計画は p261014-01。

		history2html [--path <プロジェクト>] [--out <フォルダ>] [--word-list <パス>] [--title <題>]

	自分のプロジェクトの etc/history/jsonl/ を読み、自分のプロジェクトの notes/91_history/ に書く。
	伏せ字を掛け、書き出す前に出力の全体をもう一度検査する。**1 件でも残れば何も書かない。**

	終了コード: 0 成功 ／ 1 伏せ漏れがあり、書き出さなかった ／ 2 引数 ・ 入力 ・ 出し先の誤り
	画面には件数だけを出す。**会話の本文も、伏せた値も出さない。**
*/

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { parseArgs, type OptionSpec } from '../lib/args.ts';
import { gitAuthor, loadWords } from '../lib/public-rules.ts';
import { collect } from './collect.ts';
import { createMasker, MaskLabels, type MaskContext } from './mask.ts';
import { build, inspect, Marker, write } from './output.ts';

const ExitLeak = 1;
const ExitBadArgs = 2;

const Specs: OptionSpec[] = [
	{ name: 'path', kind: 'string', short: 'p', positional: true },
	{ name: 'in', kind: 'string', short: 'i' },
	{ name: 'out', kind: 'string', short: 'o' },
	{ name: 'word-list', kind: 'string', short: 'w' },
	{ name: 'title', kind: 'string', short: 't' },
	{ name: 'lead', kind: 'string', short: 'l' },
];

const Defaults = {
	path: '.',
	in: '',
	out: '',
	// check-public と同じリスト（決めたこと 16-A）
	'word-list': '_public-ng-words.txt',
	title: '',
	lead: '',
};

/*
	1 行の概要を README.html のタイトルバーから取る（決めたこと 31-A）。
	各プロジェクトの README は .lead に概要を持つ（共通ルール「HTMLデザインルール」のクラス名）。
	タグを外し、空白を詰める。無ければ空
*/
function readmeLead(readme: string): string {
	if (!fs.existsSync(readme)) { return ''; }
	const m = /<p\b[^>]*class="[^"]*\blead\b[^"]*"[^>]*>([\s\S]*?)<\/p>/.exec(fs.readFileSync(readme, 'utf8'));
	if (m == null) { return ''; }
	return m[1].replace(/<[^>]*>/g, '')
		.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&')
		.replace(/\s+/g, ' ').trim();
}

/** 読む場所と、既定の出し先（決めたこと 17）。プロジェクトからの相対 */
const InputDir = 'etc/history/jsonl';
const DefaultOut = 'notes/91_history';

function usage(toStdout: boolean): void {
	const write = toStdout ? console.log : console.error;
	write('会話ログ (etc/history/jsonl) から、伏せ字を掛けた公開用のページを作ります。');
	write('');
	write('  history2html [プロジェクト] [オプション]');
	write('');
	write('  -p, --path <フォルダ>     プロジェクト。既定はカレント');
	write('  -i, --in <フォルダ>       会話ログのフォルダ。既定は <プロジェクト>/' + InputDir);
	write('  -o, --out <フォルダ>    出し先。既定は <プロジェクト>/' + DefaultOut);
	write('  -w, --word-list <パス>    伏せる語のリスト。既定は <プロジェクト>/_public-ng-words.txt');
	write('  -t, --title <題>          ページの題。既定はプロジェクトのフォルダ名');
	write('  -l, --lead <概要>         題に添える 1 行の概要。既定は README.html のタイトルバーの概要');
	write('  -h, --help                この使い方を出す');
	write('');
	write('終了コードは 0 (成功)・ 1 (伏せ漏れがあり、書き出さなかった)・ 2 (引数や入力の誤り)。');
	write('画面には件数だけを出します。会話の本文も、伏せた値も出しません。');
}

function fail(message: string): number {
	console.error('[NG] ' + message);
	return ExitBadArgs;
}

/** 画面に出すパス。プロジェクトからの相対にする（ユーザー名を含むフルパスを出さない） */
function shown(project: string, p: string): string {
	const rel = path.relative(project, p);
	if (rel === '' ) { return '.'; }
	if (rel.startsWith('..') || path.isAbsolute(rel)) { return p.replace(os.homedir(), '~').split('\\').join('/'); }
	return rel.split('\\').join('/');
}

async function main(): Promise<number> {
	const parsed = parseArgs(process.argv.slice(2), Specs, Defaults);
	if (parsed.help) { usage(true); return 0; }
	if (parsed.error != null) {
		console.error('[NG] ' + parsed.error);
		usage(false);
		return ExitBadArgs;
	}

	const project = path.resolve(String(parsed.values['path']));
	// 入力フォルダ。相対はカレントから（--out と同じ）
	const inArg = String(parsed.values['in']);
	const input = inArg.length > 0 ? path.resolve(inArg) : path.join(project, InputDir);
	const outArg = String(parsed.values['out']);
	const out = outArg.length > 0 ? path.resolve(outArg) : path.join(project, DefaultOut);
	const listArg = String(parsed.values['word-list']);
	const listPath = path.isAbsolute(listArg) ? listArg : path.join(project, listArg);
	const titleArg = String(parsed.values['title']);

	if (!fs.existsSync(input) || !fs.statSync(input).isDirectory()) {
		return fail('会話ログのフォルダがありません: ' + shown(project, input));
	}
	const words = loadWords(listPath);
	if (words == null) {
		// check-public は飛ばして続けるが、こちらは公開する物を作るので止める（計画の第 3 章）
		return fail('伏せる語のリストがありません: ' + shown(project, listPath)
			+ '\n     人の名前 ・ 社名など、式では見つけられない語を 1 行に 1 つ書きます (空でもよい)。'
			+ '\n     Git の管理外にするため、名前の先頭を _ にします。');
	}
	// 出し先が空でなく、前回の印も無ければ書かない。別のものを上書きしない
	if (fs.existsSync(out)) {
		const entries = fs.readdirSync(out);
		if (entries.length > 0 && !fs.existsSync(path.join(out, Marker))) {
			return fail('出し先が空でなく、前回 history2html が作ったものでもありません: ' + shown(project, out));
		}
	}

	const home = process.env.HISTORY2HTML_HOME || os.homedir();
	const ctx: MaskContext = {
		user: process.env.HISTORY2HTML_USERNAME || path.basename(home) || null,
		host: process.env.HISTORY2HTML_HOSTNAME || os.hostname() || null,
		authors: await gitAuthor(project),
		words,
		// テストだけが使う。置き換えを外して、2 段目の検査が止めることを確かめる
		skip: process.env.HISTORY2HTML_TEST_NO_MASK ? new Set(process.env.HISTORY2HTML_TEST_NO_MASK.split(',')) : undefined,
	};
	const masker = createMasker(ctx);

	const collected = collect(input);
	const title = masker.mask(titleArg.length > 0 ? titleArg : path.basename(project));
	const readme = path.join(project, 'README.html');
	const leadArg = String(parsed.values['lead']);
	const lead = masker.mask(leadArg.length > 0 ? leadArg : readmeLead(readme));
	const homeHref = fs.existsSync(readme) ? path.relative(out, readme).split('\\').join('/') : null;
	const built = build(collected, masker.mask, title, lead, homeHref);

	console.log('=== history2html ===');
	console.log('  読んだもの: ' + shown(project, input) + ' の ' + collected.files + ' ファイル (' + collected.sessions.length + ' セッション。読めなかった行 ' + collected.badLines + ')');
	console.log('  日 ' + built.stats.days + ' ・ 依頼 ' + built.stats.prompts + ' ・ 人の発言なしの応答 ' + built.stats.triggers
		+ ' ・ AI の本文 ' + built.stats.answers + ' ・ ツール ' + built.stats.tools);
	const masked = Object.entries(masker.counts).map(([k, n]) => (MaskLabels[k] ?? k) + ' ' + n);
	console.log('  伏せた数: ' + (masked.length > 0 ? masked.join(' ・ ') : 'なし'));
	// 伏せた後の語だけを並べる。元の値は出さない（34-A）
	for (const [token, n] of Object.entries(masker.tokens).sort((a, b) => b[1] - a[1])) {
		console.log('    ✅ ' + token + '  ' + n + ' 件');
	}
	// 伏せる仕組みが働いていないことを、件数に頼らずに知らせる（34-A）。書き出しは止めない
	if (words.length === 0) {
		console.log('  ⚠️ 伏せる語のリストが空です。人の名前 ・ 社名は伏せていません: ' + shown(project, listPath));
	}
	if (ctx.authors.length === 0) {
		console.log('  ⚠️ git の author が取れませんでした (git の外など)。author は伏せていません');
	}

	const leaks = inspect(built, ctx);
	if (leaks.size > 0) {
		console.log('');
		console.log('=== 伏せ漏れがあるので、書き出しませんでした ===');
		for (const [file, kinds] of leaks) {
			console.log('  ' + file + '  ' + [...kinds].map(([k, n]) => '[' + k + '] ' + n + ' 件').join(' ・ '));
		}
		console.log('値そのものは出していません。');
		return ExitLeak;
	}

	const w = write(out, built);
	console.log('  書き出し先: ' + shown(project, out) + ' (' + built.files.size + ' ファイル。書いた ' + w.written + ' ・ 同じなので書かなかった ' + w.same + ' ・ 消した ' + w.removed + ')');
	console.log('=== 書き出しました。公開する前に、人が目で読んでください ===');
	return 0;
}

main().then((code) => process.exit(code));
