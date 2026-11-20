/*
	課題ファイルのメタ情報 (F2: 「キー: 値」の行) を読む。
	仕様は notes/50_spec/課題ファイルの形と検査.html、決めた経緯は計画 p261103-01。

	YAML の部分集合に絞った自作の形で、パーサは使わない。
	引用符 ・ コメント ・ 入れ子は無い。最初の「: 」で分け、値の前後の空白を除く。
	複数行は「キー: |」の塊だけ (次の行から 2 字下げ。課題 i261117-03 の決定 269-A)。
*/

/**
 * メタ情報のキーの順（仕様のキー項目の表の順）。CLI はこの順で書く。
 * 状態 (state) は持たない。状態は置いてあるフォルダで決まる (計画 p261103-01 の 126-A)
 */
export const KeyOrder = ['schema', 'id', 'title', 'group', 'created', 'started', 'done', 'from', 'confirmed', 'refs', 'version', 'released', 'kind', 'note'] as const;

/**
 * 着手にした日時 ・ 済にした日時 (課題 i261120-01。決定 278-A ・ 279-A)。yyyy-mm-dd hh:mm (JST)。
 * issue set --state が書く。issue set --started ・ --done でも書ける (決定 285-A)
 */
export const StampKeys = ['started', 'done'] as const;

/**
 * issue set で書ける 4 つの鍵 (課題 i261117-03。決定 270-A: refs の後ろに、この順で置く)。
 * 入った版 ・ 入った日時 ・ 種別 ・ 利用者向けの説明 (1〜3 行。複数行は | の塊)
 */
export const FieldKeys = ['version', 'released', 'kind', 'note'] as const;

/** released の形 (決定 272-B): yyyy-mm-dd hh:mm。実在する日時だけ */
export function isRealDateTime(text: string): boolean {
	const m = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2})$/.exec(text);
	if (m === null) return false;
	const y = Number(m[1]);
	const mo = Number(m[2]);
	const d = Number(m[3]);
	if (Number(m[4]) > 23 || Number(m[5]) > 59) return false;
	const date = new Date(Date.UTC(y, mo - 1, d));
	return date.getUTCFullYear() === y && date.getUTCMonth() === mo - 1 && date.getUTCDate() === d;
}

/**
 * 鍵に書く行 (「鍵: 値」か、| の塊) を作る (決定 269-A)。
 * 1 行で、前後に空白が無く、| で始まらない値は 1 行で書く。そうでなければ、次の行から 2 字下げの塊にする。
 * 塊の中の空行は、空行のまま書く (読むときは、2 字の空白だけの行も受ける)。値の末尾の改行と空白は落とす
 */
export function fieldLines(key: string, value: string): string[] {
	const v = value.replace(/\r\n?/g, '\n').replace(/\s+$/, '');
	if (!v.includes('\n') && v === v.trim() && !v.startsWith('|')) return [`${key}: ${v}`];
	return [`${key}: |`, ...v.split('\n').map((l) => (l === '' ? '' : '  ' + l))];
}

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
	for (let index = 0; index < lines.length; index++) {
		const raw = lines[index];
		const line = firstLine + index;
		if (raw === '') {
			problems.push(`${line} 行目: 空行は置けない`);
			continue;
		}
		const m = PairLine.exec(raw);
		if (m === null) {
			problems.push(`${line} 行目: 「キー: 値」の形でない`);
			continue;
		}
		const key = m[1];
		let value = (m[2] ?? '').trim();
		// 「キー: |」は塊。次の行から、2 字下げの行が続く間が値 (決定 269-A)
		if (value === '|') {
			// 塊の中の空行は、空行のままでも読む (末尾の空白を消すエディタを通っても壊れない)。
			// 空行は、そのあとに 2 字下げの行が続くときだけ塊に含める (塊のあとの空行は、塊に含めない)
			const block: string[] = [];
			for (;;) {
				let next = index + 1;
				while (next < lines.length && lines[next] === '') next++;
				if (next >= lines.length || !lines[next].startsWith('  ')) break;
				for (let k = index + 1; k <= next; k++) block.push(lines[k].slice(2));
				index = next;
			}
			value = block.join('\n');
		}
		if (value === '') {
			problems.push(`${line} 行目: ${key} の値が空`);
			brokenKeys.add(key);
			continue;
		}
		if (seen.has(key)) {
			problems.push(`${line} 行目: ${key} が重複している`);
			brokenKeys.add(key);
			continue;
		}
		seen.add(key);
		pairs.push({ key, value, line });
	}
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
