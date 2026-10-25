// @ts-check
/*
	history2html のビューア（計画 p261014-01 の第 4 章）。書き出すときに index.html の中へ入れる。
	JavaScript で書き、型は JSDoc で付けて tsc --checkJs で見る（決めたこと 19-A）。

	  上    固定のヘッダー。「応答なし」（既定）と「すべて展開」を切り替える
	  左    目盛り。月 ・ 日 ・ 人の発言の線を、右の会話の高さに比例して引く。つまみで動かす
	  右    会話。日ごとのデータを、画面に近づいた日だけ読んで描く。開いたときは最新（いちばん下）

	データは <script> を足して読む（決めたこと 13-A）。file:// のまま開いても動く。
	読んだデータは history2html.index ・ day ・ res に渡ってくる。
*/
(function () {
	'use strict';

	/** @typedef {{ d: string, w: string, n: number, c: number, rn?: number, rc?: number, p: [string, string, number][] }} DayInfo */
	/** @typedef {{ k: 'p' | 'n' | 'c', t: string, s: number, x?: string, r?: number }} Entry */
	/** @typedef {{ k: 'a' | 'u' | 'm', t: string, x: string, n?: string, e?: number }} ResItem */
	/**
	 * @typedef {{
	 *   info: DayInfo, el: HTMLElement, body: HTMLElement,
	 *   entries: Entry[] | null, res: ResItem[][] | null,
	 *   rendered: boolean, loading: Promise<void> | null, resLoading: Promise<void> | null,
	 *   reqLoading: Promise<boolean> | null,
	 *   turnEls: (HTMLElement | null)[]
	 * }} Day
	 */
	/** @typedef {{ type: 'm' | 'd' | 'p', y: number, day: Day, p?: [string, string, number] }} Line */

	const W = /** @type {any} */ (window);

	/** 読んだデータの置き場 */
	const store = { index: /** @type {any} */ (null), day: /** @type {Record<string, Entry[]>} */ ({}), res: /** @type {Record<string, ResItem[][]>} */ ({}) };
	W.history2html = {
		index: (/** @type {any} */ o) => { store.index = o; },
		day: (/** @type {string} */ d, /** @type {Entry[]} */ list) => { store.day[d] = list; },
		res: (/** @type {string} */ d, /** @type {ResItem[][]} */ list) => { store.res[d] = list; },
	};

	const $ = (/** @type {string} */ sel) => /** @type {HTMLElement} */ (document.querySelector(sel));
	const main = $('.main');
	const list = $('.list');
	// 目盛りは、左の余白（クリックしても何も起きない）の右側
	const rail = $('.rail .track');
	const canvas = /** @type {HTMLCanvasElement} */ (document.querySelector('.rail canvas'));
	const thumb = $('.thumb');
	const tip = $('.tip');

	/** 'none' = 応答なし（既定） / 'all' = すべて展開。選んだ状態は覚えない */
	let mode = 'none';
	/** @type {Day[]} */
	let days = [];
	/** @type {{ n: string }[]} */
	let sessions = [];
	/** @type {Line[]} */
	let lines = [];
	/** 開いたときは最新を出す。利用者が動かすまで、いちばん下に付いていく */
	let stickBottom = true;
	/** つまみをドラッグしている最中 */
	let dragging = false;

	// ---- 小さな道具 ----

	/** @param {string} tag @param {string} [cls] @param {string} [text] */
	function el(tag, cls, text) {
		const e = document.createElement(tag);
		if (cls) { e.className = cls; }
		if (text != null) { e.textContent = text; }
		return e;
	}

	/**
	 * データを読む。読んだ <script> は残す（何を読んだかを、ページから確かめられるように）
	 * @param {string} src
	 */
	function loadScript(src) {
		return new Promise((resolve, reject) => {
			const s = document.createElement('script');
			s.src = src;
			s.onload = () => { resolve(undefined); };
			s.onerror = () => { s.remove(); reject(new Error(src)); };
			document.head.appendChild(s);
		});
	}

	/** @param {string} d @param {boolean} res */
	function dataPath(d, res) {
		// 人の発言は -req.js、応答は -res.js（依頼と応答の対）
		return 'data/' + d.slice(0, 7) + '/' + d + (res ? '-res' : '-req') + '.js';
	}

	/** セッションの色。吹き出しの端の帯に使う */
	const Hues = [210, 140, 30, 280, 0, 180, 90, 320];
	/** @param {number} s */
	function sessionColor(s) {
		return 'hsl(' + Hues[s % Hues.length] + ', 55%, 50%)';
	}

	/** @param {DayInfo} info */
	function dayLabel(info) {
		return info.d.replace(/-/g, '/') + '(' + info.w + ')';
	}

	// ---- Markdown ----

	let mdReady = false;
	/** @param {string} s */
	function escapeHtml(s) {
		return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
	}

	/**
	 * AI の本文を描く。marked と DOMPurify の両方が読めたときだけ Markdown にする。
	 * **本文中の生の HTML はタグとして効かせず、文字のまま出す**（会話には HTML の話が多い）。
	 * 描いた結果は DOMPurify にも通す
	 * @param {string} text
	 * @returns {HTMLElement}
	 */
	function renderMarkdown(text) {
		const M = W.marked;
		const P = W.DOMPurify;
		if (M == null || P == null || typeof M.parse !== 'function' || typeof P.sanitize !== 'function') {
			return el('div', 'plain', text);
		}
		if (!mdReady) {
			M.use({
				gfm: true,
				breaks: false,
				renderer: {
					// 版によって受け取る形が違う（文字列 ・ { text } のどちらでも受ける）
					html: (/** @type {any} */ t) => escapeHtml(typeof t === 'string' ? t : String(t?.text ?? '')),
				},
			});
			mdReady = true;
		}
		const box = el('div', 'md');
		try {
			box.innerHTML = P.sanitize(M.parse(text, { async: false }));
		} catch {
			return el('div', 'plain', text);
		}
		// 幅の広い表は横に流す
		for (const t of Array.from(box.querySelectorAll('table'))) {
			const w = el('div', 'tw');
			t.replaceWith(w);
			w.appendChild(t);
		}
		return box;
	}

	// ---- 見ている位置を保つ ----

	/*
		描き足し ・ 展開で上の高さが変わっても、見ている位置がずれないようにする。
		画面の上の方にある要素を 1 つ覚え、変更の後でその要素が同じ高さに来るように戻す。
		日の見出しは上に貼り付くので、目印にしない（位置が動かないため）
	*/
	function captureAnchor() {
		const r = main.getBoundingClientRect();
		/** @type {Element | null} */
		let e = document.elementFromPoint(r.left + r.width / 2, r.top + 60);
		while (e != null && e !== main) {
			if (e.classList.contains('dh')) { e = e.nextElementSibling; break; }
			if (e.classList.contains('turn') || e.classList.contains('turns') || e.classList.contains('compact') || e.classList.contains('sess')) { break; }
			e = e.parentElement;
		}
		if (e == null || e === main) { return null; }
		return { e, top: e.getBoundingClientRect().top };
	}

	/** @param {{ e: Element, top: number } | null} a */
	function restoreAnchor(a) {
		if (stickBottom) { main.scrollTop = main.scrollHeight; return; }
		// ドラッグ中は、位置をつまみが決める。ここで直すとドラッグと逆向きに動く
		if (dragging) { return; }
		if (a == null || !a.e.isConnected) { return; }
		main.scrollTop += a.e.getBoundingClientRect().top - a.top;
	}

	// ---- 日を描く ----

	/** 描く前の高さの見積もり。目次の量（依頼の数 ・ 人の発言の文字数）から */
	/** @param {DayInfo} info */
	function estimate(info) {
		const base = 40 + info.n * 58 + Math.ceil(info.c / 45) * 22;
		if (mode !== 'all') { return base; }
		// 「すべて展開」のときは応答の分も足す。足さないと、描いたときに高さが何倍にも伸びる
		return base + (info.rn ?? 0) * 34 + Math.ceil((info.rc ?? 0) / 60) * 22;
	}

	/** まだ描いていない日の高さを、いまの切り替えに合わせて見積もり直す */
	function reestimate() {
		for (const d of days) {
			if (!d.rendered) { d.body.style.height = estimate(d.info) + 'px'; }
		}
	}

	/** @param {Day} day */
	function ensureRes(day) {
		if (day.res != null) { return Promise.resolve(); }
		if (day.resLoading == null) {
			day.resLoading = loadScript(dataPath(day.info.d, true))
				.then(() => { day.res = store.res[day.info.d] ?? []; })
				.catch(() => { day.res = []; });
		}
		return day.resLoading;
	}

	/** @param {Day} day */
	function hasRes(day) {
		return (day.entries ?? []).some((e) => (e.r ?? 0) > 0);
	}

	/**
	 * その日の人の発言を読む（描かない）。検索が全部の日を先に読むため、描くのと分けてある
	 * @param {Day} day
	 * @returns {Promise<boolean>} 読めたか
	 */
	function loadReq(day) {
		if (day.entries != null) { return Promise.resolve(true); }
		if (day.reqLoading == null) {
			day.reqLoading = loadScript(dataPath(day.info.d, false))
				.then(() => { day.entries = store.day[day.info.d] ?? []; return true; })
				.catch(() => false);
		}
		return day.reqLoading;
	}

	/** @param {Day} day */
	function renderDay(day) {
		if (day.rendered) { return Promise.resolve(); }
		if (day.loading != null) { return day.loading; }
		day.loading = (async () => {
			if (!(await loadReq(day))) {
				day.body.textContent = 'この日のデータを読めませんでした (' + dataPath(day.info.d, false) + ')';
				return;
			}
			if (mode === 'all' && hasRes(day)) { await ensureRes(day); }
			const a = captureAnchor();
			fillDay(day);
			day.rendered = true;
			restoreAnchor(a);
			scheduleRail();
		})();
		return day.loading;
	}

	/** @param {Day} day */
	function fillDay(day) {
		const body = day.body;
		body.textContent = '';
		body.style.height = '';
		body.classList.remove('ph');
		const entries = day.entries ?? [];
		day.turnEls = [];
		let prev = -1;
		entries.forEach((e, i) => {
			if (e.s !== prev && e.k !== 'c') {
				const s = el('div', 'sess');
				const dot = el('span', 'dot');
				dot.style.background = sessionColor(e.s);
				s.appendChild(dot);
				s.appendChild(document.createTextNode(sessions[e.s]?.n ?? ''));
				body.appendChild(s);
				prev = e.s;
			}
			const t = makeTurn(day, e, i);
			day.turnEls.push(t);
			body.appendChild(t);
			if (mode === 'all' && (e.r ?? 0) > 0 && day.res != null) { expand(day, i, t); }
		});
	}

	/** @param {Day} day @param {Entry} e @param {number} i */
	function makeTurn(day, e, i) {
		if (e.k === 'c') {
			const c = el('div', 'compact turn');
			c.appendChild(el('span', 'pill', '要約 (compact)'));
			c.appendChild(document.createTextNode(' '));
			c.appendChild(el('span', 'tm', e.t));
			return c;
		}
		const t = el('div', 'turn');
		t.dataset.i = String(i);
		t.style.setProperty('--sc', sessionColor(e.s));
		if (e.k === 'p') {
			const row = el('div', 'row me');
			row.appendChild(el('span', 'tm', e.t));
			row.appendChild(el('div', 'bubble me', e.x ?? ''));
			t.appendChild(row);
		}
		else {
			// 人の発言なしで始まった応答（通知 ・ 定期実行 ・ 続き）。中身は載せず、印だけ
			const row = el('div', 'row sys');
			row.appendChild(el('span', 'pill', e.x ?? ''));
			row.appendChild(el('span', 'tm', e.t));
			t.appendChild(row);
		}
		if ((e.r ?? 0) > 0) {
			t.appendChild(marker(false));
			const res = el('div', 'res');
			res.hidden = true;
			t.appendChild(res);
		}
		void day;
		return t;
	}

	/** @param {boolean} bottom */
	function marker(bottom) {
		const w = el('div', 'expw' + (bottom ? ' bottom' : ''));
		const b = /** @type {HTMLButtonElement} */ (el('button', 'exp'));
		// 閉じているときは「展開する」（上下の外側へ）、開いているときは「畳む」（上下の内側へ）。CSS が aria-expanded で切り替える
		b.innerHTML = '<svg class="i-open" width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><path d="M6 1.5v9M3.5 4 6 1.5 8.5 4M3.5 8 6 10.5 8.5 8"/></svg>'
			+ '<svg class="i-close" width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><path d="M6 .5v4M6 11.5v-4M3.5 2.5 6 5 8.5 2.5M3.5 9.5 6 7 8.5 9.5"/></svg>';
		b.type = 'button';
		b.title = '応答を展開 ・ 畳む';
		b.setAttribute('aria-expanded', 'false');
		w.appendChild(b);
		return w;
	}

	/** @param {Day} day @param {number} i @param {HTMLElement} t */
	function expand(day, i, t) {
		const res = /** @type {HTMLElement | null} */ (t.querySelector(':scope > .res'));
		if (res == null) { return; }
		if (res.childElementCount === 0) {
			for (const it of (day.res ?? [])[i] ?? []) { res.appendChild(makeItem(it)); }
		}
		res.hidden = false;
		let bottom = /** @type {HTMLElement | null} */ (t.querySelector(':scope > .expw.bottom'));
		if (bottom == null) {
			bottom = marker(true);
			t.appendChild(bottom);
		}
		bottom.hidden = false;
		t.classList.add('open');
		for (const b of Array.from(t.querySelectorAll(':scope > .expw .exp'))) { b.setAttribute('aria-expanded', 'true'); }
	}

	/** @param {HTMLElement} t */
	function collapse(t) {
		const res = /** @type {HTMLElement | null} */ (t.querySelector(':scope > .res'));
		if (res != null) { res.hidden = true; }
		const bottom = /** @type {HTMLElement | null} */ (t.querySelector(':scope > .expw.bottom'));
		if (bottom != null) { bottom.hidden = true; }
		t.classList.remove('open');
		for (const b of Array.from(t.querySelectorAll(':scope > .expw .exp'))) { b.setAttribute('aria-expanded', 'false'); }
	}

	/** @param {ResItem} it */
	function makeItem(it) {
		if (it.k === 'a') {
			const row = el('div', 'row ai');
			const b = el('div', 'bubble ai');
			b.appendChild(renderMarkdown(it.x));
			row.appendChild(b);
			row.appendChild(el('span', 'tm', it.t));
			return row;
		}
		if (it.k === 'u') {
			const row = el('div', 'row tool');
			const line = el('div', 'toolline');
			line.appendChild(el('span', 'tn', it.n ?? ''));
			if (it.x) { line.appendChild(document.createTextNode('  ' + it.x)); }
			if (it.e === 1) {
				const ng = el('span', 'ng', '❌');
				ng.title = '失敗した呼び出し';
				line.appendChild(ng);
			}
			row.appendChild(line);
			row.appendChild(el('span', 'tm', it.t));
			return row;
		}
		const row = el('div', 'row sys');
		row.appendChild(el('span', 'pill', it.x));
		row.appendChild(el('span', 'tm', it.t));
		return row;
	}

	/** 記号のクリック。クリックした記号が、画面の同じ高さに残るようにする */
	/** @param {HTMLElement} button */
	async function toggle(button) {
		const t = /** @type {HTMLElement | null} */ (button.closest('.turn'));
		const section = /** @type {HTMLElement | null} */ (button.closest('.day'));
		if (t == null || section == null) { return; }
		const day = days[Number(section.dataset.n)];
		const i = Number(t.dataset.i);
		stickBottom = false;
		const y0 = button.getBoundingClientRect().top;
		if (t.classList.contains('open')) { collapse(t); }
		else {
			await ensureRes(day);
			expand(day, i, t);
		}
		const top = /** @type {HTMLElement | null} */ (t.querySelector(':scope > .expw .exp'));
		if (top != null) { main.scrollTop += top.getBoundingClientRect().top - y0; }
		scheduleRail();
	}

	/*
		ヘッダーの切り替えだけを sessionStorage に覚える（決めたこと 33-A）。タブを閉じれば消える。
		キーは計画書の「ブラウザに残すもの」に書いてある。使えない環境（プライベートの窓等）では覚えないだけ
	*/
	const ModeKey = 'history2html.mode';
	function loadMode() {
		try { return sessionStorage.getItem(ModeKey) === 'all' ? 'all' : 'none'; } catch { return 'none'; }
	}
	/** @param {string} m */
	function saveMode(m) {
		try { sessionStorage.setItem(ModeKey, m); } catch { /* 覚えないだけ */ }
	}
	/** @param {string} m */
	function showMode(m) {
		for (const b of Array.from(document.querySelectorAll('.mode button'))) {
			b.setAttribute('aria-pressed', String(/** @type {HTMLElement} */ (b).dataset.mode === m));
		}
	}

	/** @param {string} m */
	async function setMode(m) {
		if (m === mode) { return; }
		mode = m;
		saveMode(m);
		showMode(m);
		const rendered = days.filter((d) => d.rendered);
		if (m === 'all') { await Promise.all(rendered.filter(hasRes).map(ensureRes)); }
		const a = captureAnchor();
		reestimate();
		for (const day of rendered) {
			(day.entries ?? []).forEach((e, i) => {
				const t = day.turnEls[i];
				if (t == null || (e.r ?? 0) === 0) { return; }
				if (m === 'all') { expand(day, i, t); } else { collapse(t); }
			});
		}
		restoreAnchor(a);
		scheduleRail();
	}

	// ---- 左: 目盛り ----

	let railQueued = false;
	function scheduleRail() {
		if (railQueued) { return; }
		railQueued = true;
		requestAnimationFrame(() => {
			railQueued = false;
			computeLines();
			drawRail();
			updateThumb();
		});
	}

	/** 線の位置。右の会話の高さに比例させる（つまみを動かした量と、右が動く量が一致する） */
	function computeLines() {
		const total = Math.max(1, main.scrollHeight);
		const H = rail.clientHeight;
		const k = H / total;
		lines = [];
		let month = '';
		for (const day of days) {
			const top = day.el.offsetTop;
			const h = day.el.offsetHeight;
			const ym = day.info.d.slice(0, 7);
			if (ym !== month) {
				lines.push({ type: 'm', y: top * k, day });
				month = ym;
			}
			lines.push({ type: 'd', y: top * k, day });
			const ps = day.info.p;
			ps.forEach((p, j) => {
				let y;
				const t = day.rendered ? day.turnEls[p[2]] : null;
				if (t != null) { y = t.offsetTop; }
				// まだ描いていない日は、日の中に等しく並べて見積もる
				else { y = top + h * (j + 1) / (ps.length + 1); }
				lines.push({ type: 'p', y: y * k, day, p });
			});
		}
	}

	function drawRail() {
		const dpr = window.devicePixelRatio || 1;
		const w = rail.clientWidth;
		const h = rail.clientHeight;
		canvas.width = Math.round(w * dpr);
		canvas.height = Math.round(h * dpr);
		canvas.style.width = w + 'px';
		canvas.style.height = h + 'px';
		const g = canvas.getContext('2d');
		if (g == null) { return; }
		g.setTransform(dpr, 0, 0, dpr, 0, 0);
		g.clearRect(0, 0, w, h);
		const y = (/** @type {number} */ v) => Math.min(h - 1, Math.max(1, Math.round(v))) + 0.5;
		const stroke = (/** @type {'m' | 'd' | 'p'} */ type, /** @type {number} */ x0, /** @type {string} */ color, /** @type {number} */ width) => {
			g.strokeStyle = color;
			g.lineWidth = width;
			g.beginPath();
			for (const l of lines) {
				if (l.type !== type) { continue; }
				g.moveTo(x0, y(l.y));
				g.lineTo(w - 6, y(l.y));
			}
			g.stroke();
		};
		// 細かい順に引き、太いものを上に重ねる。日 ・ 発言の線は右寄せ
		stroke('p', Math.round(w * 0.74), '#97a1ae', 1);
		stroke('d', Math.round(w * 0.46), '#2f5fbf', 1.5);
		stroke('m', 6, '#12224d', 2);

		// ラベル。詰まったところでは間引く（線は残す）
		if (w < 100) { return; }
		g.font = '11px "Segoe UI", "Yu Gothic UI", Meiryo, sans-serif';
		g.fillStyle = '#1c2330';
		let lastMonth = -100;
		let lastDay = -100;
		for (const l of lines) {
			const ly = y(l.y);
			if (l.type === 'm' && ly - lastMonth >= 16) {
				g.textAlign = 'left';
				// その月の初日まで書く（2026/10/4。37-B）。初日の日の数字は、月の線と重なるので別には書かない
				const d = l.day.info.d;
				g.fillText(d.slice(0, 7).replace('-', '/') + '/' + Number(d.slice(8, 10)), 7, Math.max(11, ly - 3));
				lastMonth = ly;
			}
			else if (l.type === 'd' && ly - lastDay >= 14 && Math.abs(ly - lastMonth) >= 12) {
				g.textAlign = 'right';
				g.fillText(String(Number(l.day.info.d.slice(8, 10))), Math.round(w * 0.46) - 4, ly + 4);
				lastDay = ly;
			}
		}
	}

	function updateThumb() {
		const total = Math.max(1, main.scrollHeight);
		const H = rail.clientHeight;
		const top = main.scrollTop / total * H;
		const hh = Math.max(12, main.clientHeight / total * H);
		thumb.style.top = Math.min(H - hh, top) + 'px';
		thumb.style.height = hh + 'px';
	}

	/** ポインタにいちばん近い線。重なったら細かいもの（発言 → 日 → 月）を選ぶ */
	/** @param {number} ry */
	function nearest(ry) {
		/** @type {Line | null} */
		let best = null;
		let bd = Infinity;
		const rank = { p: 0, d: 1, m: 2 };
		for (const l of lines) {
			const d = Math.abs(l.y - ry);
			if (d < bd - 0.5 || (Math.abs(d - bd) <= 0.5 && best != null && rank[l.type] < rank[best.type])) { best = l; bd = d; }
		}
		return { line: best, dist: bd };
	}

	/** @param {Line} l */
	function tipText(l) {
		if (l.type === 'm') { return l.day.info.d.slice(0, 7).replace('-', '/'); }
		if (l.type === 'd') { return dayLabel(l.day.info); }
		const p = /** @type {[string, string, number]} */ (l.p);
		return dayLabel(l.day.info) + ' ' + p[0] + '\n' + p[1];
	}

	/** @param {Line} l */
	async function jumpTo(l) {
		stickBottom = false;
		const day = l.day;
		if (l.type === 'p') {
			await renderDay(day);
			const t = day.turnEls[/** @type {[string, string, number]} */ (l.p)[2]];
			if (t != null) { main.scrollTop = t.offsetTop - 60; }
		}
		else {
			main.scrollTop = day.el.offsetTop;
		}
		scheduleRail();
	}

	// つまみのドラッグ ・ 帯のクリック
	/** @type {{ y: number, grab: number, thumb: boolean, moved: boolean } | null} */
	let press = null;
	rail.addEventListener('pointerdown', (ev) => {
		stickBottom = false;
		hideTip();
		// grab はつまみのどこを掴んだか。ドラッグ中、その点がポインタに付いていく
		press = { y: ev.clientY, grab: ev.clientY - thumb.getBoundingClientRect().top, thumb: ev.target === thumb, moved: false };
		rail.setPointerCapture(ev.pointerId);
		if (press.thumb) { thumb.classList.add('drag'); }
		ev.preventDefault();
	});
	rail.addEventListener('pointermove', (ev) => {
		if (press == null) { onHover(ev); return; }
		const dy = ev.clientY - press.y;
		if (Math.abs(dy) >= 3) { press.moved = true; }
		if (press.thumb && press.moved) {
			/*
				つまみの位置の割合で、右の位置の割合を決める。移動量 × 全体の高さで決めると、
				ドラッグ中に日が描かれて全体の高さが伸びたとき、右の位置が大きく狂う
				（「すべて展開」のあと、つまみがポインタから離れて上端へ飛んだ）
			*/
			dragging = true;
			const r = rail.getBoundingClientRect();
			const room = Math.max(1, r.height - thumb.offsetHeight);
			const frac = Math.min(1, Math.max(0, (ev.clientY - r.top - press.grab) / room));
			main.scrollTop = frac * (main.scrollHeight - main.clientHeight);
		}
	});
	rail.addEventListener('pointerup', (ev) => {
		const p = press;
		press = null;
		dragging = false;
		thumb.classList.remove('drag');
		if (p == null || p.thumb || p.moved) { return; }
		const ry = ev.clientY - rail.getBoundingClientRect().top;
		const n = nearest(ry);
		if (n.line != null && n.dist <= 6) { jumpTo(n.line); return; }
		main.scrollTop = ry / rail.clientHeight * main.scrollHeight - main.clientHeight / 2;
	});
	rail.addEventListener('pointercancel', () => { press = null; dragging = false; thumb.classList.remove('drag'); });
	rail.addEventListener('wheel', (ev) => {
		stickBottom = false;
		main.scrollTop += ev.deltaY;
		ev.preventDefault();
	}, { passive: false });

	/*
		線にマウスを乗せて 0.5 秒置くと、日時を出す。すぐには出さない（なぞっただけで次々に出ないように）。
		一度出たあとは、上下に動かすだけで待たずに追従する。左ペインの外に出たら最初から
	*/
	const TipDelay = 500;
	let tipActive = false;
	/** @type {number | undefined} */
	let tipTimer;
	let lastY = 0;
	/** @param {PointerEvent} ev */
	function onHover(ev) {
		lastY = ev.clientY;
		if (tipActive) { showTip(); return; }
		clearTimeout(tipTimer);
		tipTimer = window.setTimeout(() => { tipActive = true; showTip(); }, TipDelay);
	}
	function showTip() {
		const r = rail.getBoundingClientRect();
		const n = nearest(lastY - r.top);
		if (n.line == null) { return; }
		tip.textContent = tipText(n.line);
		tip.hidden = false;
		const top = Math.min(window.innerHeight - tip.offsetHeight - 4, Math.max(r.top, lastY - 12));
		tip.style.left = (r.right + 8) + 'px';
		tip.style.top = top + 'px';
	}
	function hideTip() {
		clearTimeout(tipTimer);
		tip.hidden = true;
	}
	rail.addEventListener('pointerleave', () => {
		hideTip();
		tipActive = false;
	});

	// ---- 右: 会話 ----

	main.addEventListener('scroll', () => { updateThumb(); });
	for (const type of ['wheel', 'keydown', 'touchstart', 'pointerdown']) {
		main.addEventListener(type, () => { stickBottom = false; }, { passive: true });
	}
	list.addEventListener('click', (ev) => {
		const b = /** @type {HTMLElement | null} */ (/** @type {HTMLElement} */ (ev.target).closest('.exp'));
		if (b != null) { toggle(b); }
	});
	for (const b of Array.from(document.querySelectorAll('.mode button'))) {
		b.addEventListener('click', () => { setMode(/** @type {HTMLElement} */ (b).dataset.mode ?? 'none'); });
	}
	window.addEventListener('resize', scheduleRail);
	if (typeof ResizeObserver === 'function') { new ResizeObserver(scheduleRail).observe(list); }

	// ---- 先頭へ ・ 最新へ ----

	for (const b of Array.from(document.querySelectorAll('.jump button'))) {
		b.addEventListener('click', () => {
			if (/** @type {HTMLElement} */ (b).dataset.go === 'top') {
				stickBottom = false;
				main.scrollTop = 0;
			}
			else {
				// 描き足しで高さが変わっても、いちばん下に付いていく（利用者が動かすまで）
				stickBottom = true;
				main.scrollTop = main.scrollHeight;
			}
			scheduleRail();
		});
	}

	// ---- 検索（決めたこと 32-A） ----

	/*
		人の発言と応答（AI の本文 ・ ツールの要約）の両方を探す。3 文字以上で、入力のたびに探す。大小を問わない。
		検索欄にカーソルが来たら、裏で全部の日を読み始める（読むだけで、描くのは見に行くとき）。
		当たりは 1 件の発言 ・ 1 件の応答ごとに数える
	*/
	const findInput = /** @type {HTMLInputElement} */ (document.querySelector('.find input'));
	const findCount = $('.find .cnt');
	/** @typedef {{ day: Day, i: number, j: number }} Hit  j は応答の何件目か（人の発言なら -1） */
	/** @type {Hit[]} */
	let hits = [];
	let cur = -1;
	let query = '';
	/** @type {Promise<void> | null} */
	let allLoading = null;

	function loadAll() {
		if (allLoading == null) {
			allLoading = Promise.all(days.map(async (d) => {
				await loadReq(d);
				if (hasRes(d)) { await ensureRes(d); }
			})).then(() => undefined);
		}
		return allLoading;
	}

	/** 当たった語に印を付ける。文字の節を分けて mark で包む（HTML を組み立てない） */
	/** @param {HTMLElement} el @param {string} q */
	function markIn(el, q) {
		const lq = q.toLowerCase();
		const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
		/** @type {Text[]} */
		const nodes = [];
		for (let n = walker.nextNode(); n != null; n = walker.nextNode()) { nodes.push(/** @type {Text} */ (n)); }
		for (const node of nodes) {
			const text = node.nodeValue ?? '';
			const lower = text.toLowerCase();
			let k = lower.indexOf(lq);
			if (k < 0) { continue; }
			const frag = document.createDocumentFragment();
			let last = 0;
			while (k >= 0) {
				frag.append(text.slice(last, k));
				frag.append(el.ownerDocument.createElement('mark'));
				/** @type {HTMLElement} */ (frag.lastChild).textContent = text.slice(k, k + q.length);
				last = k + q.length;
				k = lower.indexOf(lq, last);
			}
			frag.append(text.slice(last));
			node.replaceWith(frag);
		}
	}

	function clearMarks() {
		for (const m of Array.from(list.querySelectorAll('mark'))) {
			const parent = m.parentNode;
			m.replaceWith(document.createTextNode(m.textContent ?? ''));
			parent?.normalize();
		}
	}

	/** @param {number} n */
	async function showHit(n) {
		cur = n;
		const h = hits[n];
		findCount.textContent = (n + 1) + '/' + hits.length;
		stickBottom = false;
		await renderDay(h.day);
		const t = h.day.turnEls[h.i];
		if (t == null) { return; }
		/** @type {HTMLElement} */
		let target = /** @type {HTMLElement} */ (t.querySelector('.bubble.me') ?? t);
		if (h.j >= 0) {
			// 応答の中で当たったら、その応答を展開して見せる
			await ensureRes(h.day);
			expand(h.day, h.i, t);
			const res = t.querySelector(':scope > .res');
			target = /** @type {HTMLElement} */ (res?.children[h.j] ?? t);
		}
		if (n !== cur) { return; }
		clearMarks();
		markIn(target, query);
		const m = target.querySelector('mark');
		if (m != null) { m.classList.add('cur'); }
		const r = main.getBoundingClientRect();
		main.scrollTop += (m ?? target).getBoundingClientRect().top - r.top - main.clientHeight / 3;
		scheduleRail();
	}

	/** 最後に探した語。Enter で同じ語なら次へ、違えば探し直す */
	let searched = '';

	/**
	 * 3 文字以上は入力のたびに探す。1〜2 文字は Enter を押したときだけ探す（決めたこと 36-A）
	 * @param {boolean} [byEnter]
	 */
	async function runSearch(byEnter = false) {
		const q = findInput.value.trim();
		query = q;
		clearMarks();
		hits = [];
		cur = -1;
		searched = '';
		if (q.length === 0 || (q.length < 3 && !byEnter)) { findCount.textContent = ''; return; }
		searched = q;
		findCount.textContent = '読み込み中';
		await loadAll();
		// 読んでいる間に打ち直されていたら、古い方は捨てる
		if (q !== query) { return; }
		const lq = q.toLowerCase();
		for (const day of days) {
			(day.entries ?? []).forEach((e, i) => {
				if (e.k === 'p' && (e.x ?? '').toLowerCase().includes(lq)) { hits.push({ day, i, j: -1 }); }
				((day.res ?? [])[i] ?? []).forEach((it, j) => {
					const text = it.k === 'u' ? (it.n ?? '') + '  ' + it.x : it.x;
					if (text.toLowerCase().includes(lq)) { hits.push({ day, i, j }); }
				});
			});
		}
		if (hits.length === 0) { findCount.textContent = '0/0'; return; }
		await showHit(0);
	}

	/** @param {string} dir first ・ prev ・ next ・ last。前後は端で反対の端へ回る */
	function go(dir) {
		const n = hits.length;
		if (n === 0) { return; }
		if (dir === 'first') { showHit(0); }
		else if (dir === 'last') { showHit(n - 1); }
		else if (dir === 'next') { showHit((cur + 1) % n); }
		else { showHit((cur - 1 + n) % n); }
	}

	findInput.addEventListener('focus', () => { loadAll(); });
	/** @type {number | undefined} */
	let findTimer;
	findInput.addEventListener('input', () => {
		clearTimeout(findTimer);
		findTimer = window.setTimeout(() => { runSearch(false); }, 250);
	});
	findInput.addEventListener('keydown', (ev) => {
		if (ev.key === 'Enter') {
			ev.preventDefault();
			// まだ探していない語なら探す（1〜2 文字はここでだけ探す）。探した後は次 ・ 前へ
			if (findInput.value.trim() !== searched) {
				clearTimeout(findTimer);
				runSearch(true);
				return;
			}
			go(ev.shiftKey ? 'prev' : 'next');
		}
	});
	for (const b of Array.from(document.querySelectorAll('.find button'))) {
		b.addEventListener('click', () => { go(/** @type {HTMLElement} */ (b).dataset.go ?? 'next'); });
	}

	// ---- 始める ----

	async function start() {
		mode = loadMode();
		showMode(mode);
		try {
			await loadScript('data/index.js');
		} catch {
			list.appendChild(el('p', 'empty', '目次 (data/index.js) を読めませんでした。'));
			return;
		}
		const idx = store.index ?? { sessions: [], days: [] };
		sessions = idx.sessions ?? [];
		/** @type {DayInfo[]} */
		const infos = idx.days ?? [];
		if (infos.length === 0) {
			list.appendChild(el('p', 'empty', '会話がありません。'));
			return;
		}
		days = infos.map((info, n) => {
			const section = el('section', 'day');
			section.dataset.n = String(n);
			section.dataset.d = info.d;
			const h = el('h2', 'dh');
			h.appendChild(el('span', '', dayLabel(info)));
			section.appendChild(h);
			const body = el('div', 'turns ph');
			body.style.height = estimate(info) + 'px';
			section.appendChild(body);
			list.appendChild(section);
			return { info, el: section, body, entries: null, res: null, rendered: false, loading: null, resLoading: null, reqLoading: null, turnEls: [] };
		});

		// 画面と前後 1 画面ぶりに入った日だけを読み、描く
		const io = new IntersectionObserver((entries) => {
			for (const e of entries) {
				if (e.isIntersecting) { renderDay(days[Number(/** @type {HTMLElement} */ (e.target).dataset.n)]); }
			}
		}, { root: main, rootMargin: '100% 0px 100% 0px' });
		for (const d of days) { io.observe(d.el); }

		// 開いたときは、いちばん古い履歴（いちばん上）。最新へは「最新へ」ですぐ行ける
		stickBottom = false;
		main.scrollTop = 0;
		main.focus({ preventScroll: true });
		scheduleRail();
	}

	start();
})();
