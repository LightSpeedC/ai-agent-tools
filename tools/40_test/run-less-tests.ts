/*
	less のテスト。

	出力先が端末でない（spawnSync で捕まえるとそうなる）ときは
	ページングせず素通しする経路だけを自動で確かめる。実際のキー入力に
	よる画面遷移・CONIN$ が開けること自体は、対話が要るため自動化せず
	手動で確認する（計画 notes/10_plan/i260917-01-less.html を参照）。
*/

import { spawnSync } from 'node:child_process';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { encode } from '../../src/lib/codec.ts';
import { EofSuffix, displayWidth, eofPlacement, wrapLines } from '../../src/less/wrap.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..', '..');
const tool = path.join(root, 'src', 'less', 'main.ts');

let pass = 0;
let fail = 0;

function ok(name: string): void {
	pass++;
	console.log('  [OK] ' + name);
}

function ng(name: string, detail: string): void {
	fail++;
	console.log('  [NG] ' + name + '  ' + detail);
}

function assertEqual(name: string, expected: unknown, actual: unknown): void {
	if (expected === actual) { ok(name); }
	else { ng(name, '期待 ' + JSON.stringify(expected) + ' / 実際 ' + JSON.stringify(actual)); }
}

function assertTrue(name: string, value: boolean, detail: string): void {
	if (value) { ok(name); } else { ng(name, detail); }
}

/** less を、いま走っている処理系でそのまま呼ぶ。標準出力はパイプで捕まえるため isTTY は false になる */
function run(args: string[], input: string | Uint8Array): { code: number; out: string; err: string } {
	const runner = process.argv[0];
	const r = spawnSync(runner, [tool, ...args], { encoding: 'utf8', input });
	return { code: r.status ?? -1, out: r.stdout ?? '', err: r.stderr ?? '' };
}

console.log('');
console.log('=== less のテスト ===');
console.log('');

// --help
{
	const r = run(['--help'], '');
	assertEqual('--help は 0 で終わる', 0, r.code);
	assertTrue('--help は使い方を出す', r.out.includes('UTF-8 セーフなページャー'), r.out);
}

// 知らないオプション
{
	const r = run(['--nothing'], '');
	assertEqual('知らないオプションは 2', 2, r.code);
}

// 出力先が端末でないときは、ページングせずそのまま流す（バイト単位で一致すること）。
// この一致が、DOS more の文字化けを避けるという本題そのものの確認になる
{
	const input = '日本語テスト1行目\n2行目 → 特殊文字 ✅\n';
	const r = run([], input);
	assertEqual('素通し: 終了 0' , 0, r.code);
	assertEqual('素通し: UTF-8 のまま完全一致（文字化けしない）', input, r.out);
}

// 空入力
{
	const r = run([], '');
	assertEqual('空入力: 終了 0', 0, r.code);
	assertEqual('空入力: 出力も空', '', r.out);
}

// 入力の文字コードを自動判定する（SJIS のバイト列を渡しても正しく読める）
{
	const text = 'SJISテスト\n異体字・半角ｶﾅも含む\n';
	const sjisBytes = encode(text, 'sjis');
	const r = run([], sjisBytes);
	assertEqual('SJIS 入力: 終了 0', 0, r.code);
	assertEqual('SJIS 入力を自動判定して正しく読む', text, r.out);
}

// 改行の正規化（CRLF・CR 混在でも LF に揃えて出す。末尾の改行は1個だけ）
{
	const input = 'a\r\nb\rc\n';
	const r = run([], input);
	assertEqual('改行の混在を LF に揃える', 'a\nb\nc\n', r.out);
}

