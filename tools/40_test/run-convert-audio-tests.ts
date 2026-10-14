/*
	convert-audio（音声の形式を変える）のテスト（i261012-02）。

	ffmpeg を要らないもの（引数の解釈 ・ ffmpeg に渡す引数 ・ 出力名 ・ 上書きしない ・ 無いときの終了コード）は
	どこでも回る。ffmpeg を要るものは _vendor/ffmpeg/ が無ければ ⬜ 未実施として飛ばす
	（Git の管理外なので、ほかの PC ・ クラウドには無い）。
*/
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseArgs, buildFfmpegArgs, findFfmpeg, Formats, DefaultBitrate } from '../../src/convert-audio/convert-audio.ts';
import { collectFiles } from '../../src/audio-files/audio-files.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..', '..');
const work = path.join(root, 'tmp', 'convert-audio-tests');
const main = path.join(root, 'src', 'convert-audio', 'convert-audio-main.ts');
const vendor = path.join(root, '_vendor', 'ffmpeg');

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

/** 正弦波の 16bit PCM WAV を 1 秒分作る（無音だとエンコーダが極端に小さくまとめるため、音を入れる） */
function makeWav(p: string, rate: number, channels: number): void {
	const n = rate;
	const b = Buffer.alloc(44 + n * 2 * channels);
	b.write('RIFF', 0); b.writeUInt32LE(36 + n * 2 * channels, 4); b.write('WAVEfmt ', 8);
	b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(channels, 22);
	b.writeUInt32LE(rate, 24); b.writeUInt32LE(rate * 2 * channels, 28); b.writeUInt16LE(2 * channels, 32); b.writeUInt16LE(16, 34);
	b.write('data', 36); b.writeUInt32LE(n * 2 * channels, 40);
	for (let i = 0; i < n; i++) {
		const v = Math.round(Math.sin(2 * Math.PI * 440 * i / rate) * 8000);
		for (let c = 0; c < channels; c++) { b.writeInt16LE(v, 44 + (i * channels + c) * 2); }
	}
	fs.writeFileSync(p, b);
}

function run(args: string[], env: Record<string, string> = {}, cwd: string = root): { code: number, out: string, err: string } {
	const r = spawnSync(process.execPath, [main, ...args], { encoding: 'utf8', env: { ...process.env, ...env }, timeout: 600000, cwd: cwd });
	return { code: r.status ?? -1, out: r.stdout ?? '', err: r.stderr ?? '' };
}

console.log('');
console.log('=== convert-audio ===');
fs.rmSync(work, { recursive: true, force: true });
fs.mkdirSync(path.join(work, 'sub'), { recursive: true });
const a = path.join(work, 'a.wav');
const b = path.join(work, 'sub', 'b.wav');
makeWav(a, 24000, 2);
makeWav(b, 24000, 2);

// --- 引数の解釈 ---
{
	const r = parseArgs([a, b, '--to', 'mp3']);
	check('音声を複数受ける', 'files' in r && r.files.length === 2 && r.to === 'mp3');
	check('--bitrate を省くと 64kbps（決めたこと 2-A）', 'files' in r && r.bitrate === null && DefaultBitrate === 64);
	check('--rate ・ --mono ・ --out ・ --force を省くと元のまま ・ 音声と同じフォルダ ・ 上書きしない', 'files' in r &&
		r.rate === null && r.mono === false && r.out === null && r.force === false);
}
{
	const r = parseArgs([a, '--to', 'mp3', '--bitrate', '96', '--rate', '22050', '--mono', '--out', 'o', '--force']);
	check('すべてのオプションを受ける', 'files' in r && r.bitrate === 96 && r.rate === 22050 && r.mono && r.out === 'o' && r.force);
}
check('--to が無ければ誤り', 'error' in parseArgs([a]));
check('知らない形式は誤り', 'error' in parseArgs([a, '--to', 'xyz']));
check('受ける形式は mp3 ・ wav ・ ogg ・ m4a ・ flac（決めたこと 1-B）',
	JSON.stringify(Object.keys(Formats).sort()) === JSON.stringify(['flac', 'm4a', 'mp3', 'ogg', 'wav']));
