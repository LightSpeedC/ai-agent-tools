/*
	ag-trusted の、agy の settings.json への信頼の書き足しのテスト。

	計画: notes/10_plan/i261101-02-ag-cmdと起動の共通部.html (83-B)
	  ・trustedWorkspaces の配列に 1 行だけ足す (文字列としての挿入)。
	    許可リスト (permissions.allow) など、ほかの部分は 1 バイトも変えない
	    (agy 自身が承認のたびにこのファイルを書き換えるため、JSON を作り直して書き戻さない)
	  ・書く前に控えを取る。登録済み (完全一致) なら書かない
	  ・読んだあとに別のものが書き換えたら、読み直す

	実物の形 (2026-11-01 に実測): BOM なし ・ LF ・ インデント 2 つの空白 ・ 末尾に LF。
	文字列は Go 風のエスケープ (> が \u003e)。パスは W:\\2026\\… (JSON では \ が 2 つ)。
	期待値は、その形から手で書いた。本物の ~/.gemini は触らない。
*/

import * as fs from 'node:fs';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { addTrustedWorkspace, ensureTrusted } from '../../src/ag-trusted/trust.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..', '..');
const work = path.join(root, 'tmp', 'ag-trusted-test');

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
	const e = JSON.stringify(expected);
	const a = JSON.stringify(actual);
	if (e === a) { ok(name); } else { ng(name, '期待 ' + e + ' / 実際 ' + a); }
}

function throws(name: string, fn: () => unknown): void {
	try { fn(); ng(name, '例外が出なかった'); } catch { ok(name); }
}

// 実物と同じ形 (2 つの空白 ・ LF ・ Go 風のエスケープ)。許可リストの文字列に、紛らわしい中身を入れてある
const sample = [
	'{',
	'  "allowNonWorkspaceAccess": true,',
	'  "permissions": {',
	'    "allow": [',
	'      "command(grep \\"user\\" 2\\u003e$null)",',
	'      "command(Get-ChildItem \\"C:\\\\x\\")"',
	'    ]',
	'  },',
	'  "trustedWorkspaces": [',
	'    "W:\\\\2026\\\\a",',
	'    "W:\\\\ai-agent-tools"',
	'  ]',
	'}',
	'',
].join('\n');

console.log('');
console.log('=== ag-trusted のテスト ===');
console.log('');

fs.rmSync(work, { recursive: true, force: true });
fs.mkdirSync(work, { recursive: true });

// ---- 文字列としての挿入 ----
console.log('--- 文字列としての挿入 ---');
{
	const r = addTrustedWorkspace(sample, 'W:\\2026\\new');
	const expected = sample.replace('    "W:\\\\ai-agent-tools"\n', '    "W:\\\\ai-agent-tools",\n    "W:\\\\2026\\\\new"\n');
	assertEqual('追加: 最後の要素の後ろに 1 行足し、前の要素にカンマが付く。ほかは 1 バイトも変わらない', expected, r.text);
	assertEqual('追加: changed は true', true, r.changed);
	const parsed = JSON.parse(r.text);
	assertEqual('追加: 読み直すと、パスが配列に入っている', true, parsed.trustedWorkspaces.includes('W:\\2026\\new'));
	assertEqual('追加: 許可リストなど、ほかのキーは変わらない', JSON.parse(sample).permissions, parsed.permissions);

	const again = addTrustedWorkspace(r.text, 'W:\\2026\\new');
	assertEqual('冪等: 登録済み (完全一致) なら、書き換えない', { text: r.text, changed: false }, again);

	const mixed = addTrustedWorkspace(sample, 'w:\\2026\\A');
	assertEqual('大小が違うパスは、完全一致ではないので足す (agy は完全一致で見るとされているため)', true, mixed.changed);

	const empty = addTrustedWorkspace('{\n  "a": 1,\n  "trustedWorkspaces": []\n}\n', 'W:\\x');
	assertEqual('空の配列: 配列を開いて 1 行入れる', '{\n  "a": 1,\n  "trustedWorkspaces": [\n    "W:\\\\x"\n  ]\n}\n', empty.text);

	const absent = addTrustedWorkspace('{\n  "a": 1\n}\n', 'W:\\x');
	assertEqual('キーが無い: 最後のキーの後ろに、キーごと足す', '{\n  "a": 1,\n  "trustedWorkspaces": [\n    "W:\\\\x"\n  ]\n}\n', absent.text);

	const none = addTrustedWorkspace('{}', 'W:\\x');
	assertEqual('中身が空の { }: キーだけを入れる', '{\n  "trustedWorkspaces": [\n    "W:\\\\x"\n  ]\n}', none.text);

	const tricky = [
		'{',
		'  "permissions": {',
		'    "allow": [',
		'      "command(echo \\"trustedWorkspaces\\": [)"',
		'    ]',
		'  }',
		'}',
		'',
	].join('\n');
	const t = addTrustedWorkspace(tricky, 'W:\\x');
	assertEqual('許可リストの文字列に "trustedWorkspaces" という語があっても、取り違えない', ['W:\\x'], JSON.parse(t.text).trustedWorkspaces);
	assertEqual('同上: 許可リストは変わらない', JSON.parse(tricky).permissions, JSON.parse(t.text).permissions);

	const crlf = addTrustedWorkspace(sample.replace(/\n/g, '\r\n'), 'W:\\2026\\new');
	assertEqual('CRLF のファイルには、CRLF で足す (混ぜない)', false, /[^\r]\n/.test(crlf.text));

	const ja = addTrustedWorkspace(sample, 'W:\\2026\\テスト');
	assertEqual('日本語のパスは、そのまま書く', true, ja.text.includes('"W:\\\\2026\\\\テスト"'));

	throws('JSON として読めなければ、例外 (書き換えない判断を呼び出し側に任せる)', () => addTrustedWorkspace('{ broken', 'W:\\x'));
	throws('配列でない trustedWorkspaces は、例外', () => addTrustedWorkspace('{ "trustedWorkspaces": 1 }', 'W:\\x'));
}

