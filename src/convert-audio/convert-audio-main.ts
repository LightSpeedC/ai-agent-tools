/*
	convert-audio の入口。使い方:
		convert-audio <音声…> [--list <一覧ファイル>] [--dir <フォルダ> --ext <拡張子,…>] --to <形式> [--bitrate <kbps>] [--rate <Hz>] [--mono] [--out <フォルダ>] [--force] [--verbose]

	終了コード: 0 成功 ／ 1 変換の失敗 ／ 2 引数の誤り ・ ffmpeg ・ 音声が無い ・ 出力が既にある
	ffmpeg の出力は、失敗したときだけ標準エラーへ出す（--verbose なら 1 件ずつ出す）。標準出力には出したファイルの一覧だけを出す。
*/
import * as fs from 'node:fs';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseArgs, buildFfmpegArgs, findFfmpeg, Formats } from './convert-audio.ts';
import { collectFiles } from '../audio-files/audio-files.ts';

const Usage = 'convert-audio <音声…> [--list <一覧ファイル>] [--dir <フォルダ> --ext <拡張子,…>] --to <' + Object.keys(Formats).join('|') + '> [--bitrate <kbps>] [--rate <Hz>] [--mono] [--out <フォルダ>] [--force] [--verbose]';

function fail(message: string, code: number): never {
	console.error('[NG] ' + message);
	process.exit(code);
}

const here = path.dirname(fileURLToPath(import.meta.url));
// テストが置き場を差し替えられるようにする（本物の _vendor を触らない）
const vendor = process.env.CONVERT_AUDIO_VENDOR || path.resolve(here, '..', '..', '_vendor', 'ffmpeg');

const parsed = parseArgs(process.argv.slice(2));
if ('error' in parsed) { fail(parsed.error + '\n使い方: ' + Usage, 2); }
const collected = collectFiles(parsed);
if ('error' in collected) { fail(collected.error, 2); }
parsed.files = collected.files;

// 1 本でも引っかかるなら、何も変換しないうちに止める
const jobs: { args: string[], output: string }[] = [];
const seen = new Set<string>();
for (const f of parsed.files) {
	if (!fs.existsSync(f)) { fail('音声が見つかりません: ' + f, 2); }
	const b = buildFfmpegArgs(parsed, f);
	if ('error' in b) { fail(b.error, 2); }
	// Windows は大小を区別しないので、小文字に寄せて比べる
	const key = path.resolve(b.output).toLowerCase();
	if (seen.has(key)) { fail('出力名がぶつかります: ' + b.output, 2); }
	seen.add(key);
	if (!parsed.force && fs.existsSync(b.output)) { fail('出力が既にあります（上書きするなら --force）: ' + b.output, 2); }
	jobs.push(b);
}

const ffmpeg = findFfmpeg(vendor);
if (ffmpeg === null) {
	fail('ffmpeg.exe が見つかりません。ai-agent-tools の _vendor/ffmpeg/ に置きます（入手は ai-agent-tools 側で行う。i261012-02）', 2);
}
// 絶対パスにしてから作る。bun は、既にあるフォルダを .. を含む相対パスで作ると EEXIST を投げる（ai-chat-lite #1445）
if (parsed.out !== null) { fs.mkdirSync(path.resolve(parsed.out), { recursive: true }); }

for (const j of jobs) {
	// 決めたこと 8: --verbose なら ffmpeg の出力をそのまま標準エラーへ。既定では受け取っておき、失敗したときだけ出す。
	// 標準出力は一覧のために空けておく
	const r = parsed.verbose
		? spawnSync(ffmpeg, j.args, { stdio: ['ignore', process.stderr, process.stderr] })
		: spawnSync(ffmpeg, j.args, { stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024 });
	if (r.error) { fail('ffmpeg を起動できません: ' + r.error.message, 1); }
	if (r.status !== 0 || !fs.existsSync(j.output)) {
		if (!parsed.verbose) { process.stderr.write(String(r.stdout ?? '') + String(r.stderr ?? '')); }
		fail('変換に失敗しました（終了コード ' + r.status + '）: ' + j.args[j.args.indexOf('-i') + 1] + ' → ' + j.output, 1);
	}
	console.log(j.output);
}