check('--bitrate が数でなければ誤り', 'error' in parseArgs([a, '--to', 'mp3', '--bitrate', 'abc']));
check('flac に --bitrate は誤り（可逆なので効かない）', 'error' in parseArgs([a, '--to', 'flac', '--bitrate', '64']));
check('wav に --bitrate は誤り（無圧縮なので効かない）', 'error' in parseArgs([a, '--to', 'wav', '--bitrate', '64']));
check('音声が無ければ誤り', 'error' in parseArgs(['--to', 'mp3']));
check('知らないオプションは誤り', 'error' in parseArgs([a, '--to', 'mp3', '--xyz']));
{
	const r = parseArgs([a, '--to', 'mp3']);
	const v = parseArgs([a, '--to', 'mp3', '--verbose']);
	check('--verbose を省くと false、渡すと true（決めたこと 8）', 'files' in r && r.verbose === false && 'files' in v && v.verbose === true);
}

// --- 多くの音声を渡す（--list ・ --dir。cmd の行の長さの上限への対策、ai-chat-lite #1445） ---
{
	const r = parseArgs(['--list', 'l.txt', '--dir', 'd', '--ext', 'WAV,.mp3', '--to', 'mp3']);
	check('--list ・ --dir ・ --ext を受け、音声の引数が無くてもよい', 'files' in r &&
		JSON.stringify(r.lists) === JSON.stringify(['l.txt']) && JSON.stringify(r.dirs) === JSON.stringify(['d']) &&
		JSON.stringify(r.exts) === JSON.stringify(['wav', 'mp3']));
}
check('--dir に --ext が無ければ誤り（決めたこと 6-A）', 'error' in parseArgs(['--dir', 'd', '--to', 'mp3']));
check('--ext だけで --dir が無ければ誤り', 'error' in parseArgs([a, '--ext', 'wav', '--to', 'mp3']));
{
	const d = path.join(work, 'many');
	fs.mkdirSync(path.join(d, 'deep'), { recursive: true });
	for (const n of ['b.WAV', 'a.wav', 'c.mp3', 'x.txt', 'deep/z.wav']) { fs.writeFileSync(path.join(d, n), ''); }
	fs.writeFileSync(path.join(d, 'list.txt'), '# 一覧\r\na.wav\r\n\r\n' + path.join(d, 'c.mp3') + '\r\n  \r\n');
	const listed = collectFiles({ files: [], lists: [path.join(d, 'list.txt')], dirs: [], exts: [] });
	check('一覧ファイルは 1 行 1 パスで、空行と # の行を飛ばし、相対パスは一覧ファイルから見る（決めたこと 5-A）', 'files' in listed &&
		JSON.stringify(listed.files) === JSON.stringify([path.join(d, 'a.wav'), path.join(d, 'c.mp3')]), JSON.stringify(listed));
	const dir = collectFiles({ files: [], lists: [], dirs: [d], exts: ['wav'] });
	check('フォルダ直下の、拡張子が合うファイルを名前順に拾い、大小を問わず、下の階層は見ない（決めたこと 7-A）', 'files' in dir &&
		JSON.stringify(dir.files) === JSON.stringify([path.join(d, 'a.wav'), path.join(d, 'b.WAV')]), JSON.stringify(dir));
	const both = collectFiles({ files: [path.join(d, 'A.wav')], lists: [path.join(d, 'list.txt')], dirs: [d], exts: ['wav', 'mp3'] });
	check('引数 ・ 一覧 ・ フォルダで重なったファイルは 1 回だけにする', 'files' in both && both.files.length === 3, JSON.stringify(both));
	check('一覧ファイルが無ければ誤り', 'error' in collectFiles({ files: [], lists: [path.join(d, 'none.txt')], dirs: [], exts: [] }));
	check('フォルダが無ければ誤り', 'error' in collectFiles({ files: [], lists: [], dirs: [path.join(d, 'none')], exts: ['wav'] }));
	check('フォルダで 1 本も見つからなければ誤り', 'error' in collectFiles({ files: [], lists: [], dirs: [d], exts: ['ogg'] }));
	const r = run(['--list', path.join(d, 'none.txt'), '--to', 'mp3']);
	check('一覧ファイルが無ければ終了コード 2', r.code === 2, 'code=' + r.code);
}

