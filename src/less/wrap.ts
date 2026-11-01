/*
	less の折り返し。端末の桁数を超える長い行を、端末が使う 1 行ずつ（画面行）に
	先に分けておく。端末は桁数を超えた行を自動で 2 行以上に折り返すため、
	「論理行 1 つ＝画面 1 行」のまま行番号とカーソル位置を計算すると、以降がずれる。

	計画: notes/10_plan/i260917-01-less.html（長い行の折り返し、B 案）
*/

/** 表示幅の数え方（ASCII・半角ｶﾀｶﾅは 1 桁、それ以外は 2 桁。実機で確認済み） */
function charWidth(ch: string): number {
	const c = ch.codePointAt(0) ?? 0;
	return (c < 0x80 || (c >= 0xff61 && c <= 0xff9f)) ? 1 : 2;
}

/**
 * 表示幅を数える。
 * 手でスペースを数えて決め打ちすると、ラベルを変えたときに数え直しを
 * 忘れて桁がずれる（実際に踏んだ。共通ルール「全角・半角混在のテキストを
 * 桁揃えするとき」を参照）
 */
export function displayWidth(s: string): number {
	let w = 0;
	for (const ch of s) { w += charWidth(ch); }
	return w;
}

/** TAB を広げる桁の区切り（端末の既定） */
const TabStop = 8;

/**
 * 1 つの論理行を、桁数 columns に収まる画面行に分ける。
 * ・ちょうど桁数まで入る行は折り返さない（端末は、行末ちょうどのあとに改行が来ても、
 *   1 行分しか進めない）
 * ・右端に 1 桁しか残っていない所へ 2 桁文字が来るときは、その 1 桁へ空白を入れて
 *   折り返す（端末が「置けない文字は次の行へ送る」のと同じになり、文字が分断されない）
 * ・TAB は、8 桁の区切りまでの空白に広げる。桁数を超えて広げることはしない
 */
function wrapLine(line: string, columns: number): string[] {
	const rows: string[] = [];
	let cur = '';
	let width = 0;
	for (const ch of line) {
		if (ch === '\t') {
			if (width >= columns) { rows.push(cur); cur = ''; width = 0; }
			const w = Math.min(TabStop - (width % TabStop), columns - width);
			cur += ' '.repeat(w);
			width += w;
			continue;
		}
		const w = charWidth(ch);
		if (width + w > columns) {
			if (width < columns) { cur += ' '; }
			rows.push(cur);
			cur = '';
			width = 0;
		}
		cur += ch;
		width += w;
	}
	rows.push(cur);
	return rows;
}

/**
 * 論理行の並びを、画面行の並びにする。空行も 1 行として残る。
 * 2 桁文字が 1 つも置けない桁数にならないよう、桁数は 2 以上に直す
 */
export function wrapLines(lines: string[], columns: number): string[] {
	const cols = Math.max(2, columns);
	const rows: string[] = [];
	for (const line of lines) { rows.push(...wrapLine(line, cols)); }
	return rows;
}

/** 改行が無いまま終わるときに、最後の行の後ろへ付ける文字（反転表示の記号は含まない） */
export const EofSuffix = ' [改行なし] [EOF]';

/**
 * [EOF] ・ [改行なし] を、どこに出すか。
 * ・改行ありで終わる → 実データの後ろに続く別の 1 行（仮想行）
 * ・改行なしで終わり、最後の画面行に収まる → その行の後ろ（inline）
 * ・改行なしで終わり、収まらない → はみ出すと端末が折り返して画面行の数が狂うため、別の 1 行
 */
export function eofPlacement(rows: string[], columns: number, hasTrailingNewline: boolean): { inline: boolean; extra: boolean } {
	if (hasTrailingNewline || rows.length === 0) { return { inline: false, extra: true }; }
	const fits = displayWidth(rows[rows.length - 1]) + displayWidth(EofSuffix) <= columns;
	return fits ? { inline: true, extra: false } : { inline: false, extra: true };
}
