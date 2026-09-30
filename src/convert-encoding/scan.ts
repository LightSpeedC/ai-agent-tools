/*
	フォルダの下を再帰して、1 ファイルずつ文字コードと改行を見る。

	書き込みは行わない（--info ・ --check の土台）。
*/

import * as fs from 'node:fs';
import * as path from 'node:path';
import type { EncKind, EolKind } from '../lib/codec.ts';
import { countEol, decode, describeEol, isAscii } from '../lib/codec.ts';
import { detect } from '../lib/detector.ts';

/** 1 ファイルを見た結果 */
export interface ScanEntry {
	/** 表示に使う名前。フォルダを渡したときはそこからの相対パス（区切りは /） */
	display: string;
	kind: EncKind;
	crlf: number;
	lf: number;
	cr: number;
	size: number;
	/** 純 ASCII（utf8 と sjis でバイト列が同じ） */
	ascii: boolean;
	/** あるべき組の呼び名。拡張子をそのまま使う（ps1・cmd・ts・txt） */
	ruleName: string;
	wantKind: EncKind;
	/** あるべき改行。null は「定めていないので問わない」 */
	wantEol: EolKind | null;
	encBad: boolean;
	eolBad: boolean;
}

function isBad(e: ScanEntry): boolean { return e.encBad || e.eolBad; }

/** 既定で見ないフォルダ。生成物と一時物 */
const DefaultExcludeDirs = ['tmp', 'etc', 'node_modules', '.git'];

/**
 * 改行を LF と定めている拡張子。自分たちが書くものを挙げる。
 * ここにも下の switch にも無い拡張子（txt・log・csv 等）は改行を問わない。
 * .gitattributes の「* text=auto eol=lf」で git に入る時点で LF に正規化される
 * ため、作業ツリーの改行まで縛る実益が薄い（手で CRLF にした txt が毎回違反に出る）。
 * 文字コードは git が変換しないので、そちらは拡張子によらず見る。
 */
const LfExtensions = [
	'md', 'js', 'mjs', 'cjs', 'ts', 'tsx', 'jsx', 'json', 'jsonc',
	'css', 'scss', 'cs', 'go', 'rs', 'py', 'rb', 'java', 'sql',
	'yml', 'yaml', 'toml', 'sh', 'svg', 'xml', 'gitignore', 'editorconfig',
];

function containsName(names: string[], name: string): boolean {
	const lower = name.toLowerCase();
	for (const n of names) {
		if (n.toLowerCase() === lower) { return true; }
	}
	return false;
}

/**
 * 拡張子ごとのあるべき組。文字コードは、ここに無いものを
 * 「BOM 無し UTF-8」として見る（.editorconfig の [*]）。
 * 改行は LfExtensions と下の switch に挙げたものだけを見る。
 */
export function ruleFor(p: string): { name: string; kind: EncKind; eol: EolKind | null } {
	let ext = path.extname(p);
	ext = ext.replace(/^\./, '').toLowerCase();

	// 呼び名は拡張子そのもの。用途名を別に持つと、用途名の無い
	// ts・md を「既定」と呼ぶことになり、何に対する規約か読めなくなる
	const name = ext.length > 0 ? ext : '既定';

	switch (ext) {
		case 'ps1':
			return { name: name, kind: 'utf8bom', eol: 'crlf' };
		case 'cmd':
		case 'bat':
			return { name: name, kind: 'sjis', eol: 'crlf' };
		case 'reg':
			return { name: name, kind: 'utf16le', eol: 'crlf' };
		case 'html':
		case 'htm':
			return { name: name, kind: 'utf8bom', eol: 'lf' };
		default:
			return {
				name: name,
				kind: 'utf8',
				eol: containsName(LfExtensions, ext) ? 'lf' : null,
			};
	}
}

/** UTF-16 でないのに NUL を含めばバイナリとみなす（text find と同じ判定） */
function looksBinary(b: Uint8Array, kind: EncKind): boolean {
	if (kind === 'utf16le' || kind === 'utf16be') { return false; }
	for (let i = 0; i < b.length; i++) {
		if (b[i] === 0x00) { return true; }
	}
	return false;
}

/** BOM を持たない単バイトの組。純 ASCII なら互いに同じバイト列になる */
function isSingleByteNoBom(kind: EncKind): boolean {
	return kind === 'utf8' || kind === 'sjis';
}

/**
 * 1 ファイルを見る。読めない・判定できない・バイナリなら null（見なかった扱い）。
 */