// ---- 折り返し (i260917-01、71-A) ----
// 端末の桁数を超える長い行は、端末が自動で折り返して 2 行以上を使う。画面行の数は
// こちらで先に計算して持つ（計画 B）。期待値は計画書の規則から手で書いた:
//   ・行末ちょうどまで入る行は折り返さない（端末の pending wrap は改行だけで済む）
//   ・右端に 1 桁しか残っていない所へ 2 桁文字が来るときは、その 1 桁へ空白を入れて折り返す
//   ・表示幅は displayWidth（ASCII・半角ｶﾀｶﾅ＝1 桁、それ以外＝2 桁）
//   ・TAB は 8 桁の区切りまで空白に広げる（端末が広げる幅と同じにするため）
console.log('');
console.log('--- 折り返し ---');
{
	const eq = (name: string, expected: string[], actual: string[]): void => {
		assertEqual(name, JSON.stringify(expected), JSON.stringify(actual));
	};
	eq('折り返し: 短い行はそのまま 1 行', ['abc'], wrapLines(['abc'], 10));
	eq('折り返し: 空行は 1 行として残る', [''], wrapLines([''], 10));
	eq('折り返し: 行が無ければ画面行も無い', [], wrapLines([], 10));
	eq('折り返し: ちょうど桁数まで入る行は折り返さない', ['abcdefghij'], wrapLines(['abcdefghij'], 10));
	eq('折り返し: 1 桁はみ出すと 2 行', ['abcdefghij', 'k'], wrapLines(['abcdefghijk'], 10));
	eq('折り返し: 桁数が違えば折り返す位置も変わる', ['abcde', 'f'], wrapLines(['abcdef'], 5));
	eq('折り返し: 右端に 1 桁だけ残る所の 2 桁文字は、空白を入れて折り返す', ['abcdefghi ', 'あ'], wrapLines(['abcdefghiあ'], 10));
	eq('折り返し: 2 桁文字がちょうど収まれば折り返さない', ['abcdefghあ'], wrapLines(['abcdefghあ'], 10));
	eq('折り返し: 全角だけの行', ['あいうえお', 'か'], wrapLines(['あいうえおか'], 10));
	eq('折り返し: 半角ｶﾀｶﾅは 1 桁', ['ｱｲｳｴｵｶｷｸｹｺ', 'ｻ'], wrapLines(['ｱｲｳｴｵｶｷｸｹｺｻ'], 10));
	eq('折り返し: 絵文字 (サロゲートペア) は 2 桁の 1 文字', ['abcdefghi ', '😀'], wrapLines(['abcdefghi😀'], 10));
	eq('折り返し: 複数の論理行は、それぞれ別に数える', ['abc', 'abcdefghij', 'k'], wrapLines(['abc', 'abcdefghijk'], 10));
	eq('折り返し: TAB は 8 桁の区切りまで空白に広げる', ['ab      c'], wrapLines(['ab\tc'], 10));
	eq('折り返し: 行の途中の TAB も 8 桁の区切りに合わせる', ['abcdefg c'], wrapLines(['abcdefg\tc'], 10));

	// 総当たり (決まった並びの疑似乱数): どの行も桁数に収まる。折り返された行は、桁数ちょうどか、
	// 2 桁文字のために 1 桁空けた行。空白を除けば、つなげると元の行に戻る
	let seed = 20261101;
	const next = (n: number): number => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed % n; };
	const alphabet = ['a', 'b', 'ｱ', 'あ', '漢', '😀'];
	let bad = '';
	for (let round = 0; round < 2000 && bad === ''; round++) {
		const columns = 3 + next(10);
		let line = '';
		const len = next(40);
		for (let i = 0; i < len; i++) { line += alphabet[next(alphabet.length)]; }
		const rows = wrapLines([line], columns);
		const label = JSON.stringify({ columns, line });
		if (rows.length === 0) { bad = '行が消えた ' + label; break; }
		if (rows.join('').replace(/ /g, '') !== line) { bad = '内容が変わった ' + label; break; }
		for (let r = 0; r < rows.length; r++) {
			const w = displayWidth(rows[r]);
			if (w > columns) { bad = '桁数を超えた ' + label; break; }
			if (r < rows.length - 1 && w < columns - 1) { bad = '早すぎる折り返し ' + label; break; }
		}
	}
	assertEqual('折り返し: 総当たり 2000 通りで、桁数に収まり、内容が変わらず、早く折り返さない', '', bad);

	// [EOF] ・ [改行なし] は、最後の画面行に付ける。収まらないときは、もう 1 行に出す
	const suffixWidth = displayWidth(EofSuffix);
	assertEqual('EOF: 改行ありで終わるなら、[EOF] は別の 1 行', JSON.stringify({ inline: false, extra: true }), JSON.stringify(eofPlacement(['abc'], 80, true)));
	assertEqual('EOF: 改行なしで終わり、収まるなら、最後の行の後ろに付ける', JSON.stringify({ inline: true, extra: false }), JSON.stringify(eofPlacement(['abc'], 80, false)));
	assertEqual('EOF: 改行なしで終わり、収まらないなら、別の 1 行に出す', JSON.stringify({ inline: false, extra: true }), JSON.stringify(eofPlacement(['x'.repeat(80 - suffixWidth + 1)], 80, false)));
	assertEqual('EOF: ちょうど収まるなら、最後の行の後ろに付ける', JSON.stringify({ inline: true, extra: false }), JSON.stringify(eofPlacement(['x'.repeat(80 - suffixWidth)], 80, false)));
}

console.log('');
if (fail === 0) {
	console.log('=== ' + pass + ' 件すべて成功 ===');
	process.exit(0);
} else {
	console.log('=== ' + fail + ' 件失敗（成功 ' + pass + ' 件）===');
	process.exit(1);
}
