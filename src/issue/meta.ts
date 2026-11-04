/*
	課題ファイルのメタ情報 (F2: 「キー: 値」の行) を読む。
	仕様は notes/50_spec/課題ファイルの形と検査.html、決めた経緯は計画 p261103-01。

	YAML の部分集合に絞った自作の形で、パーサは使わない。
	引用符 ・ コメント ・ 複数行 ・ 入れ子は無い。最初の「: 」で分け、値の前後の空白を除く。
*/

/**
 * メタ情報のキーの順（仕様のキー項目の表の順）。CLI はこの順で書く。
 * 状態 (state) は持たない。状態は置いてあるフォルダで決まる (計画 p261103-01 の 126-A)
 */
export const KeyOrder = ['schema', 'id', 'title', 'group', 'created', 'from', 'confirmed', 'refs'] as const;

/** 状態の 3 段階。やること (- [未] 等) の状態に使う */
export const States = ['未', '着手', '済'] as const;

export type Pair = { key: string; value: string; line: number };

export type Parsed = {
	pairs: Pair[];
	/** 形の誤りの説明（「N 行目: …」）。1 件でもあれば、その行は pairs に入らない */
	problems: string[];
	/** 値が空・重複で pairs に入らなかったキー。必須キーの不足と二重に報告しないための印 */
	brokenKeys: Set<string>;
};

const PairLine = /^([a-z][a-z0-9_]*):(?: (.*))?$/;

/**
 * 「キー: 値」の行の並びを読む。
 * @param lines 行（改行は除いてある）
 * @param firstLine 先頭の行が、ファイルの何行目か（説明に使う）
 */
export function parsePairs(lines: string[], firstLine: number): Parsed {
	const pairs: Pair[] = [];
	const problems: string[] = [];
	const brokenKeys = new Set<string>();
	const seen = new Set<string>();
	lines.forEach((raw, index) => {
		const line = firstLine + index;
		if (raw === '') {
			problems.push(`${line} 行目: 空行は置けない`);
			return;
		}
		const m = PairLine.exec(raw);
		if (m === null) {
			problems.push(`${line} 行目: 「キー: 値」の形でない`);
			return;
		}
		const key = m[1];
		const value = (m[2] ?? '').trim();
		if (value === '') {
			problems.push(`${line} 行目: ${key} の値が空`);
			brokenKeys.add(key);
			return;
		}
		if (seen.has(key)) {
			problems.push(`${line} 行目: ${key} が重複している`);
			brokenKeys.add(key);
			return;
		}
		seen.add(key);
		pairs.push({ key, value, line });
	});
	return { pairs, problems, brokenKeys };
}

export type IssueParts = {
	/** 先頭の「---」が無い・閉じが無いとき true。キーや値の検査には進まない */
	broken: boolean;
	parsed: Parsed;
	/** 閉じの「---」より後ろ */
	body: string;
	/** body の先頭の行が、ファイルの何行目か */
	bodyFirstLine: number;
	/** 構造の誤りの説明（broken のときだけ） */
	problems: string[];
};

/** 課題ファイルの中身（改行は LF に直してある）を、メタ情報と本文に分ける */
export function splitIssue(text: string): IssueParts {
	const empty: Parsed = { pairs: [], problems: [], brokenKeys: new Set<string>() };
	const lines = text.split('\n');
	if (lines[0] !== '---') {
		return { broken: true, parsed: empty, body: '', bodyFirstLine: 1, problems: ['先頭の行が --- でない'] };
	}
	const end = lines.indexOf('---', 1);
	if (end < 0) {
		return { broken: true, parsed: empty, body: '', bodyFirstLine: 1, problems: ['閉じの --- が無い'] };
	}
	return {
		broken: false,
		parsed: parsePairs(lines.slice(1, end), 2),
		body: lines.slice(end + 1).join('\n'),
		bodyFirstLine: end + 2,
		problems: [],
	};
}
