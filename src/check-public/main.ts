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

	誤検出は、設定ファイル（check-public-allow.txt）で外せる（計画 i261018-02）。
	**「このファイルの、この項目で、この語を含む行」だけ**を外す。項目全体（--skip）と違い、
	同じファイルの本物の鍵は外れない。外した件数は出力に出し、外しすぎに気づけるようにする。

	計画は notes/10_plan/p260912-01-check-public.html。
*/

import * as fs from 'node:fs';
import * as path from 'node:path';
import { parseArgs, type OptionSpec } from '../lib/args.ts';
import { detect, isValidUtf8 } from '../lib/detector.ts';
import { decode } from '../lib/codec.ts';
// 見つけ方は history2html と共有する（2 か所に書くと、片方だけが古くなる）
import { Rules, git, gitAuthor, loadWords } from '../lib/public-rules.ts';

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
	{ name: 'allow-list', kind: 'string', short: 'l' },
];

const Defaults = {
	path: '.',
	'word-list': '_public-ng-words.txt',
	all: false,
	'allow-list': 'check-public-allow.txt',
};

/*
	除外の指定（計画 i261018-02）。1 行に 1 指定で、空白で「パス 項目 語」に分ける（語は行の残り全部）。
	# で始まる行と空行は読み飛ばす。

	  ・パスは、プロジェクトからの相対（/ 区切り）。完全一致。末尾が / ならそのフォルダの下すべて
	  ・項目は --skip と同じ名前
	  ・語は、当たった行に含まれるときだけ外す（部分一致 ・ 大小を無視）。**語を空にはできない**
	    （ファイルと項目の全部を外すと、本物の鍵を見逃すため）
*/
type AllowEntry = {
	path: string;
	key: string;
	word: string;
	wordLower: string;
	count: number;
	/** 規則が返した内訳の名前ごとの件数（[認証情報] のキーワード） */
	details: Map<string, number>;
};

const ItemLabels: Record<string, string> = {
	...Object.fromEntries(Rules.map((r) => [r.key, r.label])),
	words: '除外語',
	author: 'git の author',
};

/** 読めたら指定の一覧、書式の誤りなら「ファイル名:行: 理由」 */
function loadAllow(file: string): AllowEntry[] | string {
	const name = path.basename(file);
	const entries: AllowEntry[] = [];
	const lines = fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '').split(/\r?\n/);
	for (let i = 0; i < lines.length; i++) {
		const t = lines[i].trim();
		if (t.length === 0 || t.startsWith('#')) { continue; }
		const where = name + ':' + (i + 1) + ': ';
		const m = /^(\S+)\s+(\S+)(?:\s+(.+))?$/.exec(t);
		if (m == null) { return where + '書式は「パス 項目 語」です（空白で区切る）。'; }
		const key = m[2];
		if (!Object.prototype.hasOwnProperty.call(ItemLabels, key)) {
			return where + '知らない項目名です: ' + key + '（' + Object.keys(ItemLabels).join(' ・ ') + '）';
		}
		const word = (m[3] ?? '').trim();
		if (word.length === 0) {
			return where + '語がありません。語を空にする指定は、ファイルと項目の全部を外してしまうので、受けません。';
		}
		entries.push({
			path: m[1].split('\\').join('/').replace(/^\.\//, ''),
			key, word, wordLower: word.toLowerCase(), count: 0, details: new Map(),
		});
	}
	return entries;
}

function allowMatches(e: AllowEntry, rel: string): boolean {
	return e.path.endsWith('/') ? rel.startsWith(e.path) : rel === e.path;
}

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
	write('  -l, --allow-list <パス> 誤検出を外す指定。既定は check-public-allow.txt');
	write('                          1 行に「パス 項目 語」。その行に語を含むものだけを外す');
	write('  -h, --help              この使い方を出す');
	write('');
	write('終了コードは 0（指摘なし）・ 1（指摘あり）・ 2（引数や対象の誤り）。');
	write('当たった値そのものは画面に出しません。');
}

