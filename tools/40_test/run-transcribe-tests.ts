/*
	transcribe（音声の書き起こし）のテスト（i261012-01）。

	whisper を要らないもの（引数の解釈 ・ whisper-cli に渡す引数 ・ 出力名 ・ 無いときの終了コード）は
	どこでも回る。whisper を要るものは _vendor/whisper/ が無ければ ⬜ 未実施として飛ばす
	（Git の管理外なので、ほかの PC ・ クラウドには無い）。

	whisper は無音から「ご視聴ありがとうございました」のような文を作るため、
	合成した無音では書き起こしの中身を確かめられない。ファイルが出たことだけを見る。
*/
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseArgs, buildWhisperArgs, findWhisperCli, DefaultLang } from '../../src/transcribe/transcribe.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..', '..');
const work = path.join(root, 'tmp', 'transcribe-tests');
const main = path.join(root, 'src', 'transcribe', 'transcribe-main.ts');
const vendor = path.join(root, '_vendor', 'whisper');

let pass = 0;
let fail = 0;
let skip = 0;
function check(name: string, ok: boolean, detail: string = ''): void {
	if (ok) { pass++; console.log('  ✅ [OK] ' + name); }
	else { fail++; console.log('  ❌ [NG] ' + name + (detail ? '  ' + detail : '')); }
}
function skipped(name: string, why: string): void {
	skip++;
	console.log('  ⬜ [未実施] ' + name + '  ' + why);
}

/** 無音の 16bit PCM WAV を 1 秒分作る */
function makeWav(p: string, rate: number, channels: number): void {
	const n = rate;
	const b = Buffer.alloc(44 + n * 2 * channels);
	b.write('RIFF', 0); b.writeUInt32LE(36 + n * 2 * channels, 4); b.write('WAVEfmt ', 8);
	b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(channels, 22);
	b.writeUInt32LE(rate, 24); b.writeUInt32LE(rate * 2 * channels, 28); b.writeUInt16LE(2 * channels, 32); b.writeUInt16LE(16, 34);
	b.write('data', 36); b.writeUInt32LE(n * 2 * channels, 40);
	fs.writeFileSync(p, b);
}

/** transcribe を node で起動する */
function run(args: string[], env: Record<string, string> = {}, cwd: string = root): { code: number, out: string, err: string } {
	const r = spawnSync(process.execPath, [main, ...args], { encoding: 'utf8', env: { ...process.env, ...env }, timeout: 600000, cwd: cwd });
	return { code: r.status ?? -1, out: r.stdout ?? '', err: r.stderr ?? '' };
}

console.log('');
console.log('=== transcribe ===');
fs.rmSync(work, { recursive: true, force: true });
fs.mkdirSync(path.join(work, 'sub'), { recursive: true });
const a = path.join(work, 'a.wav');
const b = path.join(work, 'sub', 'b.wav');
makeWav(a, 16000, 1);
makeWav(b, 24000, 2);

// --- 引数の解釈 ---
{
	const r = parseArgs([a, b]);
	check('音声を複数受ける', 'files' in r && r.files.length === 2);
	check('--lang を省くと ja（決めたこと 3-A）', 'files' in r && r.lang === 'ja' && DefaultLang === 'ja');
	check('--out を省くと未指定（音声と同じフォルダに出す。決めたこと 2-A）', 'files' in r && r.out === null);
}
{
	const r = parseArgs([a, '--lang', 'en', '--model', 'm.bin', '--out', 'o']);
	check('--lang ・ --model ・ --out を受ける', 'files' in r && r.lang === 'en' && r.model === 'm.bin' && r.out === 'o');
}
check('音声が無ければ誤り', 'error' in parseArgs(['--lang', 'ja']));
{
	// cmd の行の長さの上限への対策（ai-chat-lite #1445）。集め方は convert-audio と共通（audio-files.ts）
	const r = parseArgs(['--list', 'l.txt', '--dir', 'd', '--ext', 'wav']);
	check('--list ・ --dir ・ --ext を受け、音声の引数が無くてもよい', 'files' in r &&
		JSON.stringify(r.lists) === JSON.stringify(['l.txt']) && JSON.stringify(r.dirs) === JSON.stringify(['d']) && JSON.stringify(r.exts) === JSON.stringify(['wav']));
	check('--dir に --ext が無ければ誤り', 'error' in parseArgs(['--dir', 'd']));
}
check('値の無いオプションは誤り', 'error' in parseArgs([a, '--lang']));
check('知らないオプションは誤り', 'error' in parseArgs([a, '--xyz']));
{
	const r = parseArgs([a]);
	const v = parseArgs([a, '--verbose']);
	check('--verbose を省くと false、渡すと true（決めたこと 8 ・ 10-A）', 'files' in r && r.verbose === false && 'files' in v && v.verbose === true);
}

// --- whisper-cli に渡す引数 ---
{
	const r = buildWhisperArgs({ files: [a, b], lang: 'ja', model: 'M', out: null });
	check('1 回の起動で -f と -of を組で並べる', 'args' in r &&
		JSON.stringify(r.args) === JSON.stringify(['-m', 'M', '-l', 'ja', '-np', '-otxt', '-oj',
			'-f', a, '-of', path.join(work, 'a'), '-f', b, '-of', path.join(work, 'sub', 'b')]));
	check('--out を省くと音声と同じフォルダに、拡張子を除いた名前で出す', 'outputs' in r &&
		JSON.stringify(r.outputs) === JSON.stringify([path.join(work, 'a'), path.join(work, 'sub', 'b')]));
}
{
	const r = buildWhisperArgs({ files: [a, b], lang: 'ja', model: 'M', out: path.join(work, 'o') });
	check('--out を渡すとそのフォルダに出す', 'outputs' in r &&
		JSON.stringify(r.outputs) === JSON.stringify([path.join(work, 'o', 'a'), path.join(work, 'o', 'b')]));
}
{
	const r = buildWhisperArgs({ files: [a, path.join(work, 'sub', 'a.mp3')], lang: 'ja', model: 'M', out: path.join(work, 'o') });
	check('出力名がぶつかるなら誤り（上書きしない）', 'error' in r);
}