// ---- ファイルへの書き込み ----
console.log('--- ファイルへの書き込み ---');
{
	const f = path.join(work, 'settings.json');
	fs.writeFileSync(f, sample);
	const r1 = ensureTrusted(f, 'W:\\2026\\new');
	assertEqual('書き込み: 追加できる', 'added', r1.status);
	assertEqual('書き込み: 書いた中身は、挿入の結果と同じ', addTrustedWorkspace(sample, 'W:\\2026\\new').text, fs.readFileSync(f, 'utf8'));
	assertEqual('書き込み: 書く前の控えができ、中身は元のまま', sample, r1.backup != null ? fs.readFileSync(r1.backup, 'utf8') : null);

	const before = fs.readdirSync(work).sort();
	const mtime = fs.statSync(f).mtimeMs;
	const r2 = ensureTrusted(f, 'W:\\2026\\new');
	assertEqual('登録済み: 書かない', 'already', r2.status);
	assertEqual('登録済み: 控えも作らず、更新日時も変わらない', { files: before, mtime }, { files: fs.readdirSync(work).sort(), mtime: fs.statSync(f).mtimeMs });

	assertEqual('設定が無い: 作らず、そう返す', 'no-file', ensureTrusted(path.join(work, 'none.json'), 'W:\\x').status);
	assertEqual('設定が無い: ファイルを作らない', false, fs.existsSync(path.join(work, 'none.json')));

	const bad = path.join(work, 'bad.json');
	fs.writeFileSync(bad, '{ broken');
	assertEqual('壊れている: 書かず、そう返す', 'broken', ensureTrusted(bad, 'W:\\x').status);
	assertEqual('壊れている: 中身は変わらない', '{ broken', fs.readFileSync(bad, 'utf8'));

	// 読んだあとに、agy が許可リストへ足したとする。足した分を消さず、そのうえで挿入する
	const race = path.join(work, 'race.json');
	fs.writeFileSync(race, sample);
	const raced = ensureTrusted(race, 'W:\\2026\\new', {
		beforeWrite(attempt) {
			if (attempt !== 1) { return; }
			fs.writeFileSync(race, sample.replace('      "command(Get-ChildItem \\"C:\\\\x\\")"\n', '      "command(Get-ChildItem \\"C:\\\\x\\")",\n      "command(added by agy)"\n'));
		},
	});
	const final = JSON.parse(fs.readFileSync(race, 'utf8'));
	assertEqual('衝突: 読んだあとの更新を見つけて、読み直してから書く', 'added', raced.status);
	assertEqual('衝突: agy が足した許可を消さない', true, final.permissions.allow.includes('command(added by agy)'));
	assertEqual('衝突: 信頼も入っている', true, final.trustedWorkspaces.includes('W:\\2026\\new'));

	// いつ読み直しても更新されるなら、書かずに止める (最大 3 回)
	const busy = path.join(work, 'busy.json');
	fs.writeFileSync(busy, sample);
	let n = 0;
	const rb = ensureTrusted(busy, 'W:\\2026\\new', {
		beforeWrite() {
			n++;
			// 呼ばれるたびに、必ず中身が変わるようにする (true と false を入れ替える)
			fs.writeFileSync(busy, fs.readFileSync(busy, 'utf8').replace(/"allowNonWorkspaceAccess": (true|false)/, (_m, v: string) => '"allowNonWorkspaceAccess": ' + (v === 'true' ? 'false' : 'true')));
		},
	});
	assertEqual('衝突が続く: 3 回で諦め、書かずに busy を返す', { status: 'busy', tries: 3 }, { status: rb.status, tries: n });
	assertEqual('衝突が続く: 信頼は書かれていない', false, JSON.parse(fs.readFileSync(busy, 'utf8')).trustedWorkspaces.includes('W:\\2026\\new'));
}

