/*
	伏せ字。2 段で守る（計画 p261014-01 の第 3 章）。

	  1 段目 mask        拾った本文を置き換える
	  2 段目 findLeaks   書き出す直前の出力の全体を、もう一度見る

	見つけ方は check-public と共有する（src/lib/public-rules.ts）。
	**当たった値そのものは、どちらの段も画面に出さない。**
*/

import {
	MailPattern, SecretPattern, UserPathPattern, PathPlaceholders,
	Rules, isAllowedMail, looksLikeSecret,
} from '../lib/public-rules.ts';

export type MaskContext = {
	/** 自分のユーザー名。パスの中だけで伏せる（下の注） */
	user: string | null;
	/** マシン名 */
	host: string | null;
	/** git の author（名前とアドレス） */
	authors: string[];
	/** 伏せる語。小文字に寄せてある */
	words: string[];
	/** テストだけが使う。名指しした置き換えを外し、2 段目が止めることを確かめる */
	skip?: Set<string>;
};

/** 置き換えの種類。数えて画面に出すときの名前 */
export const MaskLabels: Record<string, string> = {
	url: 'セッションの URL',
	secret: '認証情報',
	path: 'パス',
	author: 'git の author',
	mail: 'メールアドレス',
	word: '伏せる語',
	host: 'ホスト名',
	ip: 'IP アドレス',
};

/** よく知られた鍵の接頭辞。値の形で分かるもの */
const KeyPatterns = [
	/sk-ant-[A-Za-z0-9_-]{8,}/g,
	/\bsk-[A-Za-z0-9]{20,}/g,
	/\bgh[pousr]_[A-Za-z0-9]{20,}/g,
	/\bgithub_pat_[A-Za-z0-9_]{20,}/g,
	/\bAKIA[0-9A-Z]{16}\b/g,
	/\bxox[abprs]-[A-Za-z0-9-]{10,}/g,
	/\bAIza[0-9A-Za-z_-]{35}/g,
	/\bBearer\s+[A-Za-z0-9._~+/-]{20,}=*/g,
];

const SessionUrlPattern = /https?:\/\/claude\.ai\/code\/session_[A-Za-z0-9_-]+/g;

/*
	内部のホスト名。**後ろに . や英数字が続くものは当てない。**
	`settings.local.json` のようなファイル名を、ホスト名と取り違えないため
*/
const InternalHostPattern = /\b(?:[A-Za-z0-9-]+\.)+(?:local|internal)\b(?![\w.-])/g;

/** プライベートの IPv4。数が 255 を超えるもの（版の番号 10.0.26300.1 等）は当てない */
const PrivateIpPattern = /(?<![\w.])(10\.\d{1,3}\.\d{1,3}\.\d{1,3}|172\.(?:1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3})(?![\w.])/g;

function isIpv4(s: string): boolean {
	return s.split('.').every((n) => Number(n) <= 255);
}

