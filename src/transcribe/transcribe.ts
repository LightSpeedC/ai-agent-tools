/*
	transcribe: 音声を whisper.cpp（whisper-cli）で書き起こす（i261012-01）。

	音声は変換せずにそのまま渡す。whisper-cli は内蔵の miniaudio で読み、
	16kHz 以外（24kHz ・ ステレオ）の WAV も自分で直す（2026-10-12 に b5130 で実測）。
	全ファイルを 1 回の起動でまとめて渡し、モデルの読み込みを 1 回にする。
*/
import * as fs from 'node:fs';
import * as path from 'node:path';

/** --lang を省いたときの言語（使う側はほぼ日本語） */
export const DefaultLang = 'ja';
/** _vendor/whisper/ の下のモデルの置き場 */
export const DefaultModel = path.join('model', 'ggml-large-v3-turbo-q5_0.bin');

export interface Options {
	files: string[];
	lang: string;
	/** null なら _vendor/whisper/ の既定のモデル */
	model: string | null;
	/** null なら音声と同じフォルダ */
	out: string | null;
}

export function parseArgs(argv: string[]): Options | { error: string } {
	const o: Options = { files: [], lang: DefaultLang, model: null, out: null };
	for (let i = 0; i < argv.length; i++) {
		const a = argv[i];
		if (a === '--lang' || a === '--model' || a === '--out') {
			const v = argv[i + 1];
			if (v === undefined || v.startsWith('--')) { return { error: a + ' に値がありません' }; }
			if (a === '--lang') { o.lang = v; }
			else if (a === '--model') { o.model = v; }
			else { o.out = v; }
			i++;
		} else if (a.startsWith('--')) {
			return { error: '知らないオプションです: ' + a };
		} else {
			o.files.push(a);
		}
	}
	if (o.files.length === 0) { return { error: '音声のファイルを渡してください' }; }
	return o;
}

/** 出力名（拡張子なし）。--out が無ければ音声と同じフォルダ */
function outputOf(file: string, out: string | null): string {
	const dir = out ?? path.dirname(file);
	return path.join(dir, path.basename(file, path.extname(file)));
}

/**
 * whisper-cli に渡す引数を組み立てる。-f と -of を組で並べると、
 * 1 回の起動でファイルごとに .txt ・ .json が出る。
 */
export function buildWhisperArgs(o: Options & { model: string }): { args: string[], outputs: string[] } | { error: string } {
	const args = ['-m', o.model, '-l', o.lang, '-np', '-otxt', '-oj'];
	const outputs: string[] = [];
	const seen = new Set<string>();
	for (const f of o.files) {
		const of = outputOf(f, o.out);
		// Windows は大小を区別しないので、小文字に寄せて比べる
		const key = path.resolve(of).toLowerCase();
		if (seen.has(key)) { return { error: '出力名がぶつかります（上書きしないため止めます）: ' + of }; }
		seen.add(key);
		args.push('-f', f, '-of', of);
		outputs.push(of);
	}
	return { args: args, outputs: outputs };
}

/** vendorDir の下から whisper-cli.exe を探す。配布 zip の構成の違いに左右されないようにする */
export function findWhisperCli(vendorDir: string): string | null {
	if (!fs.existsSync(vendorDir)) { return null; }
	const stack = [vendorDir];
	while (stack.length > 0) {
		const d = stack.pop() as string;
		for (const e of fs.readdirSync(d, { withFileTypes: true })) {
			const p = path.join(d, e.name);
			if (e.isDirectory()) { stack.push(p); }
			else if (e.name.toLowerCase() === 'whisper-cli.exe') { return p; }
		}
	}
	return null;
}
