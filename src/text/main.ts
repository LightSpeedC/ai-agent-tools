/*
	text — 文字コード対応テキスト・ツール一式。
	text read | find | edit | write | replace のサブコマンドに振り分ける。

	終了コード:
	  0 成功 / 1 find ・ replace 一致なし / 2 エラー / 3 両方妥当で拒否
	  4 合言葉不一致 / 5 変換先で表現できない文字 / 6 replace の件数が --expect と違う
*/

import { ToolError } from './engine.ts';
import { err, out } from './files.ts';
import * as readCmd from './read.ts';
import * as findCmd from './find.ts';
import * as editCmd from './edit.ts';
import * as writeCmd from './write.ts';
import * as replaceCmd from './replace.ts';

const TopHelp = [
	'text <read|find|edit|write|replace> — 文字コード対応のテキスト操作',
	'  サブコマンドごとの使い方: text <read|find|edit|write|replace> --help',
];

/*
	サブコマンドの使い方。--help ・ -h を、サブコマンドの直後に置いたときだけ受ける
	（後ろに置くと --new "--help" のような値と区別できないため）。
*/
const SubHelp: Record<string, string[]> = {
	read: [
		'text read <ファイル> [--lines A-B] [--from <組>] [--no-number]',
		'  何であろうと読み、UTF-8 で見せる。先頭の ◆ 行に組・サイズ・更新日時・合言葉（digest）',
		'  --lines A-B    範囲を絞る（B が全行数を超えたら最後の行まで）',
		'  --from <組>    文字コードの組を明示する（判定で決まらないとき）',
		'  --no-number    ◆ 行と行番号を付けず、中身だけを出す',
	],
	find: [
		'text find <検索語> [<パス>] [--path <パス>] [-r] [-i] [--include <glob,…>] [--exclude <glob,…>]',
		'          [--exclude-dir <名前,…>] [--no-default-exclude] [--from <組>] [--bare] [--regex]',
		'  文字コードを問わず素の文字列を探す。見つからなければ終了コード 1',
		'  -r, --recurse          下の階層も探す（付けないと直下だけ）',
		'  -i, --ignore-case      大小を区別しない',
		'  --regex                検索語を正規表現として読む（JavaScript の書き方。行ごとに当てる）',
		'  --include / --exclude  対象のファイル名（カンマ区切りの glob）',
		'  --exclude-dir          外すフォルダ。既定で tmp ・ etc ・ node_modules ・ .git を外す',
		'  --no-default-exclude   既定の除外をやめる',
		'  --bare                 grep と同じ 1 行 1 件の形で出す',
	],
	edit: [
		'text edit <ファイル> (--old <文字列> | --old-file <パス> | --lines A-B)',
		'          (--new <文字列> | --new-file <パス>) [--lines A-B] [--digest <合言葉>] [--from <組>]',
		'  元の文字コード ・ 改行のまま、一部を置き換える',
		'  --old / --old-file    置き換える箇所。1 か所にだけ一致すること（--lines で範囲を絞れる）',
		'  --new / --new-file    置き換える中身',
		'  --lines A-B           範囲。--old が無ければ範囲まるごとを置き換える',
		'  --digest <合言葉>     read で出た digest。食い違えば終了コード 4（別の人が更新した）',
		'  --from <組>           文字コードの組を明示する',
	],
	replace: [
		'text replace <検索語> <置き換える文字列> [<パス>] [--path <パス>] [-r] [-i] [--regex]',
		'             [--include <glob,…>] [--exclude <glob,…>] [--exclude-dir <名前,…>] [--no-default-exclude]',
		'             [--dry-run] [--expect <件数>] [--from <組>]',
		'  複数のファイルにまたがって、一致を全部置き換える。文字コード ・ BOM ・ 改行は元のまま',
		'  ファイルの選び方は text find と同じ。ファイルごとの件数と合計を出す',
		'  --regex          検索語を正規表現として読む。置き換える側で $1 ・ $& ・ $<名前> ・ $$ を使える',
		'  -i               大小を区別しない',
		'  --dry-run        書き換えず、件数と、変わる行の前 (-) と後 (+) を出す',
		'  --expect <件数>  合計がこの件数でなければ、どのファイルも書き換えない（終了コード 6）',
		'  一致が 0 件なら終了コード 1。表せない文字があれば、どのファイルも書き換えない（終了コード 5）',
	],
	write: [
		'text write <ファイル> (--to <用途> | --keep) [<中身> | --in <パス> | 標準入力] [--from <組>]',
		'  全文を書く',
		'  --to <用途>    用途名で文字コードと改行を決める（convert-encoding の --to と同じ）',
		'  --keep         既存ファイルの組のまま書く',
		'  --in <パス>    中身をファイルから読む。第 2 引数でも、空でない標準入力でも渡せる',
		'  --from <組>    --keep のとき、既存ファイルの組を明示する',
	],
};

function main(argv: string[]): number {
	if (argv.length === 0) {
		err('使い方: text <read|find|edit|write> ...');
		return 2;
	}

	const verb = argv[0];
	const rest = argv.slice(1);

	if (SubHelp[verb] !== undefined && (rest[0] === '--help' || rest[0] === '-h')) {
		for (const l of SubHelp[verb]) { out(l); }
		return 0;
	}

	try {
		switch (verb) {
			case 'read': return readCmd.run(rest);
			case 'find': return findCmd.run(rest);
			case 'edit': return editCmd.run(rest);
			case 'write': return writeCmd.run(rest);
			case 'replace': return replaceCmd.run(rest);
			case '-h':
			case '--help':
				for (const l of TopHelp) { out(l); }
				return 0;
			default:
				err('不明なサブコマンドです: ' + verb);
				return 2;
		}
	} catch (e) {
		if (e instanceof ToolError) {
			err(e.message);
			return e.code;
		}
		err('エラー: ' + (e as Error).message);
		return 2;
	}
}

process.exit(main(process.argv.slice(2)));