function escapeRegExp(s: string): string {
	return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** 語をそのまま探す式。大小を問わない */
function literal(word: string): RegExp {
	return new RegExp(escapeRegExp(word), 'gi');
}

/*
	ユーザー名をパスの外では伏せない理由。

	Windows のユーザー名は work ・ admin のような普通の語であることが多い。
	本文の全体から語として消すと、会話そのものが壊れる（network も work を含む）。
	**名前が人を指すのは、パスの中に置かれたとき。**そこだけを伏せる。
	人の名前は git の author と伏せる語のリストで拾う。
*/
export function createMasker(ctx: MaskContext) {
	const counts: Record<string, number> = {};
	const on = (kind: string) => !(ctx.skip?.has(kind) ?? false);
	/** 伏せた後の語ごとの数。画面に ✅ 付きで並べる（元の値は持たない） */
	const tokens: Record<string, number> = {};
	/** 数えて、伏せた後の語を返す */
	const put = (kind: string, token: string) => {
		counts[kind] = (counts[kind] ?? 0) + 1;
		tokens[token] = (tokens[token] ?? 0) + 1;
		return token;
	};
	const user = ctx.user?.toLowerCase() ?? null;
	const authors = ctx.authors.filter((a) => a.trim().length > 0);
	const words = ctx.words.filter((w) => w.length > 0);
	// マシン名が短いと、普通の語まで消す。3 文字に満たないものは使わない
	const host = ctx.host != null && ctx.host.length >= 3 ? ctx.host : null;

	function mask(text: string): string {
		let s = text;

		if (on('url')) {
			s = s.replace(SessionUrlPattern, () => put('url', '〈セッションURL〉'));
		}

		if (on('secret')) {
			for (const p of KeyPatterns) {
				s = s.replace(p, () => put('secret', '〈認証情報〉'));
			}
			// password=値 の形。値が認証情報らしいときだけ（判定は check-public と同じ）
			s = s.replace(new RegExp(SecretPattern.source, 'gi'), (all: string, _key: string, value: string) => {
				if (!looksLikeSecret(value)) { return all; }
				return all.slice(0, all.length - value.length) + put('secret', '〈認証情報〉');
			});
		}

		if (on('path')) {
			s = s.replace(UserPathPattern, (all: string, name: string) => {
				const n = name.toLowerCase();
				if (PathPlaceholders.indexOf(n) >= 0) { return all; }
				if (user != null && n === user) { return put('path', '~'); }
				return all.slice(0, all.length - name.length) + put('path', '<username>');
			});
			if (user != null) {
				s = s.replace(new RegExp('(?<![\\w/])/home/' + escapeRegExp(user) + '(?![\\w.-])', 'gi'), () => put('path', '~'));
			}
		}

		if (on('author')) {
			// アドレスの形のものは、文書用のアドレス（example.com）でも伏せる。author は本人だから
			for (const a of authors) {
				s = s.replace(literal(a), () => put('author', a.includes('@') ? '〈メールアドレス〉' : '〈個人名〉'));
			}
		}

		if (on('mail')) {
			s = s.replace(MailPattern, (a: string) => {
				if (isAllowedMail(a)) { return a; }
				return put('mail', '〈メールアドレス〉');
			});
		}

		if (on('word')) {
			for (const w of words) {
				s = s.replace(literal(w), () => put('word', '〈伏せ字〉'));
			}
		}

		if (on('host')) {
			if (host != null) {
				s = s.replace(new RegExp('(?<![\\w-])' + escapeRegExp(host) + '(?![\\w-])', 'gi'), () => put('host', '<hostname>'));
			}
			s = s.replace(InternalHostPattern, () => put('host', '<hostname>'));
		}

		if (on('ip')) {
			s = s.replace(PrivateIpPattern, (ip: string) => {
				if (!isIpv4(ip)) { return ip; }
				return put('ip', '<IPアドレス>');
			});
		}

		return s;
	}

	return { mask, counts, tokens };
}

/*
	2 段目。書き出す直前の 1 行を見て、残っているものの種類を返す。

	1 段目と同じ式に加えて、check-public の規則（メールアドレス ・ 実体パス ・ 認証情報）でも見る。
	**1 段目の書き損じを、別の書き方で拾うための段**。異体字は秘密ではないので見ない。
*/
export function findLeaks(line: string, ctx: MaskContext): string[] {
	const found: string[] = [];
	const lower = line.toLowerCase();
	for (const rule of Rules) {
		if (rule.key === 'script') { continue; }
		if (rule.test(line)) { found.push(rule.label); }
	}
	for (const a of ctx.authors) {
		if (a.length > 0 && lower.includes(a.toLowerCase())) { found.push('git の author'); break; }
	}
	for (const w of ctx.words) {
		if (w.length > 0 && lower.includes(w)) { found.push('伏せる語'); break; }
	}
	if (ctx.host != null && ctx.host.length >= 3 && new RegExp('(?<![\\w-])' + escapeRegExp(ctx.host) + '(?![\\w-])', 'i').test(line)) {
		found.push('ホスト名');
	}
	if (new RegExp(SessionUrlPattern.source).test(line)) { found.push('セッションの URL'); }
	if (KeyPatterns.some((p) => new RegExp(p.source).test(line))) { found.push('認証情報'); }
	if (new RegExp(InternalHostPattern.source, 'i').test(line)) { found.push('ホスト名'); }
	for (const m of line.matchAll(PrivateIpPattern)) {
		if (isIpv4(m[1])) { found.push('IP アドレス'); break; }
	}
	return found;
}
