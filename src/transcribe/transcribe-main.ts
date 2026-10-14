/*
	transcribe の入口。使い方:
		transcribe <音声…> [--list <一覧ファイル>] [--dir <フォルダ> --ext <拡張子,…>] [--lang ja] [--model <パス>] [--out <フォルダ>] [--verbose]

	終了コード: 0 成功 ／ 1 書き起こしの失敗 ／ 2 引数の誤り ・ whisper-cli ・ モデル ・ 音声が無い
	whisper-cli の出力は、失敗したときだけ標準エラーへ出す（--verbose なら出す）。標準出力には出したファイルの一覧だけを出す。
*/
import * as fs from 'node:fs';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseArgs, buildWhisperArgs, findWhisperCli, DefaultModel } from './transcribe.ts';
import { collectFiles } from '../audio-files/audio-files.ts';

const Usage = 'transcribe <音声…> [--list <一覧ファイル>] [--dir <フォルダ> --ext <拡張子,…>] [--lang ja] [--model <パス>] [--out <フォルダ>] [--verbose]';

function fail(message: string, code: number): never {
	console.error('[NG] ' + message);
	process.exit(code);
}

const here = path.dirname(fileURLToPath(import.meta.url));
// テストが置き場を差し替えられるようにする（本物の _vendor を触らない）
const vendor = process.env.TRANSCRIBE_VENDOR || path.resolve(here, '..', '..', '_vendor', 'whisper');

const parsed = parseArgs(process.argv.slice(2));
if ('error' in parsed) { fail(parsed.error + '\n使い方: ' + Usage, 2); }
const collected = collectFiles(parsed);
if ('error' in collected) { fail(collected.error, 2); }
parsed.files = collected.files;

for (const f of parsed.files) {
	if (!fs.existsSync(f)) { fail('音声が見つかりません: ' + f, 2); }
}

const cli = findWhisperCli(vendor);
if (cli === null) {
	fail('whisper-cli.exe が見つかりません。ai-agent-tools の _vendor/whisper/ に置きます（入手は ai-agent-tools 側で行う。i261012-01）', 2);
}
const model = parsed.model ?? path.join(vendor, DefaultModel);
if (!fs.existsSync(model)) { fail('モデルが見つかりません: ' + model, 2); }
// 絶対パスにしてから作る。bun は、既にあるフォルダを .. を含む相対パスで作ると EEXIST を投げる（ai-chat-lite #1445）
if (parsed.out !== null) { fs.mkdirSync(path.resolve(parsed.out), { recursive: true }); }

const built = buildWhisperArgs({ ...parsed, model: model });
if ('error' in built) { fail(built.error, 2); }

// 決めたこと 8 ・ 10-A: --verbose なら whisper-cli の出力をそのまま標準エラーへ。既定では受け取っておき、失敗したときだけ出す。
// 標準出力は一覧のために空けておく
const r = parsed.verbose
	? spawnSync(cli, built.args, { stdio: ['ignore', process.stderr, process.stderr] })
	: spawnSync(cli, built.args, { stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024 });
const showLog = (): void => { if (!parsed.verbose) { process.stderr.write(String(r.stdout ?? '') + String(r.stderr ?? '')); } };
if (r.error) { fail('whisper-cli を起動できません: ' + r.error.message, 1); }
if (r.status !== 0) { showLog(); fail('whisper-cli が失敗しました（終了コード ' + r.status + '）: ' + parsed.files.join(' ・ '), 1); }

const made: string[] = [];
for (const o of built.outputs) {
	for (const ext of ['.txt', '.json']) {
		if (!fs.existsSync(o + ext)) { showLog(); fail('書き起こしが出ていません: ' + o + ext, 1); }
		made.push(o + ext);
	}
}
for (const m of made) { console.log(m); }
