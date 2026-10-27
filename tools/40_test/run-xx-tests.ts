/*
	xx のテスト（計画 p261027-01）。

	単体の確かめ（文字コードの判定・名前の解決）は src/xx の cargo test にある。
	ここは、実際に子プロセスを起こして、終了コード・標準入力・出力の振り分け・文字コードを見る。
	bun でも node でも走る。

	環境変数 XX_TARGET に exe のパスがあればそれを試す。無ければ src/xx/target/release/xx.exe。
*/

import { spawn, spawnSync } from 'node:child_process';
import * as path from 'node:path';
import * as fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..', '..');
const target = process.env.XX_TARGET ?? path.join(root, 'src', 'xx', 'target', 'release', 'xx.exe');
const work = path.join(root, 'tmp', 'xx-test');

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

function childEnv(): NodeJS.ProcessEnv {
	return { ...process.env, PATH: work + path.delimiter + (process.env.PATH ?? '') };
}

/** xx を呼ぶ */
function run(args: string[]): { code: number | null; out: string; err: string } {
	const r = spawnSync(target, args, { encoding: 'utf8', timeout: 30000, env: childEnv() });
	return { code: r.status, out: r.stdout ?? '', err: r.stderr ?? '' };
}

/**
	標準入力を開いたまま（閉じずに）xx を呼ぶ。xx が子の標準入力を EOF にしなければ、
	入力を待つ子が終わらず、時間切れになる（spawnSync は入力を渡さないとすぐ閉じるため、ここだけ spawn）
*/
function runWithOpenStdin(args: string[], limitMs: number): Promise<{ code: number | null; out: string; timedOut: boolean }> {
	return new Promise((resolve) => {
		const child = spawn(target, args, { env: childEnv(), stdio: ['pipe', 'pipe', 'pipe'] });
		let out = '';
		let timedOut = false;
		child.stdout.on('data', (d: Buffer) => { out += d.toString('utf8'); });
		const timer = setTimeout(() => {
			timedOut = true;
			spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F']);
		}, limitMs);
		child.on('close', (code) => {
			clearTimeout(timer);
			resolve({ code, out, timedOut });
		});
	});
}

function setup(): void {
	fs.rmSync(work, { recursive: true, force: true });
	fs.mkdirSync(work, { recursive: true });
	// 引数をそのまま出し、終了コードを引数の 1 つ目にする .cmd
	fs.writeFileSync(path.join(work, 'tcmd.cmd'), '@echo cmd-ok %1\r\n@exit /b %2\r\n');
	fs.writeFileSync(path.join(work, 'tps1.ps1'), 'Write-Output "ps1-ok $($args[0])"\r\nexit 4\r\n');
}

function cleanup(): void {
	fs.rmSync(work, { recursive: true, force: true });
}

async function main(): Promise<void> {
	if (!fs.existsSync(target)) {
		console.log('[NG] xx.exe がありません: ' + path.relative(root, target));
		process.exit(2);
	}
	setup();
	try {
		console.log('=== xx のテスト ===');

		const none = run([]);
		assertEqual('引数が無ければ 2', 2, none.code);

		const missing = run(['no-such-command-xx']);
		assertEqual('見つからなければ 127', 127, missing.code);
		assertEqual('見つからないとき、理由が標準エラーに出る', true, missing.err.includes('no-such-command-xx'));

		assertEqual('終了コードがそのまま返る (0)', 0, run(['node', '-e', 'process.exit(0)']).code);
		assertEqual('終了コードがそのまま返る (7)', 7, run(['node', '-e', 'process.exit(7)']).code);
		assertEqual('終了コードがそのまま返る (大きめの値 200 は .cmd 経由)', 200, run(['tcmd', 'x', '200']).code);
		// 255 を超える値は、受け取る側の bun が 256 で割った余りにする（xx を通さない cmd /c "exit 300" でも 44。実測）。
		// xx は 32 ビットのまま返すので、node の周回でだけ確かめる
		if (!('bun' in process.versions)) {
			assertEqual('終了コードがそのまま返る (255 を超える 300 は .cmd 経由)', 300, run(['tcmd', 'x', '300']).code);
		}

		const eof = await runWithOpenStdin(['node', '-e', "process.stdin.on('end',()=>console.log('EOF'));process.stdin.resume()"], 15000);
		assertEqual('子の標準入力は EOF (呼び元の入力が開いたままでも、固まらず終わる)', 'EOF', eof.out.trim());
		assertEqual('標準入力の確かめが時間切れになっていない', false, eof.timedOut);

		const split = run(['node', '-e', "console.log('o');console.error('e')"]);
		assertEqual('標準出力は標準出力へ', 'o', split.out.trim());
		assertEqual('標準エラーは標準エラーへ', 'e', split.err.trim());

		const sjis = run(['node', '-e', 'process.stdout.write(Buffer.from([0x82,0xA0,0x82,0xA2]))']);
		assertEqual('SJIS の出力が UTF-8 になる', 'あい', sjis.out);

		const u16 = run(['node', '-e', 'process.stdout.write(Buffer.from([0xFF,0xFE,0x42,0x30,0x44,0x30]))']);
		assertEqual('UTF-16 (BOM あり) の出力が UTF-8 になる', 'あい', u16.out);

		const u8 = run(['node', '-e', "process.stdout.write('あい')"]);
		assertEqual('UTF-8 の出力はそのまま', 'あい', u8.out);

		const argv = run(['node', '-e', 'console.log(JSON.stringify(process.argv.slice(1)))', 'a b', 'あ', '"q"']);
		assertEqual('空白・日本語・引用符を含む引数がそのまま届く', JSON.stringify(['a b', 'あ', '"q"']), argv.out.trim());

		const cmd = run(['tcmd', 'hello', '0']);
		assertEqual('拡張子なしの名前で .cmd が見つかって動く', 'cmd-ok hello', cmd.out.trim());

		const ps1 = run(['tps1', 'hello']);
		assertEqual('拡張子なしの名前で .ps1 が見つかって動く', 'ps1-ok hello', ps1.out.trim());
		assertEqual('.ps1 の終了コードが返る', 4, ps1.code);
	} finally {
		cleanup();
	}

	console.log('');
	console.log(`合格 ${pass} / 不合格 ${fail}`);
	process.exit(fail === 0 ? 0 : 1);
}

await main();
