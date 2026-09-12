/*
	コマンドラインのオプションを読む。

	6 つの道具で形を揃えるために置いた。Linux 風の 3 つを受ける。

	  ・長い形     --path <値> ・ --recurse
	  ・短い形     -p <値>     ・ -r
	  ・位置引数   名前を付けずに置いた対象

	別名も受けられる。check-contrast ・ check-markdown は以前 PowerShell 流の
	-Path 形式だったため、移行のあいだ古い形も通す。

	**知らないオプションは黙って無視しない。**呼び手の書き誤りを既定値で
	走らせると、対象が違うまま「問題なし」と出る。
*/

/**
 * list は同じオプションを何度でも受ける（`--skip a --skip b`）。
 * 値は配列になる。html2md の --dir ・ --exclude と同じ扱い。
 */
export type OptionKind = 'string' | 'number' | 'boolean' | 'list';

export type OptionSpec = {
	/** 長い形の名前。`--path` なら 'path' */
	name: string;
	kind: OptionKind;
	/** 短い形 1 文字。`-p` なら 'p' */
	short?: string;
	/** そのまま受ける別名（`-Path` など）。先頭のハイフンも含めて書く */
	aliases?: string[];
	/** 位置引数をこのオプションとして受ける。1 つだけ指定できる */
	positional?: boolean;
};

export type OptionValue = string | number | boolean | string[];

export type ParsedArgs = {
	values: Record<string, OptionValue>;
	/** 読めなかったときの理由。あれば呼び手は 2 で止める */
	error?: string;
	/** --help ・ -h が来た */
	help: boolean;
};

function matches(spec: OptionSpec, token: string): boolean {
	if (token === '--' + spec.name) { return true; }
	if (spec.short != null && token === '-' + spec.short) { return true; }
	if (spec.aliases != null && spec.aliases.indexOf(token) >= 0) { return true; }
	return false;
}

export function parseArgs(argv: string[], specs: OptionSpec[], defaults: Record<string, OptionValue>): ParsedArgs {
	const values: Record<string, OptionValue> = { ...defaults };
	// list は既定の配列をそのまま使わない。呼び出しごとに新しくする
	for (const s of specs) {
		if (s.kind === 'list') { values[s.name] = []; }
	}
	const positionalSpec = specs.find((s) => s.positional === true);

	let i = 0;
	while (i < argv.length) {
		const token = argv[i];

		if (token === '--help' || token === '-h') {
			return { values, help: true };
		}

		const spec = specs.find((s) => matches(s, token));
		if (spec != null) {
			if (spec.kind === 'boolean') {
				values[spec.name] = true;
				i += 1;
				continue;
			}
			if (i + 1 >= argv.length) {
				return { values, help: false, error: token + ' に値がありません。' };
			}
			const raw = argv[i + 1];
			if (spec.kind === 'list') {
				(values[spec.name] as string[]).push(raw);
			}
			else if (spec.kind === 'number') {
				const n = Number(raw);
				if (!Number.isFinite(n)) {
					return { values, help: false, error: token + ' には数を渡してください: ' + raw };
				}
				values[spec.name] = n;
			}
			else { values[spec.name] = raw; }
			i += 2;
			continue;
		}

		if (token.startsWith('-')) {
			return { values, help: false, error: '知らないオプションです: ' + token };
		}

		// ハイフンで始まらないものは位置引数
		if (positionalSpec == null) {
			return { values, help: false, error: '余分な引数です: ' + token };
		}
		values[positionalSpec.name] = token;
		i += 1;
	}

	return { values, help: false };
}
