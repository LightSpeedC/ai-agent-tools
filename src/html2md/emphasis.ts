/*
	強調の記法を最終段で決める。

	<strong> をそのまま ** にすると、日本語では前後の文字によって
	記号のまま表示されることがある（CommonMark の開閉判定）。
	いったんセンチネル（本文に現れない制御文字）で囲んでおき、
	本文が組み上がってから ** かタグかを決める。
*/

/** 強調の開始。本文に現れない制御文字を使う */
export const StrongBegin = '';
export const StrongEnd = '';
export const EmBegin = '';
export const EmEnd = '';
/** タグ除去で消えないよう <br> を退避する */
export const Break = '';
/** 取り消し線。~~ も ** と同じ前後判定を受けるため記法を最終段で決める */
export const DelBegin = '';
export const DelEnd = '';
/**
 * 退避した文字列の閉じ。開きと別の文字にする。
 *
 * 両端を同じ文字にすると、あるキーの閉じ・本文の数字・次のキーの開きが並んだときに
 * 偽のキーができる。2<sup>10</sup> が別の退避内容に置き換わっていた。
 *
 * センチネルに使えるのは \s にマッチしない制御文字だけ。本文は最後に空白を
 * まとめるため、\t \n \v \f \r（9〜13）を使うとキーが空白に置き換わって壊れる。
 */
export const StoreEnd = '';
/**
 * アイコンだけのリンクを表す「<<」（前へ）を退避する。そのまま置くと、
 * 後ろに現れる「>」と組んで汎用タグ除去に飲まれる（i260912-05）。
 */
export const IconPrev = '';
/** 退避した文字列の開き（中身を他の変換の対象から外す） */
export const CodeSpan = '';

/** センチネルのペア（内側にセンチネルを含まないもの） */
const InnermostPair = /[\x01\x03\x06]([^\x01-\x04\x06\x08]*)[\x02\x04\x08]/;

/** 強調の種類。開きと閉じで一致しなければ記法にしない */
const KindNone = 0;
const KindStrong = 1;
const KindEm = 2;
const KindDel = 3;

function kindOfBegin(c: string): number {
	if (c === StrongBegin) { return KindStrong; }
	if (c === EmBegin) { return KindEm; }
	if (c === DelBegin) { return KindDel; }
	return KindNone;
}

function kindOfEnd(c: string): number {
	if (c === StrongEnd) { return KindStrong; }
	if (c === EmEnd) { return KindEm; }
	if (c === DelEnd) { return KindDel; }
	return KindNone;
}

function markOf(kind: number): string {
	if (kind === KindStrong) { return '**'; }
	if (kind === KindEm) { return '*'; }
	return '~~';
}

/** 記法の区切りに使う1文字（strong・em は *、del は ~） */
function markChar(kind: number): string {
	return kind === KindDel ? '~' : '*';
}

/**
 * 中身の先頭・末尾がマーク文字そのものだと、記号が3つ以上並んで
 * 曖昧になる（<strong>*重要*</strong> を ** で囲むと ***重要*** になる）。
 * 境界の1文字だけ \ でエスケープする。内側（境界以外）はそのまま
 * （そこは元々曖昧にならない）。
 */
function escapeMarkBoundary(inner: string, ch: string): string {
	if (inner.length === 0) { return inner; }
	let s = inner;
	if (s[0] === ch) { s = '\\' + s; }
	if (s[s.length - 1] === ch && s[s.length - 2] !== '\\') { s = s.slice(0, -1) + '\\' + ch; }
	return s;
}

function tagOf(kind: number): string {
	if (kind === KindStrong) { return 'strong'; }
	if (kind === KindEm) { return 'em'; }
	return 'del';
}

/**
 * GitHub が強調の開閉の判定で句読点として扱う文字か。
 * ASCII の記号すべて（!"#$%&'()*+,-./:;<=>?@[\]^_`{|}~）と、Unicode の P 系だけ。
 * **Unicode の S 系（⬜ ✅ ❌ ⚠ → 等）は句読点に入れない。**GitHub で実測すると、
 * 閉じの ** の直後が ⬜ ・ ✅ ・ → だと太字にならず ** が残った（「 なら太字になる）。
 * S 系を句読点に入れていたため、句点で閉じた太字の直後にバッジが来ると ** が効くと誤った（i261009-01）
 */
