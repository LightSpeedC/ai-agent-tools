/**
 * HTML のコントラスト比を実測する（check-contrast.ps1 から呼ばれる）
 *
 * ブラウザで実際にレンダリングし、テキストを持つ全要素について
 * 前景色と「実効背景色」を getComputedStyle から取得して比を計算する。
 *
 * 目的は「白背景に白文字」「黒背景に黒文字」のように【読めない】箇所の検出。
 * WCAG AA（4.5:1）で判定すると、文字が1文字も乗っていないグラデーションの端まで
 * 拾って誤検出だらけになり、本当の問題が埋もれる。
 *
 * 使い方（ps1 が呼ぶ）:
 *   node check-contrast.cjs <入力JSONのパス>
 *
 * 入力JSON: { "files": ["...html", ...], "min": 1.5, "playwrightRoot": "<Playwright共有環境のパス>" }
 * 出力    : 結果の JSON を標準出力へ
 */
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

/** ブラウザ側で走る計測処理。ここは DOM の文脈で実行される */
function measure(threshold) {
	/** "rgb(1, 2, 3)" / "rgba(1, 2, 3, 0.5)" を解析する */
	function parseColor(s) {
		if (!s) return null;
		const m = /rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:[,\s/]+([\d.%]+))?\s*\)/.exec(s);
		if (!m) return null;
		let a = 1;
		if (m[4] !== undefined) {
			a = m[4].endsWith('%') ? parseFloat(m[4]) / 100 : parseFloat(m[4]);
		}
		return { r: +m[1], g: +m[2], b: +m[3], a: a };
	}

	/** 相対輝度（WCAG） */
	function lum(c) {
		function f(v) {
			const x = v / 255;
			return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4);
		}
		return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b);
	}

	/** コントラスト比 */
	function ratio(a, b) {
		const l1 = lum(a);
		const l2 = lum(b);
		return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
	}

	/** 半透明の fg を bg の上に合成する */
	function over(fg, bg) {
		return {
			r: fg.r * fg.a + bg.r * (1 - fg.a),
			g: fg.g * fg.a + bg.g * (1 - fg.a),
			b: fg.b * fg.a + bg.b * (1 - fg.a),
			a: 1,
		};
	}

	/** 複数色の平均（グラデーションを1色に均す） */
	function average(cols) {
		let r = 0, g = 0, b = 0;
		for (const c of cols) { r += c.r; g += c.g; b += c.b; }
		return { r: r / cols.length, g: g / cols.length, b: b / cols.length, a: 1 };
	}

	const WHITE = { r: 255, g: 255, b: 255, a: 1 };

	/**
	 * 実効背景色。自身から親へ遡り、最初の不透明な背景を下地にする。
	 * グラデーションは平均色にする（最も明るい端で判定すると誤検出だらけになるため）。
	 */
	function backgroundOf(el) {
		const translucent = [];
		let node = el;

		while (node && node.nodeType === 1) {
			const cs = getComputedStyle(node);
			const img = cs.backgroundImage;

			if (img && img !== 'none') {
				const raw = img.match(/rgba?\([^)]*\)/g) || [];
				const cols = [];
				for (const s of raw) {
					const c = parseColor(s);
					if (c && c.a >= 1) cols.push(c);
				}
				if (cols.length > 0) {
					let cur = average(cols);
					for (let i = translucent.length - 1; i >= 0; i--) cur = over(translucent[i], cur);
					return cur;
				}
			}

			const bc = parseColor(cs.backgroundColor);
			if (bc && bc.a > 0) {
				if (bc.a >= 1) {
					let cur = bc;
					for (let i = translucent.length - 1; i >= 0; i--) cur = over(translucent[i], cur);
					return cur;
				}
				translucent.push(bc);
			}
			node = node.parentElement;
		}

		let cur = WHITE;
		for (let i = translucent.length - 1; i >= 0; i--) cur = over(translucent[i], cur);
		return cur;
	}

	const results = [];

	for (const el of Array.from(document.querySelectorAll('*'))) {
		// SVG の文字は fill で色が決まるため対象外
		if (el.namespaceURI !== 'http://www.w3.org/1999/xhtml') continue;

		// 直接の子テキストノードだけを見る（子孫のテキストは子孫側で判定される）
		let text = '';
		for (const n of Array.from(el.childNodes)) {
			if (n.nodeType === 3) text += ' ' + (n.textContent || '').trim();
		}
		text = text.trim();
		if (!text) continue;

		const cs = getComputedStyle(el);
		if (cs.display === 'none' || cs.visibility === 'hidden') continue;
		if (parseFloat(cs.opacity) === 0) continue;

		const rect = el.getBoundingClientRect();
		if (rect.width === 0 || rect.height === 0) continue;

		const fg0 = parseColor(cs.color);
		if (!fg0) continue;

		const bg = backgroundOf(el);
		const fg = fg0.a < 1 ? over(fg0, bg) : fg0;
		const r = ratio(fg, bg);

		if (r < threshold) {
			results.push({
				tag: el.tagName.toLowerCase(),
				cls: typeof el.className === 'string' ? el.className : '',
				text: text.slice(0, 50),
				color: cs.color,
				background:
					'rgb(' + Math.round(bg.r) + ', ' + Math.round(bg.g) + ', ' + Math.round(bg.b) + ')',
				ratio: Math.round(r * 100) / 100,
			});
		}
	}

	return results;
}

async function main() {
	const inputPath = process.argv[2];
	if (!inputPath) {
		process.stderr.write('入力JSONのパスが指定されていません\n');
		process.exit(2);
	}

	const input = JSON.parse(fs.readFileSync(inputPath, 'utf8'));
	const pwRoot = input.playwrightRoot;
	const threshold = input.min;

	let chromium;
	try {
		({ chromium } = require(path.join(pwRoot, 'node_modules', 'playwright')));
	} catch (e) {
		process.stderr.write('playwright を読み込めません: ' + pwRoot + '\n' + e.message + '\n');
		process.exit(2);
	}

	const browser = await chromium.launch();
	const page = await browser.newPage({ viewport: { width: 1700, height: 1000 } });
	const out = [];

	for (const file of input.files) {
		try {
			await page.goto(pathToFileURL(file).href, { waitUntil: 'load' });
			const issues = await page.evaluate(measure, threshold);
			out.push({ file: file, issues: issues });
		} catch (e) {
			out.push({ file: file, error: e.message });
		}
	}

	await browser.close();
	process.stdout.write(JSON.stringify(out));
}

main().catch((e) => {
	process.stderr.write(String(e && e.stack ? e.stack : e) + '\n');
	process.exit(2);
});