// --- ffmpeg に渡す引数 ---
{
	const p = parseArgs([a, '--to', 'mp3']);
	const r = 'files' in p ? buildFfmpegArgs(p, a) : { error: 'parse' };
	check('mp3 は libmp3lame ・ 64k で、拡張子だけを変えた名前に出す', 'args' in r &&
		r.output === path.join(work, 'a.mp3') &&
		JSON.stringify(r.args) === JSON.stringify(['-hide_banner', '-nostdin', '-n', '-i', a, '-c:a', 'libmp3lame', '-b:a', '64k', path.join(work, 'a.mp3')]));
}
{
	const p = parseArgs([a, '--to', 'mp3', '--rate', '22050', '--mono', '--out', path.join(work, 'o'), '--force']);
	const r = 'files' in p ? buildFfmpegArgs(p, a) : { error: 'parse' };
	check('--rate ・ --mono ・ --out ・ --force を ffmpeg の -ar ・ -ac ・ 出し先 ・ -y にする', 'args' in r &&
		r.output === path.join(work, 'o', 'a.mp3') &&
		JSON.stringify(r.args) === JSON.stringify(['-hide_banner', '-nostdin', '-y', '-i', a, '-c:a', 'libmp3lame', '-b:a', '64k', '-ar', '22050', '-ac', '1', path.join(work, 'o', 'a.mp3')]));
}
{
	const p = parseArgs([a, '--to', 'wav', '--rate', '16000']);
	const r = 'files' in p ? buildFfmpegArgs(p, a) : { error: 'parse' };
	check('wav から wav（同じ名前）は誤り（入力を壊さない）', 'error' in r);
}

// --- ffmpeg を探す ---
{
	const d = path.join(work, 'vendor');
	check('ffmpeg が無ければ null', findFfmpeg(d) === null);
	fs.mkdirSync(path.join(d, 'ffmpeg-9.0.2-essentials_build', 'bin'), { recursive: true });
	fs.writeFileSync(path.join(d, 'ffmpeg-9.0.2-essentials_build', 'bin', 'ffmpeg.exe'), '');
	check('下の階層の ffmpeg.exe を見つける（zip の構成に左右されない）', findFfmpeg(d) === path.join(d, 'ffmpeg-9.0.2-essentials_build', 'bin', 'ffmpeg.exe'));
}

// --- 起動して確かめる（ffmpeg を要らないもの） ---
check('引数なしは終了コード 2', run([]).code === 2);
check('音声が無ければ終了コード 2', run([path.join(work, 'none.wav'), '--to', 'mp3']).code === 2);
{
	const r = run([a, '--to', 'mp3'], { CONVERT_AUDIO_VENDOR: path.join(work, 'empty') });
	check('ffmpeg が無ければ終了コード 2 で、置き場を案内する', r.code === 2 && r.err.includes('_vendor/ffmpeg'), 'code=' + r.code + ' err=' + r.err.trim());
}
{
	fs.writeFileSync(path.join(work, 'sub', 'b.mp3'), 'existing');
	const r = run([b, '--to', 'mp3'], { CONVERT_AUDIO_VENDOR: path.join(work, 'vendor') });
	check('出力が既にあれば上書きせず終了コード 2（決めたこと 3-A）', r.code === 2 && fs.readFileSync(path.join(work, 'sub', 'b.mp3'), 'utf8') === 'existing', 'code=' + r.code);
	fs.rmSync(path.join(work, 'sub', 'b.mp3'));
}