// --- whisper-cli を探す ---
{
	const d = path.join(work, 'vendor');
	check('whisper-cli が無ければ null', findWhisperCli(d) === null);
	fs.mkdirSync(path.join(d, 'bin', 'Release'), { recursive: true });
	fs.writeFileSync(path.join(d, 'bin', 'Release', 'whisper-cli.exe'), '');
	check('下の階層の whisper-cli.exe を見つける（zip の構成に左右されない）', findWhisperCli(d) === path.join(d, 'bin', 'Release', 'whisper-cli.exe'));
}

// --- 起動して確かめる（whisper を要らないもの） ---
{
	const r = run([]);
	check('引数なしは終了コード 2', r.code === 2, 'code=' + r.code);
}
{
	const r = run([path.join(work, 'none.wav')]);
	check('音声が無ければ終了コード 2', r.code === 2, 'code=' + r.code);
}
{
	const r = run(['--dir', path.join(work, 'none'), '--ext', 'wav']);
	check('--dir のフォルダが無ければ終了コード 2', r.code === 2, 'code=' + r.code);
}
{
	const r = run([a], { TRANSCRIBE_VENDOR: path.join(work, 'empty') });
	check('whisper-cli が無ければ終了コード 2 で、置き場を案内する', r.code === 2 && r.err.includes('_vendor/whisper'), 'code=' + r.code + ' err=' + r.err.trim());
}
{
	const r = run([a, '--model', path.join(work, 'none.bin')]);
	if (findWhisperCli(vendor) === null) { skipped('モデルが無ければ終了コード 2', '_vendor/whisper/ が無い'); }
	else { check('モデルが無ければ終了コード 2', r.code === 2, 'code=' + r.code); }
}

// --- whisper を要るもの ---
if (findWhisperCli(vendor) === null) {
	skipped('2 本を 1 回で書き起こし、ファイルごとに .txt と .json が出る', '_vendor/whisper/ が無い');
} else {
	const r = run([a, b]);
	const outs = [path.join(work, 'a'), path.join(work, 'sub', 'b')];
	const made = outs.every(o => fs.existsSync(o + '.txt') && fs.existsSync(o + '.json'));
	check('2 本を 1 回で書き起こし、ファイルごとに .txt と .json が出る（24kHz ステレオも変換せずに渡す）', r.code === 0 && made, 'code=' + r.code + ' err=' + r.err.slice(-300));
	const listed = r.out.trim().split(/\r?\n/);
	check('標準出力には出したファイルの一覧だけを出す', listed.length === 4 && listed.every(l => /\.(txt|json)$/.test(l)), JSON.stringify(listed));

	// bun は、既にあるフォルダを .. を含む相対パスで mkdirSync(recursive) すると EEXIST を投げる（ai-chat-lite #1445）
	fs.mkdirSync(path.join(work, 'exists'), { recursive: true });
	const r2 = run([a, '--out', '..\\exists'], {}, path.join(work, 'sub'));
	check('既にあるフォルダを .. を含む相対パスで --out に渡せる', r2.code === 0 && fs.existsSync(path.join(work, 'exists', 'a.txt')), 'code=' + r2.code + ' err=' + r2.err.slice(-200));

	const out3 = path.join(work, 'fromdir');
	fs.writeFileSync(path.join(work, 'list.txt'), 'a.wav\n');
	const r3 = run(['--dir', path.join(work, 'sub'), '--ext', 'wav', '--list', path.join(work, 'list.txt'), '--out', out3]);
	check('--dir と --list で渡した音声を書き起こす', r3.code === 0 && fs.existsSync(path.join(out3, 'a.txt')) && fs.existsSync(path.join(out3, 'b.txt')), 'code=' + r3.code + ' err=' + r3.err.slice(-200));

	// 決めたこと 8 ・ 10-A: convert-audio と同じく、既定では whisper-cli の出力を出さず、失敗したときだけ詳しく出す
	check('既定では成功した whisper-cli の出力を出さない', r.code === 0 && !r.err.includes('output_txt'), 'err=' + r.err.slice(-200));
	const r4 = run([a, '--out', path.join(work, 'loud'), '--verbose']);
	check('--verbose なら whisper-cli の出力を出す', r4.code === 0 && r4.err.includes('output_txt'), 'code=' + r4.code + ' err=' + r4.err.slice(-200));
	const broken = path.join(work, 'broken.wav');
	fs.writeFileSync(broken, 'これは音声ではない');
	const r5 = run([broken, '--out', path.join(work, 'ng')]);
	check('失敗したときは whisper-cli の出力を詳しく出し、終了コード 1', r5.code === 1 && r5.err.includes('[NG]') && r5.err.includes('broken.wav') && r5.err.split('\n').length > 2, 'code=' + r5.code + ' err=' + r5.err.slice(-300));
}

fs.rmSync(work, { recursive: true, force: true });
console.log('');
const tail = skip > 0 ? '（⬜ 未実施 ' + skip + ' 件）' : '';
console.log(fail === 0 ? '=== ' + pass + ' 件すべて成功' + tail + ' ===' : '=== ' + fail + ' 件失敗（成功 ' + pass + ' 件）' + tail + ' ===');
process.exit(fail === 0 ? 0 : 1);
