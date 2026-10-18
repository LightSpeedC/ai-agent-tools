/*
	公開してはいけないものの見つけ方。

	check-public（公開前の検査）と history2html（会話ログの伏せ字）の両方が使う。
	**2 か所に書くと、片方だけが古くなる。**見つけ方を変えるときはここだけを直す。

	当たった値そのものを画面に出さないのは、呼ぶ側の責任。
*/

import { spawn } from 'node:child_process';
import * as fs from 'node:fs';

export type Rule = {
	/** --skip で名指しする名前 */
	key: string;
	label: string;
	test: (line: string) => boolean;
	/**
	 * 当たったときの内訳の名前（任意）。**規則に決まっている固定の語に限る**（当たった値は返さない）。
	 * check-public の除外の件数に、内訳として出す（i261018-02）
	 */
	detail?: (line: string) => string | null;
};

/*
	伏せ字と変数参照は当てない。
	これらを拾うと、正しく伏せた資料ほど指摘が増えて道具が使われなくなる。
*/
export function isPlaceholder(s: string): boolean {
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
export function looksLikeSecret(value: string): boolean {
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
export const MailAllow = ['example.com', 'example.org', 'example.net', 'noreply@'];

/** メールアドレスの形 */
export const MailPattern = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;

export function isAllowedMail(address: string): boolean {
	const a = address.toLowerCase();
	return MailAllow.some((w) => a.includes(w));
}

/** 囲まずに伏せ字として書かれる語。C:\Users\username\ の形で資料によく出る */
export const PathPlaceholders = ['username', 'user', 'yourname', 'name', '<name>', 'me'];

/*
	ユーザープロファイルの実体パス。1 つ目の組が名前。

	区切りは重なってもよい。コードや JSON の中では `\` が 2 つになる（`C:\\Users\\…`）。
	Bash の形（`/c/Users/…` ・ `/mnt/c/Users/…`）も見る。
	**1 つの形しか見ていないと、会話ログのパスが黙って漏れる。**
*/
export const UserPathPattern = /(?:\b[A-Za-z]:|(?<![A-Za-z0-9_])\/(?:mnt\/)?[a-z])[\\/]+Users[\\/]+([A-Za-z0-9][A-Za-z0-9._-]*)/g;

/** 伏せ字でない実体パスを含むか */
export function hasUserPath(line: string): boolean {
	for (const m of line.matchAll(UserPathPattern)) {
		if (PathPlaceholders.indexOf(m[1].toLowerCase()) < 0) { return true; }
	}
	return false;
}

/** 認証情報が続く語と、その値 */
export const SecretPattern = /(password|passwd|secret|api[_-]?key|token)\s*[:=]=*\s*(\S+)/i;

/**
 * 当たったキーワードの名前。小文字に寄せ、api-key ・ apikey は api_key にまとめる。
 * 返すのは規則の語（password ・ passwd ・ secret ・ api_key ・ token）だけで、値は返さない
 */
export function secretKeyword(line: string): string | null {
	const m = line.match(SecretPattern);
	if (m == null) { return null; }
	const kw = m[1].toLowerCase();
	return /^api[_-]?key$/.test(kw) ? 'api_key' : kw;
}

export const Rules: Rule[] = [
	{
		key: 'mail',
		label: 'メールアドレス',
		test: (line) => {
			const m = line.match(MailPattern);
			if (m == null) { return false; }
			return m.some((a) => !isAllowedMail(a));
		},
	},
	{
		key: 'path',
		label: '実体パス',
		/*
			直後が英数字で始まるものだけを見る。
			`C:\Users\` とだけ書いた説明文（直後が引用符や空白）は当たらない。
			<username> ・ %USERNAME% ・ &lt;伏せ&gt; も先頭の記号ではじかれる
		*/
		test: (line) => hasUserPath(line),
	},
	{
		key: 'secret',
		label: '認証情報',
		test: (line) => {
			// === ・ == は比較であって代入ではない。値の側だけを見る
			const m = line.match(SecretPattern);
			if (m == null) { return false; }
			return looksLikeSecret(m[2]);
		},
		detail: (line) => secretKeyword(line),
	},
	{
		key: 'script',
		label: '異体字',
		// 日本語・英数字の並びに混ざったキリル・ハングル
		test: (line) => /[\u0400-\u04FF\uAC00-\uD7AF]/.test(line),
	},
];

/** 伏せる語のリストを読む。1 行 1 語。空行と # は読み飛ばし、小文字に寄せる。無ければ null */
export function loadWords(file: string): string[] | null {
	if (!fs.existsSync(file)) { return null; }
	const text = fs.readFileSync(file, 'utf8');
	return text.split(/\r?\n/)
		.map((s) => s.trim())
		.filter((s) => s.length > 0 && !s.startsWith('#'))
		.map((s) => s.toLowerCase());
}

/*
	git を走らせて標準出力を受け取る。

	**同期版（spawnSync）は使わない。**返るまでこのプロセスの非同期処理が
	1 つも進まないため。git はすぐ返るが、同期で書くと形が揃わない。

	標準入力はすぐ閉じる。閉じないと、相手が入力を待って止まったままになる
	（資格情報の入力を求められる場面がある）。
*/
export function git(dir: string, args: string[]): Promise<{ status: number | null; stdout: string }> {
	return new Promise((resolve) => {
		const child = spawn('git', ['-C', dir, ...args]);
		let stdout = '';
		child.stdin.end();
		child.stdout.setEncoding('utf8');
		child.stdout.on('data', (d: string) => { stdout += d; });
		// 標準エラーは読み捨てる。git の外で走らせたときの案内が出るだけ
		child.stderr.on('data', () => { });
		child.on('error', () => { resolve({ status: null, stdout: '' }); });
		child.on('close', (code: number | null) => { resolve({ status: code, stdout }); });
	});
}

/** git の author（名前とアドレス）。設定が無ければ空 */
export async function gitAuthor(dir: string): Promise<string[]> {
	const out: string[] = [];
	for (const key of ['user.name', 'user.email']) {
		const r = await git(dir, ['config', key]);
		if (r.status === 0) {
			const v = r.stdout.trim();
			if (v.length > 0) { out.push(v); }
		}
	}
	return out;
}
