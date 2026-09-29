/*
	psh のテスト。

	PowerShell ツールが使えない環境で powershell を呼ぶための当て木を確かめる。
	bun でも node でも走る（どちらも .ts をそのまま実行できる）。

	ここだけ ps1 でなく ts で書いている。psh 自体が
	「PowerShell を呼ぶ道具」なので、テストまで ps1 にすると
	道具が壊れたときにテストも動かせなくなる。

	環境変数 PSH_TARGET に exe のパスがあれば、psh-main.ts の代わりにそれを試す
	（Rust 版。計画 p260929-01）。同じケースを両方に当てて、動きが同じことを見る。
*/

import { spawnSync } from 'node:child_process';
import * as path from 'node:path';
import * as fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..', '..');
const tool = path.join(root, 'src', 'psh', 'psh-main.ts');
const cases = path.join(root, 'tests', 'psh');
/** 試す exe（Rust 版）。無ければ psh-main.ts を、いま走っている処理系で呼ぶ */
const target = process.env.PSH_TARGET ?? '';

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

function assertTrue(name: string, value: boolean, detail: string): void {
	if (value) { ok(name); } else { ng(name, detail); }
}

function assertEqual(name: string, expected: unknown, actual: unknown): void {
	if (expected === actual) { ok(name); }
	else { ng(name, '期待 ' + String(expected) + ' / 実際 ' + String(actual)); }
}

/** pwsh（7）が入っているか。無い環境ではその分を確かめない */
function hasPwsh(): boolean {
	const r = spawnSync('pwsh', ['-NoProfile', '-Command', '1'], { encoding: 'utf8' });
	return r.error == null && r.status === 0;
}

/** psh を呼ぶ。PSH_TARGET があればその exe、無ければ psh-main.ts をいま走っている処理系で */
function run(args: string[]): { code: number; out: string; err: string } {
	const r = target.length > 0
		? spawnSync(target, args, { encoding: 'utf8' })
		: spawnSync(process.argv[0], [tool, ...args], { encoding: 'utf8' });
	return { code: r.status ?? -1, out: r.stdout ?? '', err: r.stderr ?? '' };
}

console.log('');
console.log('=== psh のテスト' + (target.length > 0 ? '（' + path.basename(target) + '）' : '') + ' ===');
console.log('');

if (target.length > 0 && !fs.existsSync(target)) {
	console.log('  [NG] 試す exe がありません: ' + target);
	process.exit(2);
}
if (target.length === 0 && !fs.existsSync(tool)) {
	console.log('  [NG] psh の本体がありません: src/psh/psh-main.ts');
	process.exit(2);
}

// 1. ps1 を実行し、日本語が化けずに返る
let r = run([path.join(cases, 'hello.ps1')]);
assertEqual('1 終了コード', 0, r.code);
assertTrue('1 日本語が化けない', r.out.includes('日本語の出力です'), JSON.stringify(r.out.slice(0, 60)));

// 2. 引数が渡る。空白を含む引数も 1 つのまま届く
r = run([path.join(cases, 'hello.ps1'), '空白を 含む 値', 'ふたつめ']);
assertTrue('2 空白を含む引数が割れない', r.out.includes('第 1 引数: 空白を 含む 値'), JSON.stringify(r.out.slice(0, 120)));
assertTrue('2 第 2 引数も届く', r.out.includes('第 2 引数: ふたつめ'), JSON.stringify(r.out.slice(0, 120)));

// 3. 終了コードを素通しする。標準エラーの日本語も化けない
r = run([path.join(cases, 'fail.ps1')]);
assertEqual('3 終了コードが素通しされる', 3, r.code);
assertTrue('3 標準エラーが化けない', r.err.includes('失敗しました'), JSON.stringify(r.err.slice(0, 60)));

// 4. --command で式を実行できる
r = run(['--command', 'Write-Host "式からの日本語"']);
assertEqual('4 終了コード', 0, r.code);
assertTrue('4 式の日本語が化けない', r.out.includes('式からの日本語'), JSON.stringify(r.out.slice(0, 60)));

// 7. --command の短縮として -c を受ける（sh -c ・ bash -c と同じ慣習）
r = run(['-c', 'Write-Host "短いオプション"']);
assertEqual('7 -c の終了コード', 0, r.code);
assertTrue('7 -c で式が動く', r.out.includes('短いオプション'), JSON.stringify(r.out.slice(0, 60)));