export function inspect(p: string, display: string): ScanEntry | null {
	let bytes: Uint8Array;
	try {
		bytes = new Uint8Array(fs.readFileSync(p));
	} catch {
		return null;
	}

	const kind = detect(bytes);
	if (kind == null) { return null; }
	if (looksBinary(bytes, kind)) { return null; }

	const text = decode(bytes, kind);
	const counts = countEol(text);
	const rule = ruleFor(p);
	const ascii = isAscii(bytes);

	const e: ScanEntry = {
		display: display,
		kind: kind,
		crlf: counts.crlf,
		lf: counts.lf,
		cr: counts.cr,
		size: bytes.length,
		ascii: ascii,
		ruleName: rule.name,
		wantKind: rule.kind,
		wantEol: rule.eol,
		encBad: false,
		eolBad: false,
	};

	// 純 ASCII のときは UTF-8 と SJIS でバイト列が同じになる。判定はどちらかに
	// 寄るが、どちらでも規約どおりのバイト列なので違反にしない
	// （日本語を含まない cmd を SJIS でないと言わないため）
	e.encBad = kind !== rule.kind
		&& !(ascii && isSingleByteNoBom(kind) && isSingleByteNoBom(rule.kind));

	// 改行が混ざっていれば、それだけで規約に合わない。単独の CR も同じ。
	// ここは拡張子によらず見る（どの種類でも事故のため）。
	// 改行がまったく無いファイルは、どちらとも言えないので合っている扱いにする。
	let kinds = 0;
	if (counts.crlf > 0) { kinds++; }
	if (counts.lf > 0) { kinds++; }
	if (counts.cr > 0) { kinds++; }

	if (kinds === 0) { e.eolBad = false; }
	else if (kinds > 1 || counts.cr > 0) { e.eolBad = true; }
	else if (rule.eol == null) { e.eolBad = false; }   // 改行を定めていない拡張子
	else { e.eolBad = rule.eol === 'crlf' ? counts.crlf === 0 : counts.lf === 0; }

	return e;
}

/**
 * * と ? だけを見る単純な照合。大小は区別しない。
 * 正規表現へ組み替えると、パターンの記号がそのまま効いて驚きが出るため自前で持つ。
 */
export function isMatch(name: string, pattern: string): boolean {
	return match(name.toLowerCase(), 0, pattern.toLowerCase(), 0);
}

function match(s: string, si: number, p: string, pi: number): boolean {
	while (pi < p.length) {
		const pc = p[pi];
		if (pc === '*') {
			// 末尾の * は残り全部に当たる
			if (pi + 1 === p.length) { return true; }
			for (let k = si; k <= s.length; k++) {
				if (match(s, k, p, pi + 1)) { return true; }
			}
			return false;
		}

		if (si >= s.length) { return false; }
		if (pc !== '?' && pc !== s[si]) { return false; }
		si++;
		pi++;
	}
	return si === s.length;
}

function matchAny(name: string, patterns: string[]): boolean {
	for (const p of patterns) {
		if (isMatch(name, p)) { return true; }
	}
	return false;
}

function collect(dir: string, skipDirs: string[], files: string[]): void {
	let entries: fs.Dirent[];
	try {
		entries = fs.readdirSync(dir, { withFileTypes: true });
	} catch {
		return;
	}

	for (const ent of entries) {
		const name = ent.name;
		if (name.startsWith('_')) { continue; }   // 共通ルールで全階層 Git 管理外
		const full = path.join(dir, name);
		if (ent.isDirectory()) {
			if (containsName(skipDirs, name)) { continue; }
			collect(full, skipDirs, files);
		} else if (ent.isFile()) {
			files.push(full);
		}
	}
}

/**
 * フォルダの下のファイルを集める。見ないもの（既定のフォルダ・先頭 _ ・
 * 読めないもの・バイナリ）はここで落とす。
 */
export function walk(root: string, include: string[], exclude: string[], excludeDirs: string[]): ScanEntry[] {
	const skipDirs = DefaultExcludeDirs.concat(excludeDirs ?? []);

	const files: string[] = [];
	collect(root, skipDirs, files);
	files.sort((a, b) => (a.toLowerCase() < b.toLowerCase() ? -1 : a.toLowerCase() > b.toLowerCase() ? 1 : 0));

	let prefix = path.resolve(root);
	if (!prefix.endsWith(path.sep)) { prefix += path.sep; }

	const result: ScanEntry[] = [];
	for (const file of files) {
		const name = path.basename(file);

		if (include != null && include.length > 0 && !matchAny(name, include)) { continue; }
		if (exclude != null && exclude.length > 0 && matchAny(name, exclude)) { continue; }

		let display = path.resolve(file);
		if (display.toLowerCase().startsWith(prefix.toLowerCase())) {
			display = display.substring(prefix.length);
		}
		display = display.replace(/\\/g, '/');

		const entry = inspect(file, display);
		if (entry != null) { result.push(entry); }
	}
	return result;
}