// --- ffmpeg を要るもの ---
const ff = findFfmpeg(vendor);
if (ff === null) {
	skipped('mp3 に変え、指定どおりのビットレート ・ 周波数 ・ チャンネル数になる', '_vendor/ffmpeg/ が無い');
	skipped('5 形式すべてに変えられる', '_vendor/ffmpeg/ が無い');
} else {
	const ffprobe = path.join(path.dirname(ff), 'ffprobe.exe');
	const probe = (f: string): string => spawnSync(ffprobe, ['-v', 'error', '-show_entries', 'stream=codec_name,sample_rate,channels,bit_rate', '-of', 'default=nw=1', f], { encoding: 'utf8' }).stdout;
	{
		const r = run([a, b, '--to', 'mp3', '--rate', '22050', '--mono']);
		const p = probe(path.join(work, 'a.mp3'));
		check('mp3 に変え、指定どおりのビットレート ・ 周波数 ・ チャンネル数になる', r.code === 0 &&
			p.includes('codec_name=mp3') && p.includes('sample_rate=22050') && p.includes('channels=1') && p.includes('bit_rate=64000'),
			'code=' + r.code + ' probe=' + p.replace(/\r?\n/g, ' ') + ' err=' + r.err.slice(-200));
		const listed = r.out.trim().split(/\r?\n/);
		check('標準出力には出したファイルの一覧だけを出す', JSON.stringify(listed) === JSON.stringify([path.join(work, 'a.mp3'), path.join(work, 'sub', 'b.mp3')]), JSON.stringify(listed));
	}
	{
		const codecs: Record<string, string> = { mp3: 'mp3', ogg: 'vorbis', m4a: 'aac', flac: 'flac', wav: 'pcm_s16le' };
		const bad: string[] = [];
		for (const to of Object.keys(codecs)) {
			const out = path.join(work, 'all');
			const r = run([a, '--to', to, '--out', out, '--force']);
			const p = probe(path.join(out, 'a.' + to));
			if (r.code !== 0 || !p.includes('codec_name=' + codecs[to])) { bad.push(to + '(code=' + r.code + ')'); }
		}
		check('5 形式すべてに変えられる', bad.length === 0, bad.join(' '));
	}
	{
		const out = path.join(work, 'fromdir');
		fs.writeFileSync(path.join(work, 'list2.txt'), 'a.wav\n');
		const r = run(['--dir', path.join(work, 'sub'), '--ext', 'wav', '--list', path.join(work, 'list2.txt'), '--to', 'mp3', '--out', out]);
		check('--dir と --list で渡した音声を変える', r.code === 0 && fs.existsSync(path.join(out, 'a.mp3')) && fs.existsSync(path.join(out, 'b.mp3')), 'code=' + r.code + ' err=' + r.err.slice(-200));
	}
	// 決めたこと 8: 既定では ffmpeg の出力を出さず、失敗したときだけ詳しく出す。--verbose なら 1 件ずつ出す
	{
		const out = path.join(work, 'quiet');
		const r = run([a, '--to', 'mp3', '--out', out]);
		check('既定では成功した ffmpeg の出力を出さない（決めたこと 8）', r.code === 0 && !r.err.includes('Stream mapping'), 'code=' + r.code + ' err=' + r.err.slice(-200));
		const v = run([a, b, '--to', 'mp3', '--out', path.join(work, 'loud')]);
		check('--verbose が無ければ 2 件でも ffmpeg の出力は 0 回', v.code === 0 && v.err.split('Stream mapping').length - 1 === 0, 'err=' + v.err.slice(-200));
		const w = run([a, b, '--to', 'mp3', '--out', path.join(work, 'loud2'), '--verbose']);
		check('--verbose なら ffmpeg の出力を 1 件ずつ出す', w.code === 0 && w.err.split('Stream mapping').length - 1 === 2, 'code=' + w.code + ' err=' + w.err.slice(-200));
	}
	{
		const broken = path.join(work, 'broken.wav');
		fs.writeFileSync(broken, 'これは音声ではない');
		const r = run([broken, '--to', 'mp3', '--out', path.join(work, 'ng')]);
		check('失敗したときは ffmpeg の出力を詳しく出し、終了コード 1（決めたこと 8）', r.code === 1 && r.err.includes('broken.wav') && r.err.includes('[NG]') && /Invalid data|Error/i.test(r.err), 'code=' + r.code + ' err=' + r.err.slice(-300));
	}
	{
		// bun は、既にあるフォルダを .. を含む相対パスで mkdirSync(recursive) すると EEXIST を投げる（ai-chat-lite #1445）
		fs.mkdirSync(path.join(work, 'exists'), { recursive: true });
		const r = run([a, '--to', 'mp3', '--out', '..\\exists'], {}, path.join(work, 'sub'));
		check('既にあるフォルダを .. を含む相対パスで --out に渡せる', r.code === 0 && fs.existsSync(path.join(work, 'exists', 'a.mp3')), 'code=' + r.code + ' err=' + r.err.slice(-200));
	}
}

fs.rmSync(work, { recursive: true, force: true });
console.log('');
const tail = skip > 0 ? '（⬜ 未実施 ' + skip + ' 件）' : '';
console.log(fail === 0 ? '=== ' + pass + ' 件すべて成功' + tail + ' ===' : '=== ' + fail + ' 件失敗（成功 ' + pass + ' 件）' + tail + ' ===');
process.exit(fail === 0 ? 0 : 1);