const PunctRe = /[!-/:-@[-`{-~\p{Pc}\p{Pd}\p{Ps}\p{Pe}\p{Pi}\p{Pf}\p{Po}]/u;

export function isPunct(c: string): boolean {
	return PunctRe.test(c);
}

function isWhiteSpace(c: string): boolean {
	return /\s/.test(c);
}

/** text の start から length 文字を ** で囲めるか */
export function canEmphasize(text: string, start: number, length: number): boolean {
	if (length <= 0) { return false; }
	// 行頭・行末は空白として扱う（CommonMark の規定）
	const before = start > 0 ? text[start - 1] : ' ';
	const after = (start + length < text.length) ? text[start + length] : ' ';
	const first = text[start];
	const last = text[start + length - 1];

	// 開き側
	if (isWhiteSpace(first)) { return false; }
	if (isPunct(first) && !(isWhiteSpace(before) || isPunct(before))) { return false; }

	// 閉じ側
	if (isWhiteSpace(last)) { return false; }
	if (isPunct(last) && !(isWhiteSpace(after) || isPunct(after))) { return false; }

	return true;
}

/** センチネルで囲んだ強調を、内側から順に ** かタグに確定させる */
export function resolve(text: string): string {
	return resolveInner(text, false);
}

/**
 * HTML ブロックの中に置く文字列の強調を、前後の文字を見ずにタグで確定させる。
 *
 * CommonMark は HTML ブロックの中身を生の HTML として扱い、インラインの記法を
 * 解釈しない。<summary> の行は <details> から続く 1 つの HTML ブロックの
 * 中にあるため、そこに ** を置くと記号のまま表示される（GitHub のレンダラで実測）。
 *
 * 前後の文字に依存しないので、本文が組み上がるのを待たずにここで確定させてよい。
 */
export function resolveAsTags(text: string): string {
	return resolveInner(text, true);
}

function resolveInner(text: string, forceTags: boolean): string {
	let t = text;
	for (;;) {
		const m = InnermostPair.exec(t);
		if (m == null) { break; }

		const idx = m.index;
		const len = m[0].length;
		const openKind = kindOfBegin(t[idx]);
		const closeKind = kindOfEnd(t[idx + len - 1]);
		const raw = m[1];
		const inner = raw.trim();
		const prefix = t.substring(0, idx);
		const suffix = t.substring(idx + len);

		if (inner.length === 0) {
			t = prefix + suffix;
			continue;
		}

		// 前後の空白は記法の外側へ出す。** の内側は前後に空白を置けない
		// （CommonMark の規定）ので trim 自体は要るが、そのまま捨てると
		// 前後の語と強調テキストがくっついて見える
		// （例: <strong>a </strong>b が **a**b になり空白が消える）
		const leadWs = raw.substring(0, raw.length - raw.trimStart().length);
		const trailWs = raw.substring(raw.trimEnd().length);

		// 同じ種類の強調がそのまま入れ子になっている場合（バッジが strong の
		// 先頭に来るときなど）。直前・直後に同じ種類の生のセンチネルがまだ
		// 残っているなら、ここでは記法を確定させず中身だけを残す。外側の
		// ペアが次の周で解決するとき、まとめて 1 組の記法になる。
		const touchesOuterSameKind =
			(idx > 0 && kindOfBegin(t[idx - 1]) === openKind) ||
			(idx + len < t.length && kindOfEnd(t[idx + len]) === closeKind);

		let rep: string;
		if (openKind !== closeKind) {
			// 開きと閉じの種類が食い違うときは、記法にせずタグで出す
			const tag = tagOf(openKind);
			rep = '<' + tag + '>' + inner + '</' + tag + '>';
		} else if (touchesOuterSameKind) {
			rep = inner;
		} else if (!forceTags &&
			canEmphasize(prefix + leadWs + inner + trailWs + suffix, prefix.length + leadWs.length, inner.length)) {
			const mark = markOf(openKind);
			// 中身の先頭・末尾がマークと同じ文字だと、記号が3つ以上並んで
			// 曖昧になる（***重要*** 等）。境界の1文字だけエスケープする
			// （i260908-04 の表・SVG6）
			rep = mark + escapeMarkBoundary(inner, markChar(openKind)) + mark;
		} else {
			const tag = tagOf(openKind);
			rep = '<' + tag + '>' + inner + '</' + tag + '>';
		}
		t = prefix + leadWs + rep + trailWs + suffix;
	}
	return t;
}
