/*
	convert-audio: 音声の形式を ffmpeg で変える（i261012-02）。

	形式を足すときは Formats に 1 行と、テストを 1 件足す。
	--bitrate は可逆 ・ 無圧縮の形式（flac ・ wav）では効かないので、渡したら誤りにする。
*/
import * as fs from 'node:fs';
import * as path from 'node:path';
import { type Sources, takeSourceOption, checkSources } from '../audio-files/audio-files.ts';

/** 形式ごとの ffmpeg のエンコーダと、ビットレートを受けるか */
export const Formats: Record<string, { codec: string, bitrate: boolean }> = {
	mp3: { codec: 'libmp3lame', bitrate: true },
	ogg: { codec: 'libvorbis', bitrate: true },
	m4a: { codec: 'aac', bitrate: true },
	flac: { codec: 'flac', bitrate: false },
	wav: { codec: 'pcm_s16le', bitrate: false },
};

/** --bitrate を省いたときの値（kbps）。読み上げの声なら聞き取りに差が出にくい */
export const DefaultBitrate = 64;

export interface Options extends Sources {
	to: string;
	/** null なら DefaultBitrate（ビットレートを受ける形式のとき） */
	bitrate: number | null;
	/** null なら元のまま */
	rate: number | null;
	mono: boolean;
	/** null なら音声と同じフォルダ */
	out: string | null;
	force: boolean;
	/** ffmpeg の出力を 1 件ずつ出す。既定では失敗したときだけ出す（決めたこと 8） */
	verbose: boolean;
}

function toPositiveInt(v: string): number | null {
	return /^[1-9][0-9]*$/.test(v) ? Number(v) : null;
}

export function parseArgs(argv: string[]): Options | { error: string } {
	const o: Options = { files: [], lists: [], dirs: [], exts: [], to: '', bitrate: null, rate: null, mono: false, out: null, force: false, verbose: false };
	for (let i = 0; i < argv.length; i++) {
		const a = argv[i];
		const took = takeSourceOption(o, a, argv[i + 1]);
		if (took !== null) {
			if (typeof took !== 'number') { return took; }
			i += took;
		} else if (a === '--to' || a === '--bitrate' || a === '--rate' || a === '--out') {
			const v = argv[i + 1];
			if (v === undefined || v.startsWith('--')) { return { error: a + ' に値がありません' }; }
			i++;
			if (a === '--to') { o.to = v.toLowerCase(); }
			else if (a === '--out') { o.out = v; }
			else {
				const n = toPositiveInt(v);
				if (n === null) { return { error: a + ' は正の整数で渡してください: ' + v }; }
				if (a === '--bitrate') { o.bitrate = n; } else { o.rate = n; }
			}
		} else if (a === '--mono') {
			o.mono = true;
		} else if (a === '--force') {
			o.force = true;
		} else if (a === '--verbose') {
			o.verbose = true;
		} else if (a.startsWith('--')) {
			return { error: '知らないオプションです: ' + a };
		} else {
			o.files.push(a);
		}
	}
	const bad = checkSources(o);
	if (bad !== null) { return { error: bad }; }
	if (o.to === '') { return { error: '--to で形式を渡してください（' + Object.keys(Formats).join(' ・ ') + '）' }; }
	const f = Formats[o.to];
	if (f === undefined) { return { error: '知らない形式です: ' + o.to + '（' + Object.keys(Formats).join(' ・ ') + '）' }; }
	if (o.bitrate !== null && !f.bitrate) { return { error: o.to + ' は --bitrate を受けません（可逆 ・ 無圧縮のため）' }; }
	return o;
}

/** 1 ファイル分の ffmpeg の引数と出力先。出力名は拡張子だけを変える */
export function buildFfmpegArgs(o: Options, file: string): { args: string[], output: string } | { error: string } {
	const f = Formats[o.to];
	const dir = o.out ?? path.dirname(file);
	const output = path.join(dir, path.basename(file, path.extname(file)) + '.' + o.to);
	if (path.resolve(output).toLowerCase() === path.resolve(file).toLowerCase()) {
		return { error: '入力と出力が同じファイルになります（--out で別のフォルダを渡してください）: ' + file };
	}
	// -n は既存の出力を上書きしない。-y は上書きする（--force）
	const args = ['-hide_banner', '-nostdin', o.force ? '-y' : '-n', '-i', file, '-c:a', f.codec];
	if (f.bitrate) { args.push('-b:a', (o.bitrate ?? DefaultBitrate) + 'k'); }
	if (o.rate !== null) { args.push('-ar', String(o.rate)); }
	if (o.mono) { args.push('-ac', '1'); }
	args.push(output);
	return { args: args, output: output };
}

/** vendorDir の下から ffmpeg.exe を探す。配布 zip の構成（版の名前のフォルダ）に左右されないようにする */
export function findFfmpeg(vendorDir: string): string | null {
	if (!fs.existsSync(vendorDir)) { return null; }
	const stack = [vendorDir];
	while (stack.length > 0) {
		const d = stack.pop() as string;
		for (const e of fs.readdirSync(d, { withFileTypes: true })) {
			const p = path.join(d, e.name);
			if (e.isDirectory()) { stack.push(p); }
			else if (e.name.toLowerCase() === 'ffmpeg.exe') { return p; }
		}
	}
	return null;
}