// 8. 既定は powershell（5.1）。pwsh（7）は --pwsh を書いたときだけ。
//    5.1 を既定にするのは、ps1 を 5.1 で動くように書く決めがあるため。
//    厳しい側で動かさないと、7 でしか通らない書き方に気づけない。
//    速さの面でも 5.1 が有利（実測 185ms 対 285ms。7 は .NET Core の起動コストが乗る）
r = run(['-c', '$PSVersionTable.PSVersion.Major']);
assertEqual('8 既定は 5.1', '5', r.out.trim());

if (hasPwsh()) {
	r = run(['--pwsh', '-c', '$PSVersionTable.PSVersion.Major']);
	assertEqual('8 --pwsh なら 7', '7', r.out.trim());
	r = run(['--pwsh', path.join(cases, 'hello.ps1')]);
	assertTrue('8 --pwsh でも ps1 を実行できる', r.out.includes('日本語の出力です'), JSON.stringify(r.out.slice(0, 60)));
} else {
	console.log('  [--] 8 --pwsh は pwsh が無いので確かめない');
}

// 5. PowerShell 自身の出力（UTF-8）と、そこから呼んだ .NET 製 exe の出力（CP932）が
//    同じ実行に混ざっても、どちらも読める。これが実際に困っていた形
r = run([path.join(cases, 'callexe.ps1')]);
assertEqual('5 終了コード', 0, r.code);
assertTrue('5 PowerShell 側の日本語が読める', r.out.includes('ここは PowerShell の出力です'), JSON.stringify(r.out.slice(0, 80)));
assertTrue('5 exe 側の日本語が読める', r.out.includes('ファイルの文字コードと改行を変換します'), JSON.stringify(r.out.slice(0, 200)));

// 6. 対象が無ければ 2 で止める（黙って成功しない）
r = run([path.join(cases, 'nothing-here.ps1')]);
assertEqual('5 ファイルが無ければ 2', 2, r.code);

// 6. 引数が無ければ使い方を出して 2
r = run([]);
assertEqual('6 引数なしは 2', 2, r.code);

/*
	7. --help ・ -h で使い方を出して 0 で終わる

	ほかの 3 つ（html2md ・ text ・ convert-encoding）は --help と -h に
	対応している。psh だけ対応しておらず、ps1 のパスとして扱われて
	「ファイルが見つかりません」で 2 になっていた。
	**求めたものが出たのだから 0 で終わる。**
*/
for (const flag of ['--help', '-h']) {
	r = run([flag]);
	assertEqual('7 ' + flag + ' は 0 で終わる', 0, r.code);
	assertTrue(
		'7 ' + flag + ' は使い方を出す',
		r.out.includes('psh <path.ps1>') || r.err.includes('psh <path.ps1>'),
		JSON.stringify((r.out + r.err).slice(0, 200)),
	);
}

/*
	9. 文字コードの読み分け（計画 p260929-01。Rust 版と TypeScript 版の突き合わせ）

	全体を UTF-8 として厳密に読み、読めなければ行（\n まで）ごとに UTF-8 → CP932 の順で読む。
	決めたバイト列を emit.ps1 でそのまま書かせ、読み直した結果が一字一句同じかを見る。
	期待値は手で書いた（実装の出力から作ると、実装が何を出しても通る）
*/
const decodeCases: { name: string; hex: string; want: string }[] = [
	{ name: 'UTF-8 だけ', hex: 'E3 81 82 E3 81 84 E3 81 86 0A', want: 'あいう\n' },
	{ name: 'CP932 だけ（CRLF）', hex: '82 A0 82 A2 82 A4 0D 0A', want: 'あいう\r\n' },
	{ name: '行ごとに混ざる（UTF-8 の行 → CP932 の行）', hex: 'E3 81 82 0A 82 A2 0D 0A', want: 'あ\nい\r\n' },
	{ name: '末尾に改行が無い CP932', hex: '41 0A 82 A0', want: 'A\nあ' },
	{ name: 'CP932 の半角カナの行と UTF-8 の行', hex: 'B1 0A E3 81 86 0A', want: 'ｱ\nう\n' },
	{ name: 'ASCII だけ', hex: '61 62 63 0D 0A', want: 'abc\r\n' },
];
for (const c of decodeCases) {
	r = run([path.join(cases, 'emit.ps1'), c.hex]);
	assertEqual('9 読み分け: ' + c.name + ' 終了コード', 0, r.code);
	assertEqual('9 読み分け: ' + c.name, JSON.stringify(c.want), JSON.stringify(r.out));
}