// ---- 表示 ----------------------------------------------------------------

/** いまの組の名前。純 ASCII は utf8 と sjis を区別できないので ascii と書く */
function encNameOf(e: ScanEntry): string {
	if (e.ascii && isSingleByteNoBom(e.kind)) { return 'ascii'; }
	return e.kind;
}

/** いまの組。utf8bom+lf の形 */
function describeNow(e: ScanEntry): string {
	return encNameOf(e) + '+' + describeEol(e.crlf, e.lf, e.cr);
}

/**
 * あるべき組。utf8bom+crlf の形。改行を定めていない拡張子では組だけを書く
 * （「+lf」と書くと、定めていないものを定めているように読めるため）。
 */
function describeWant(e: ScanEntry): string {
	let s: string = e.wantKind;
	if (e.wantEol != null) { s += '+' + e.wantEol; }
	else if (e.eolBad) { s += '（改行を混ぜない）'; }
	return s;
}

/** 違うところだけを short に言う（--info の行末に足す用） */
function describeDiff(e: ScanEntry): string {
	if (e.encBad && e.eolBad) { return describeWant(e); }
	if (e.encBad) { return e.wantKind; }
	// 改行の違反は、定めている拡張子でしか立たない。混在・単独 CR のときは
	// 定めていない拡張子でも立つので、その場合はどちらかに寄せず示す
	return e.wantEol != null ? e.wantEol : '改行を混ぜない';
}

function padRight(s: string, width: number): string {
	return s.length >= width ? s : s + ' '.repeat(width - s.length);
}

function withCommas(n: number): string {
	return n.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/**
 * --info の書き方。全件を同じ形で並べ、規約に合わないものには
 * あるべき組を付け足す。終了コードは呼び出し側で常に 0 にする。
 */
export function formatInfo(entries: ScanEntry[]): string {
	let wName = 0, wEnc = 0, wCrLf = 0, wLf = 0, wCr = 0;
	for (const e of entries) {
		wName = Math.max(wName, e.display.length);
		wEnc = Math.max(wEnc, encNameOf(e).length);
		wCrLf = Math.max(wCrLf, String(e.crlf).length);
		wLf = Math.max(wLf, String(e.lf).length);
		wCr = Math.max(wCr, String(e.cr).length);
	}

	let bad = 0;
	let sb = '';
	for (const e of entries) {
		if (isBad(e)) { bad++; }

		sb += padRight(e.display, wName);
		sb += '  ' + padRight(encNameOf(e), wEnc);
		sb += '  crlf=' + padRight(String(e.crlf), wCrLf);
		sb += '  lf=' + padRight(String(e.lf), wLf);
		sb += '  cr=' + padRight(String(e.cr), wCr);
		sb += '  ' + withCommas(e.size) + ' bytes';
		if (isBad(e)) { sb += '  → ' + e.ruleName + ' は ' + describeDiff(e); }
		sb += '\n';
	}

	sb += '\n';
	sb += '=== ' + entries.length + ' 件（うち規約に合わないもの ' + bad + ' 件）===\n';
	return sb;
}

/** --check の書き方。規約に合わないものだけを出す */
export function formatCheck(entries: ScanEntry[]): { text: string; bad: number } {
	const ng = entries.filter(isBad);

	let wName = 0, wNow = 0;
	for (const e of ng) {
		wName = Math.max(wName, e.display.length);
		wNow = Math.max(wNow, describeNow(e).length);
	}

	let sb = '';
	for (const e of ng) {
		sb += padRight(e.display, wName);
		sb += '  ' + padRight(describeNow(e), wNow);
		sb += '  → ' + e.ruleName + ' は ' + describeWant(e);
		sb += '\n';
	}

	if (ng.length === 0) {
		sb += '=== 規約どおりです ===\n';
	} else {
		sb += '\n';
		sb += '=== ' + ng.length + ' 件が規約に合いません ===\n';
	}
	return { text: sb, bad: ng.length };
}
