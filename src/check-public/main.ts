/*
	公開前に、外に出してはいけないものが混ざっていないかを見る。

	コミットは履歴に残る。一度上げたものを消すには履歴の書き換えが要るため、
	**上げる前に機械で見る。**いま手で grep している点検を道具にしたもの。

	見るのは 6 項目。

	  1. メールアドレス
	  2. 実体パス（C:\Users\ の直後がプレースホルダでないもの）
	  3. 認証情報（password ・ token などに値が続くもの）
	  4. 除外語（利用者が持つリスト。顧客名・案件名は式では見つけられない）
	  5. 異体字の混入（日本語・英数字に混ざったキリル・ハングル）
	  6. git の author（設定された名前とアドレスを本文から探す）

	**当たった値そのものは画面に出さない。**出力は会話ログや CI のログに残る。
	伏せるための道具が漏らす側にまわってはいけない。

	探すのは git が追跡しているファイルだけ。.gitignore で外したものは
	公開されないため見る必要が無く、見れば必ず誤検出になる
	（除外語リスト自身がそこにある）。--all で全部を見られる。

	計画は notes/10_plan/p260912-01-check-public.html。
*/

import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { parseArgs, type OptionSpec } from '../lib/args.ts';
import { detect, isValidUtf8 } from '../lib/detector.ts';
import { decode } from '../lib/codec.ts';

/** 指摘あり。ほかの検査ツールと同じ契約 */
const ExitFound = 1;
/** 引数や対象の誤り */
const ExitBadArgs = 2;

const Specs: OptionSpec[] = [
	{ name: 'path', kind: 'string', short: 'p', positional: true },
	{ name: 'word-list', kind: 'string', short: 'w' },
	// 何度でも渡せる（--skip mail --skip path）。カンマ区切りも受ける
	{ name: 'skip', kind: 'list', short: 's' },
	{ name: 'all', kind: 'boolean', short: 'a' },
];

const Defaults = {
	path: '.',
	'word-list': '_public-ng-words.txt',
	all: false,
};

/*
	見ないもの。

	**拾う拡張子を並べる形にしない。**その形だと、並べ忘れたものが黙って
	外れ、外れていることは出力を見ても分からない。実際 .svg（図の中に文字が
	入る）と、拡張子を持たない sh のランチャーが外れていた（i260913-01）。

	外すのは中身がテキストでないものだけにして、残りは読めるかどうかで決める。
	読めなければ detect が null を返すので、そこで飛ばす。
*/
const BinaryExtensions = [
	// 画像
	'.png', '.jpg', '.jpeg', '.gif', '.bmp', '.ico', '.webp', '.tif', '.tiff', '.psd',
	// 音声・動画
	'.mp3', '.mp4', '.wav', '.avi', '.mov', '.wmv', '.m4a', '.webm',
	// 書庫
	'.zip', '.gz', '.bz2', '.xz', '.7z', '.rar', '.tar', '.cab',
	// 実行ファイルと中間物
	'.exe', '.dll', '.pdb', '.so', '.dylib', '.bin', '.obj', '.lib', '.o',
	// フォント
	'.ttf', '.otf', '.woff', '.woff2', '.eot',
	// 文書
	'.pdf', '.docx', '.xlsx', '.pptx', '.doc', '.xls', '.ppt',
	// データベース
	'.db', '.sqlite', '.mdb',
];

/** 中身がテキストとして読めそうか。拡張子を持たないものも通す */
function isTextTarget(file: string): boolean {
	return BinaryExtensions.indexOf(path.extname(file).toLowerCase()) < 0;
}

const SkipDirs = ['.git', 'node_modules', 'tmp', 'etc', 'dist', '_releases'];

type Rule = {
	/** --skip で名指しする名前 */
	key: string;
	label: string;
	test: (line: string) => boolean;
};

