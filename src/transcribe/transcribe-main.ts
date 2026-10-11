/*
	transcribe の入口。使い方:
		transcribe <音声…> [--lang ja] [--model <パス>] [--out <フォルダ>]

	終了コード: 0 成功 ／ 1 書き起こしの失敗 ／ 2 引数の誤り ・ whisper-cli ・ モデル ・ 音声が無い
	whisper-cli の進捗は標準エラーへ流し、標準出力には出したファイルの一覧だけを出す。
*/
import * as fs from 'node:fs';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseArgs, buildWhisperArgs, findWhisperCli, DefaultModel } from './transcribe.ts';

const Usage = 'transcribe <音声…> [--lang ja] [--model <パス>] [--out <フォルダ>]';

function fail(message: string, code: number): never {
	console.error('[NG] ' + message);
	process.exit(code);
}

const here = path.dirname(fileURLToPath(import.meta.url));
// テストが置き場を差し替えられるようにする（本物の _vendor を触らない）
const vendor = process.env.TRANSCRIBE_VENDOR || path.resolve(here, '..', '..', '_vendor', 'whisper');

const parsed = parseArgs(process.argv.slice(2));
if ('error' in parsed) { fail(parsed.error + '\n使い方: ' + Usage, 2); }

for (const f of parsed.files) {
	if (!fs.existsSync(f)) { fail('音声が見つかりません: ' + f, 2); }
}

const cli = findWhisperCli(vendor);
if (cli === null) {
	fail('whisper-cli.exe が見つかりません。ai-agent-tools の _vendor/whisper/ に置きます（入手は ai-agent-tools 側で行う。i261012-01）', 2);
}
const model = parsed.model ?? path.join(vendor, DefaultModel);
if (!fs.existsSync(model)) { fail('モデルが見つかりません: ' + model, 2); }
if (parsed.out !== null) { fs.mkdirSync(parsed.out, { recursive: true }); }

const built = buildWhisperArgs({ ...parsed, model: model });
if ('error' in built) { fail(built.error, 2); }

// 進捗は標準エラーへ。標準出力は一覧のために空けておく
const r = spawnSync(cli, built.args, { stdio: ['ignore', process.stderr, process.stderr] });
if (r.error) { fail('whisper-cli を起動できません: ' + r.error.message, 1); }
if (r.status !== 0) { fail('whisper-cli が失敗しました（終了コード ' + r.status + '）', 1); }

const made: string[] = [];
for (const o of built.outputs) {
	for (const ext of ['.txt', '.json']) {
		if (!fs.existsSync(o + ext)) { fail('書き起こしが出ていません: ' + o + ext, 1); }
		made.push(o + ext);
	}
}
for (const m of made) { console.log(m); }
