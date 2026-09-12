// check-public の検査を TypeScript で書いた見積もり用の実装。
// 条件は bench.js と同じ（同じフォルダ・同じ拡張子・同じ 4 つの正規表現）で、
// 型注釈だけを足してある。Bun と Node がそのまま .ts を走らせられるかを見る。

import fs from 'node:fs';
import path from 'node:path';

const EXTS: string[] = ['.cs', '.ps1', '.md', '.html', '.cmd', '.txt', '.json', '.js'];
const SKIP_DIRS: string[] = ['.git', 'tmp', 'etc', 'node_modules'];

const PATTERNS: RegExp[] = [
	// 1. メールアドレス
	/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/,
	// 2. C:\Users\ の直後がプレースホルダでないもの
	/[Cc]:\\Users\\(?!<|%|\$)[A-Za-z0-9._-]+/,
	// 3. 認証情報に値が続くもの
	/(password|passwd|secret|api_key|token)\s*[:=]\s*[^\s"'<$%{]{4,}/i,
	// 5. 日本語・英数字の並びに混ざったキリル・ハングル
	/[\u0400-\u04FF\uAC00-\uD7AF]/,
];

function* walk(root: string): Generator<string> {
	const dirs: string[] = [root];
	while (dirs.length > 0) {
		const dir = dirs.pop() as string;
		if (SKIP_DIRS.indexOf(path.basename(dir)) >= 0) continue;
		for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
			const full = path.join(dir, e.name);
			if (e.isDirectory()) { dirs.push(full); continue; }
			if (EXTS.indexOf(path.extname(e.name).toLowerCase()) >= 0) yield full;
		}
	}
}

function main(): void {
	const root: string | undefined = process.argv[2];
	if (!root) {
		console.error('使い方: bench.ts <対象フォルダ>');
		process.exit(2);
	}
	const start = process.hrtime.bigint();

	let files = 0;
	let lines = 0;
	let hits = 0;

	for (const f of walk(root)) {
		files++;
		const text: string[] = fs.readFileSync(f, 'utf8').split(/\r?\n/);
		for (const line of text) {
			lines++;
			for (const re of PATTERNS) {
				if (re.test(line)) hits++;
			}
		}
	}

	const ms = Number((process.hrtime.bigint() - start) / 1000000n);
	console.log('files=' + files + ' lines=' + lines + ' hits=' + hits + ' inner_ms=' + ms);
}

main();
