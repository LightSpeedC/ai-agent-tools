/*
	text — 文字コード対応テキスト・ツール一式。
	text read | find | edit | write のサブコマンドに振り分ける。

	終了コード:
	  0 成功 / 1 find 一致なし / 2 エラー / 3 両方妥当で拒否
	  4 合言葉不一致 / 5 変換先で表現できない文字

	C# 版（src/TextCs/Program.cs）の移植。
*/

import { ToolError } from './engine.ts';
import { err, out } from './files.ts';
import * as readCmd from './read.ts';
import * as findCmd from './find.ts';
import * as editCmd from './edit.ts';
import * as writeCmd from './write.ts';

function main(argv: string[]): number {
	if (argv.length === 0) {
		err('使い方: text <read|find|edit|write> ...');
		return 2;
	}

	const verb = argv[0];
	const rest = argv.slice(1);

	try {
		switch (verb) {
			case 'read': return readCmd.run(rest);
			case 'find': return findCmd.run(rest);
			case 'edit': return editCmd.run(rest);
			case 'write': return writeCmd.run(rest);
			case '-h':
			case '--help':
				out('text <read|find|edit|write> — 文字コード対応のテキスト操作');
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