/*
	伏せ字と変数参照は当てない。
	これらを拾うと、正しく伏せた資料ほど指摘が増えて道具が使われなくなる。
*/
function isPlaceholder(s: string): boolean {
	// &lt; は HTML でエスケープされた < 。資料はエスケープした形で保存される
	return /^[<%$（(〈{~]/.test(s) || s.startsWith('{{') || s.startsWith('&lt;');
}

/*
	認証情報らしい値かを見る。**この項目がいちばん誤検出しやすい。**

	`token` `secret` はコードでは普通の語で、変数名にも型注釈にも出る。
	語だけで拾うと、道具そのもののソースが指摘だらけになって使われなくなる
	（実際に args.ts の 5 行が当たった）。

	疑うのは「人が読んでも意味の無い並び」だけにする。

	  ・8 文字以上
	  ・英字と数字の両方を含む
	  ・コードの識別子・添字・呼び出しの形をしていない
*/
function looksLikeSecret(value: string): boolean {
	const v = value.replace(/^['"`]+/, '').replace(/['"`,;)}\]]+$/, '');
	if (v.length < 8) { return false; }
	if (isPlaceholder(v)) { return false; }
	// argv[i] ・ opts.token ・ getToken() のような書き方は除く
	if (/^[A-Za-z_$][A-Za-z0-9_$]*(\[[^\]]*\]|\.[A-Za-z0-9_$]+|\(\))*$/.test(v)) { return false; }
	// 環境変数の参照
	if (/\$[A-Za-z_{]|%[A-Za-z_]+%/.test(v)) { return false; }
	return /[A-Za-z]/.test(v) && /[0-9]/.test(v);
}

/*
	除くのは RFC 2606 が文書用に予約しているものと noreply だけ。
	**似ているだけの名前を足さない**（example-corp.jp は予約されていない）。
	除外を広げるほど、本物を見逃す側に倒れる。
*/
const MailAllow = ['example.com', 'example.org', 'example.net', 'noreply@'];

/** 囲まずに伏せ字として書かれる語。C:\Users\username\ の形で資料によく出る */
const PathPlaceholders = ['username', 'user', 'yourname', 'name', '<name>', 'me'];

const Rules: Rule[] = [
	{
		key: 'mail',
		label: 'メールアドレス',
		test: (line) => {
			const m = line.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g);
			if (m == null) { return false; }
			return m.some((a) => !MailAllow.some((w) => a.toLowerCase().includes(w)));
		},
	},
	{
		key: 'path',
		label: '実体パス',
		test: (line) => {
			/*
				直後が英数字で始まるものだけを見る。
				`C:\Users\` とだけ書いた説明文（直後が引用符や空白）は当たらない。
				<username> ・ %USERNAME% ・ &lt;伏せ&gt; も先頭の記号ではじかれる
			*/
			const m = line.match(/[Cc]:[\\/]Users[\\/]([A-Za-z0-9][A-Za-z0-9._-]*)/);
			if (m == null) { return false; }
			return PathPlaceholders.indexOf(m[1].toLowerCase()) < 0;
		},
	},
	{
		key: 'secret',
		label: '認証情報',
		test: (line) => {
			// === ・ == は比較であって代入ではない。値の側だけを見る
			const m = line.match(/(password|passwd|secret|api[_-]?key|token)\s*[:=]=*\s*(\S+)/i);
			if (m == null) { return false; }
			return looksLikeSecret(m[2]);
		},
	},
	{
		key: 'script',
		label: '異体字',
		// 日本語・英数字の並びに混ざったキリル・ハングル
		test: (line) => /[\u0400-\u04FF\uAC00-\uD7AF]/.test(line),
	},
];

function usage(toStdout: boolean): void {
	const write = toStdout ? console.log : console.error;
	write('公開前に、外に出してはいけないものが混ざっていないかを見ます。');
	write('');
	write('  check-public [対象] [オプション]');
	write('');
	write('  -p, --path <対象>       プロジェクトフォルダ。既定はカレント');
	write('  -w, --word-list <パス>  除外語リスト。既定は _public-ng-words.txt');
	write('  -s, --skip <名前>       飛ばす項目。カンマ区切り');
	write('                          mail ・ path ・ secret ・ script ・ words ・ author');
	write('  -a, --all               git が追跡していないファイルも見る');
	write('  -h, --help              この使い方を出す');
	write('');
	write('終了コードは 0（指摘なし）・ 1（指摘あり）・ 2（引数や対象の誤り）。');
	write('当たった値そのものは画面に出しません。');
}

/** git が追跡しているファイルを聞く。git の外なら null */
function gitFiles(dir: string): string[] | null {
	const r = spawnSync('git', ['-C', dir, '-c', 'core.quotepath=false', 'ls-files'], { encoding: 'utf8' });
	if (r.status !== 0 || r.stdout == null) { return null; }
	return r.stdout.split('\n').map((s) => s.trim()).filter((s) => s.length > 0);
}

/** git の author。設定が無ければ空 */
function gitAuthor(dir: string): string[] {
	const out: string[] = [];
	for (const key of ['user.name', 'user.email']) {
		const r = spawnSync('git', ['-C', dir, 'config', key], { encoding: 'utf8' });
		if (r.status === 0 && r.stdout != null) {
			const v = r.stdout.trim();
			if (v.length > 0) { out.push(v); }
		}
	}
	return out;
}

function walkAll(dir: string, out: string[]): void {
	let entries: fs.Dirent[];
	try {
		entries = fs.readdirSync(dir, { withFileTypes: true });
	} catch {
		return;
	}
	for (const e of entries) {
		const full = path.join(dir, e.name);
		if (e.isDirectory()) {
			if (SkipDirs.indexOf(e.name) >= 0) { continue; }
			walkAll(full, out);
			continue;
		}
		if (e.isFile() && isTextTarget(e.name)) {
			out.push(full);
		}
	}
}

/** 読む。SJIS ・ UTF-16 も取りこぼさない（cmd ・ reg が検査されない状態を作らない） */
function readLines(file: string): string[] | null {
	let bytes: Uint8Array;
	try {
		bytes = fs.readFileSync(file);
	} catch {
		return null;
	}
	let kind = detect(bytes);
	if (kind == null) {
		/*
			BOM 無しで日本語を含むと、UTF-8 とも SJIS とも読めて判定できない。
			**変換なら書き換えずに止めるのが正しいが、検査では逆。**
			読める形があるのに飛ばすと、黙って検査から漏れる
			（実際に日本語入りの .svg 2 件が漏れていた）。
			UTF-8 として成立するならそちらで読む。
		*/
		if (isValidUtf8(bytes)) { kind = 'utf8'; }
		else { return null; }
	}
	try {
		return decode(bytes, kind).split(/\r?\n/);
	} catch {
		return null;
	}
}

function loadWords(file: string): string[] | null {
	if (!fs.existsSync(file)) { return null; }
	const text = fs.readFileSync(file, 'utf8');
	return text.split(/\r?\n/)
		.map((s) => s.trim())
		.filter((s) => s.length > 0 && !s.startsWith('#'))
		.map((s) => s.toLowerCase());
}

function main(): number {
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

	const target = path.resolve(String(parsed.values['path']));
	const all = parsed.values['all'] === true;
	const skip = (parsed.values['skip'] as string[])
		.flatMap((s) => s.split(','))
		.map((s) => s.trim())
		.filter((s) => s.length > 0);

	console.log('=== 公開前の検査 ===');

	if (!fs.existsSync(target)) {
		console.log('パスが見つかりません: ' + String(parsed.values['path']));
		return ExitBadArgs;
	}

	// ---- 対象を集める ----
	let files: string[];
	const tracked = all ? null : gitFiles(target);
	if (tracked != null) {
		files = tracked.map((f) => path.join(target, f))
			.filter((f) => isTextTarget(f));
	}
	else {
		const found: string[] = [];
		const st = fs.statSync(target);
		if (st.isDirectory()) { walkAll(target, found); }
		else { found.push(target); }
		files = found;
		if (!all) {
			console.log('  git の外なので、追跡の有無を見ずに全部を見ます');
		}
	}
	files.sort();

	// ---- 規則をそろえる ----
	const rules = Rules.filter((r) => skip.indexOf(r.key) < 0);

	// 除外語
	let words: string[] | null = null;
	if (skip.indexOf('words') < 0) {
		const listArg = String(parsed.values['word-list']);
		const listPath = path.isAbsolute(listArg) ? listArg : path.join(target, listArg);
		words = loadWords(listPath);
		if (words == null) {
			// 黙って通さない。いちばん効く項目が働いていない状態を隠さない
			console.log('  [除外語] リストが無いので飛ばしました');
		}
	}

	// git の author。名前をリストに書かずに済む
	let authors: string[] = [];
	if (skip.indexOf('author') < 0) {
		authors = gitAuthor(target).map((s) => s.toLowerCase());
	}

	console.log('  対象: ' + files.length + ' ファイル');
	console.log('');

	// ---- 見る ----
	let hits = 0;
	let skipped = 0;

	for (const file of files) {
		const lines = readLines(file);
		if (lines == null) { skipped++; continue; }

		const rel = path.relative(target, file).split('\\').join('/');

		for (let i = 0; i < lines.length; i++) {
			const line = lines[i];
			if (line.length === 0) { continue; }
			const lower = line.toLowerCase();

			for (const rule of rules) {
				if (rule.test(line)) {
					console.log('  ' + rel + ':' + (i + 1) + '  [' + rule.label + ']');
					hits++;
				}
			}

			if (words != null && words.some((w) => lower.includes(w))) {
				console.log('  ' + rel + ':' + (i + 1) + '  [除外語]');
				hits++;
			}

			if (authors.length > 0 && authors.some((a) => lower.includes(a))) {
				console.log('  ' + rel + ':' + (i + 1) + '  [git の author]');
				hits++;
			}
		}
	}

	console.log('');
	if (skipped > 0) {
		console.log('  読めなかった ' + skipped + ' ファイルは飛ばしました');
	}

	if (hits === 0) {
		console.log('=== 指摘はありません ===');
		return 0;
	}

	console.log('=== ' + hits + ' 件の指摘があります ===');
	console.log('');
	console.log('値そのものは出していません。場所を頼りに中身を見てください。');
	return ExitFound;
}

process.exit(main());