/** git が追跡しているファイルを聞く。git の外なら null */
async function gitFiles(dir: string): Promise<string[] | null> {
	const r = await git(dir, ['-c', 'core.quotepath=false', 'ls-files']);
	if (r.status !== 0) { return null; }
	return r.stdout.split('\n').map((s) => s.trim()).filter((s) => s.length > 0);
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
	const tracked = all ? null : await gitFiles(target);
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
		authors = (await gitAuthor(target)).map((s) => s.toLowerCase());
	}

	// 誤検出を外す指定。無ければ、いままでと同じ（黙って通す。除外語リストと違い、無くても検査は弱くならない）
	const allowArg = String(parsed.values['allow-list']);
	const explicitAllow = allowArg !== Defaults['allow-list'];
	const baseDir = fs.statSync(target).isDirectory() ? target : path.dirname(target);
	const allowPath = path.isAbsolute(allowArg) ? allowArg : path.join(baseDir, allowArg);
	let allow: AllowEntry[] = [];
	if (fs.existsSync(allowPath)) {
		const loaded = loadAllow(allowPath);
		if (typeof loaded === 'string') {
			console.error('[NG] ' + loaded);
			return ExitBadArgs;
		}
		allow = loaded;
	}
	else if (explicitAllow) {
		console.error('[NG] 除外の指定のファイルがありません: ' + allowArg);
		return ExitBadArgs;
	}

	console.log('  対象: ' + files.length + ' ファイル');
	if (allow.length > 0) {
		console.log('  除外の指定: ' + allow.length + ' 件（' + path.basename(allowPath) + '）');
	}
	console.log('');

	// ---- 見る ----
	let hits = 0;
	let skipped = 0;
	let excluded = 0;

	/** 指定に当たれば外して数える（外したら true）。同じ行・同じ項目でも、指定は先に当たった 1 つだけ */
	function absorb(rel: string, key: string, lowerLine: string, detail: string | null): boolean {
		const e = allow.find((a) => a.key === key && allowMatches(a, rel) && lowerLine.includes(a.wordLower));
		if (e == null) { return false; }
		e.count++;
		excluded++;
		if (detail != null) { e.details.set(detail, (e.details.get(detail) ?? 0) + 1); }
		return true;
	}

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
					if (absorb(rel, rule.key, lower, rule.detail?.(line) ?? null)) { continue; }
					console.log('  ' + rel + ':' + (i + 1) + '  [' + rule.label + ']');
					hits++;
				}
			}

			if (words != null && words.some((w) => lower.includes(w))) {
				if (!absorb(rel, 'words', lower, null)) {
					console.log('  ' + rel + ':' + (i + 1) + '  [除外語]');
					hits++;
				}
			}

			if (authors.length > 0 && authors.some((a) => lower.includes(a))) {
				if (!absorb(rel, 'author', lower, null)) {
					console.log('  ' + rel + ':' + (i + 1) + '  [git の author]');
					hits++;
				}
			}
		}
	}

	console.log('');
	if (skipped > 0) {
		console.log('  読めなかった ' + skipped + ' ファイルは飛ばしました');
	}

	// 外した件数。外しすぎ（1 つの指定で多すぎる）にも、想定外のキーワードの混入にも気づけるように、指定ごとに出す。
	// 出す語は、設定ファイルに書かれたものと、規則に決まっているキーワードで、検査したファイルの中身ではない
	if (excluded > 0) {
		console.log('  除外した指摘: ' + excluded + ' 件');
		for (const e of allow) {
			if (e.count === 0) { continue; }
			let breakdown = '';
			if (e.details.size > 0) {
				const sorted = [...e.details.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1));
				breakdown = '（' + sorted.map(([k, n]) => k + ' ' + n).join(' ・ ') + '）';
			}
			console.log('    ' + e.path + '  [' + ItemLabels[e.key] + ']  「' + e.word + '」  ' + e.count + ' 件' + breakdown);
		}
	}
	// 1 件も外していない指定は、古くなっている。--skip で項目ごと見ていないものは、数えない
	for (const e of allow) {
		if (e.count === 0 && skip.indexOf(e.key) < 0) {
			console.log('  ⚠️ 使われていない除外の指定: ' + e.path + '  [' + ItemLabels[e.key] + ']  「' + e.word + '」');
		}
	}
	// 外した件数は、見出しにも添える（指摘が 0 でも、外したものがあったことが分かる）
	const tail = excluded > 0 ? '（除外 ' + excluded + ' 件）===' : ' ===';

	if (hits === 0) {
		console.log('');
		console.log('=== 指摘はありません' + tail);
		return 0;
	}

	console.log('=== ' + hits + ' 件の指摘があります' + tail);
	console.log('');
	console.log('値そのものは出していません。場所を頼りに中身を見てください。');
	return ExitFound;
}

main().then((code) => process.exit(code));