// ---- コマンドとしての動き ----
// 現在のフォルダを信頼に書き足してから、受けた引数のまま agy を起こす。
// agy は、引数 ・ カレントを記録するだけの代役 (rustc で作る) に差し替える。本物の agy は起こさない
console.log('--- コマンドとしての動き ---');
{
	const stubDir = path.join(work, 'stub');
	fs.mkdirSync(stubDir, { recursive: true });
	const src = path.join(work, 'agy-stub.rs');
	fs.writeFileSync(src, `
use std::io::Write;
fn main() {
	let out = std::env::var("AG_TEST_STUB_OUT").unwrap_or_default();
	if !out.is_empty() {
		let args: Vec<String> = std::env::args().skip(1).collect();
		let s = format!("cwd={}\\nargs={}\\n", std::env::current_dir().unwrap().display(), args.join("\\u{1f}"));
		std::fs::File::create(&out).unwrap().write_all(s.as_bytes()).unwrap();
	}
	let code: i32 = std::env::var("AG_TEST_STUB_EXIT").ok().and_then(|v| v.parse().ok()).unwrap_or(0);
	std::process::exit(code);
}
`);
	const built = spawnSync('rustc', [src, '-o', path.join(stubDir, 'agy.exe')], { encoding: 'utf8' });
	if (built.status !== 0) {
		console.log('[NG] 代役の agy.exe を作れません: ' + (built.stderr ?? ''));
		process.exit(2);
	}
	const main = path.join(root, 'src', 'ag-trusted', 'main.ts');
	const stubOut = path.join(work, 'stub-out.txt');

	function run(cwd: string, settings: string, args: string[], extra: Record<string, string> = {}, pathOverride?: string): { code: number | null; out: string; stub: { cwd: string; args: string[] } | null } {
		fs.rmSync(stubOut, { force: true });
		const env: Record<string, string | undefined> = {
			...process.env,
			AG_TRUSTED_TEST_FILE: settings,
			AG_TEST_STUB_OUT: stubOut,
			PATH: pathOverride ?? (stubDir + path.delimiter + (process.env.PATH ?? '')),
			...extra,
		};
		const r = spawnSync(process.execPath, [main, ...args], { encoding: 'utf8', cwd, env, timeout: 60000 });
		let stub: { cwd: string; args: string[] } | null = null;
		if (fs.existsSync(stubOut)) {
			const lines = fs.readFileSync(stubOut, 'utf8').split('\n');
			stub = { cwd: (lines.find((l) => l.startsWith('cwd=')) ?? '').slice(4), args: (lines.find((l) => l.startsWith('args=')) ?? '').slice(5).split('\u001f').filter((a) => a.length > 0) };
		}
		return { code: r.status, out: (r.stdout ?? '') + (r.stderr ?? ''), stub };
	}

	const proj = path.join(work, 'proj');
	fs.mkdirSync(proj, { recursive: true });
	const settings = path.join(work, 'cli-settings.json');
	fs.writeFileSync(settings, sample);

	const launchArgs = ['--dangerously-skip-permissions', '--mode', 'auto', '-c'];
	const a = run(proj, settings, launchArgs);
	assertEqual('起動: 受けた引数のまま agy を起こす', launchArgs, a.stub?.args ?? null);
	assertEqual('起動: 現在のフォルダで起こす', proj.toLowerCase(), (a.stub?.cwd ?? '').toLowerCase());
	assertEqual('起動: 現在のフォルダが、trustedWorkspaces に入る', true, JSON.parse(fs.readFileSync(settings, 'utf8')).trustedWorkspaces.some((p: string) => p.toLowerCase() === proj.toLowerCase()));
	assertEqual('起動: 追加したことを表示する', true, a.out.includes('信頼設定を追加しました'));
	assertEqual('起動: 終了コードは 0', 0, a.code);

	const b = run(proj, settings, []);
	assertEqual('登録済み: 既にあると表示し、書き足さずに起こす', true, b.out.includes('信頼設定は既にあります') && b.stub !== null);

	const missing = run(proj, path.join(work, 'none.json'), launchArgs);
	assertEqual('設定が無い: 終了コード 3', 3, missing.code);
	assertEqual('設定が無い: agy を起こさない', null, missing.stub);
	assertEqual('設定が無い: 先に agy を 1 度起動するよう案内する', true, missing.out.includes('agy'));

	const badFile = path.join(work, 'cli-bad.json');
	fs.writeFileSync(badFile, '{ broken');
	const broken = run(proj, badFile, launchArgs);
	assertEqual('壊れている: 終了コード 3 で、agy を起こさない', { code: 3, stub: null }, { code: broken.code, stub: broken.stub });
	assertEqual('壊れている: 設定は書き換えない', '{ broken', fs.readFileSync(badFile, 'utf8'));

	const exit7 = run(proj, settings, [], { AG_TEST_STUB_EXIT: '7' });
	assertEqual('agy の終了コードを、そのまま返す', 7, exit7.code);

	const noAgy = run(proj, settings, [], {}, path.dirname(process.execPath));
	assertEqual('agy が見つからない: 終了コード 1', 1, noAgy.code);
}

fs.rmSync(work, { recursive: true, force: true });

console.log('');
if (fail === 0) {
	console.log('=== ' + pass + ' 件すべて成功 ===');
	process.exit(0);
} else {
	console.log('=== ' + fail + ' 件失敗（成功 ' + pass + ' 件）===');
	process.exit(1);
}