/*
	10. PowerShell は UTF-8（65001）で動き、ps1 の中で UTF-8 のツールの出力を取り込んでも化けない
	    （計画 p260929-01。利用者の決定）

	PowerShell は取り込んだ出力を自分のコンソールのコードページで文字列にする。
	以前は呼び出し元の窓を引き継いでいたため、psh が bun なら 65001（bun が窓を変える）、
	node なら 932 と、処理系で結果が変わった。932 だとこのリポジトリのツールの UTF-8 が化ける。
	psh は自分専用のコンソールを 65001 にして起動する。このテストは bun と node の両方から回る
*/
r = run([path.join(cases, 'capture-utf8.ps1')]);
assertTrue('10 PowerShell は 65001 で動く', r.out.includes('コードページ: 65001'), JSON.stringify(r.out.slice(0, 80)));
assertTrue('10 ps1 の中で UTF-8 のツールの出力を取り込んでも化けない', r.out.includes('取り込み: 正しい'), JSON.stringify(r.out.slice(0, 80)));

/*
	11. 引数の結び付きと終了コードが -File と同じ（計画 p260929-01）

	UTF-8 にする 1 行を先に実行するため -File が使えず、-Command の中から ps1 を呼ぶ。
	- で始まる語を引数の名前、それ以外を単一引用符で囲んだ値として並べ直す。
	期待値は powershell -File で実測した結果（手で書いた）
*/
const argCases: { name: string; argv: string[]; code: number; out: string }[] = [
	{ name: '名前付き ・ スイッチ ・ 余りの引数', argv: ['-Name', 'あい う', '-Flag', '-Code', '0', 'のこり'], code: 0, out: 'Name=[あい う] Flag=True 残り=[のこり]' },
	{ name: '-名前:値 の形', argv: ['-Name:コロン', '-Code:0'], code: 0, out: 'Name=[コロン] Flag=False 残り=[]' },
	{ name: '引用符を含む値', argv: ['-Name', "引用'符", '-Code', '0', '"二重"'], code: 0, out: 'Name=[引用\'符] Flag=False 残り=["二重"]' },
	{ name: '知らない名前は余りの引数になる', argv: ['-NoSuchParam', 'x'], code: 0, out: 'Name=[] Flag=False 残り=[-NoSuchParam|x]' },
	{ name: '$ と ; を含む値は展開されない', argv: ['-Name', '$env:PATH ; Write-Output 注入'], code: 0, out: 'Name=[$env:PATH ; Write-Output 注入] Flag=False 残り=[]' },
	{ name: 'exit の値を返す', argv: ['-Code', '3'], code: 3, out: 'Name=[] Flag=False 残り=[]' },
	{ name: '例外で落ちたら 1', argv: ['-Throw'], code: 1, out: 'Name=[] Flag=False 残り=[]' },
];
// 引数の結び付けに失敗したら、-File と同じく 1 で終わる（余りの値が数値の -Code に入って型の変換に失敗する）。
// trap { break } が無いと 0 で終わっていた
r = run([path.join(cases, 'args.ps1'), '-Name', 'x', 'のこり']);
assertEqual('11 引数の結び付けに失敗したら 1', 1, r.code);
for (const c of argCases) {
	r = run([path.join(cases, 'args.ps1'), ...c.argv]);
	assertEqual('11 ' + c.name + ' 終了コード', c.code, r.code);
	assertTrue('11 ' + c.name, r.out.includes(c.out), JSON.stringify(r.out.slice(0, 120)));
}

// 12. ps1 を相対パスで渡しても動く（-Command の & は区切りの無い名前をカレントから探さないため、絶対パスに直している）
{
	const rel = path.relative(process.cwd(), path.join(cases, 'hello.ps1'));
	r = run([rel]);
	assertEqual('12 相対パスでも動く 終了コード', 0, r.code);
	assertTrue('12 相対パスでも動く', r.out.includes('日本語の出力です'), JSON.stringify(r.out.slice(0, 60)));
}

console.log('');
if (fail === 0) {
	console.log('=== ' + pass + ' 件すべて成功 ===');
	process.exit(0);
} else {
	console.log('=== ' + fail + ' 件失敗（成功 ' + pass + ' 件）===');
	process.exit(1);
}
