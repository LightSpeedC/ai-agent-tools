/*
	history2html のビューアをブラウザで確かめる。材料は tools/40_test/run-history2html-viewer-tests.ts が作り、
	書き出したフォルダを HISTORY2HTML_VIEWER_DIR で渡す。file:// のまま開く（決めたこと 13-A）。

	材料は 2026-09-01 〜 2026-10-10 の 40 日。1 日 5 件の依頼に、応答とツールが 1 つずつ付く。
	各日の 1 件目の応答には Markdown の表、最後の依頼と応答にはスクリプトを仕込んである。
*/
import { test, expect, type Page } from '@playwright/test';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const dir = process.env.HISTORY2HTML_VIEWER_DIR ?? '';
const url = pathToFileURL(path.join(dir, 'index.html')).href;

/** 右の会話の、下までの残り */
async function gapToBottom(page: Page): Promise<number> {
	return page.evaluate(() => {
		const m = document.querySelector('.main') as HTMLElement;
		return m.scrollHeight - m.scrollTop - m.clientHeight;
	});
}

/** 日の線の、目盛りの中の高さ（右の会話の高さに比例） */
async function dayLineY(page: Page, d: string): Promise<{ x: number; y: number }> {
	return page.evaluate((day) => {
		const m = document.querySelector('.main') as HTMLElement;
		const rail = document.querySelector('.rail') as HTMLElement;
		const s = document.querySelector('.day[data-d="' + day + '"]') as HTMLElement;
		const r = rail.getBoundingClientRect();
		return { x: r.right - 12, y: r.top + s.offsetTop / m.scrollHeight * rail.clientHeight };
	}, d);
}

/** 開いてすぐ（いちばん古い日が出る） */
async function openOldest(page: Page): Promise<void> {
	await page.goto(url);
	await page.waitForSelector('.day[data-d="2026-09-01"] .turn');
}

/** 開いて「最新へ」で、いちばん新しい日まで行く。ほかのテストの出発点 */
async function open(page: Page): Promise<void> {
	await openOldest(page);
	await page.locator('.jump button[data-go="bottom"]').click();
	await page.waitForSelector('.day[data-d="2026-10-10"] .turn');
	await expect.poll(() => gapToBottom(page), { timeout: 10000 }).toBeLessThan(3);
}

/*
	読んだ応答のファイル。ビューアは読んだ <script> を残す。
	file:// の読み込みは、ブラウザによって request の事象として見えない（Firefox）ため、ページの中で数える
*/
async function loadedRes(page: Page): Promise<string[]> {
	return page.evaluate(() => Array.from(document.querySelectorAll('script[src$="-res.js"]')).map((s) => s.getAttribute('src') ?? ''));
}

test.beforeAll(() => {
	expect(dir, 'HISTORY2HTML_VIEWER_DIR が渡っていない（run-history2html-viewer-tests.ts から回す）').not.toBe('');
});

test('開いたときはいちばん古い履歴（いちばん上）を出し、応答は出さず、応答のファイルも読まない', async ({ page }) => {
	await openOldest(page);
	await page.waitForTimeout(500);
	expect(await page.evaluate(() => (document.querySelector('.main') as HTMLElement).scrollTop)).toBe(0);
	await expect(page.locator('.day[data-d="2026-09-01"] .bubble.me').first()).toBeInViewport();
	await expect(page.locator('.res:not([hidden])')).toHaveCount(0);
	expect(await loadedRes(page)).toEqual([]);
	await expect(page.locator('.mode button[data-mode="none"]')).toHaveAttribute('aria-pressed', 'true');
	await expect(page.locator('.mode button[data-mode="none"]')).toHaveText('応答を閉じる');
});

test('日付は日ごとに 1 つ。時刻は秒まで', async ({ page }) => {
	await open(page);
	await expect(page.locator('.day[data-d="2026-10-10"] .dh')).toHaveCount(1);
	await expect(page.locator('.day[data-d="2026-10-10"] .dh')).toHaveText('2026/10/10(土)');
	const times = await page.locator('.day[data-d="2026-10-10"] .row.me .tm').allTextContents();
	expect(times.length).toBe(5);
	for (const t of times) { expect(t).toMatch(/^\d{2}:\d{2}:\d{2}$/); }
});

test('↕ をクリックするとその応答だけを展開し、もう一度で畳む。クリックした記号は同じ高さに残る', async ({ page }) => {
	await open(page);
	const turn = page.locator('.day[data-d="2026-10-10"] .turn').nth(2);
	const mark = turn.locator('.expw .exp').first();
	const y0 = (await mark.boundingBox())!.y;
	await mark.click();
	await expect(turn.locator('.res')).toBeVisible();
	await expect(page.locator('.res:not([hidden])')).toHaveCount(1);
	expect(await loadedRes(page)).toEqual(['data/2026-10/2026-10-10-res.js']);
	expect(Math.abs((await mark.boundingBox())!.y - y0)).toBeLessThan(2);
	await expect(turn.locator('.toolline')).toContainText('git status');
	await expect(turn.locator('.res .tm').first()).toHaveText(/^\d{2}:\d{2}:\d{2}$/);
	// 開いているときは「畳む」（上下の内側へ）の記号、閉じているときは「展開する」（上下の外側へ）の記号
	await expect(mark.locator('.i-close')).toBeVisible();
	await expect(mark.locator('.i-open')).toBeHidden();
	// 下の記号でも畳める
	await turn.locator('.expw.bottom .exp').click();
	await expect(page.locator('.res:not([hidden])')).toHaveCount(0);
	await expect(mark.locator('.i-open')).toBeVisible();
	await expect(mark.locator('.i-close')).toBeHidden();
});

test('Markdown の表を描く。生の HTML は効かせず、スクリプトは動かない', async ({ page }) => {
	await open(page);
	const first = page.locator('.day[data-d="2026-10-10"] .turn').first();
	await first.locator('.expw .exp').first().click();
	await expect(first.locator('.md table')).toHaveCount(1);
	await expect(first.locator('.md table')).toContainText('件数');
	const last = page.locator('.day[data-d="2026-10-10"] .turn').last();
	await last.locator('.expw .exp').first().click();
	await expect(last.locator('.bubble.ai')).toContainText('<script>');
	await expect(last.locator('.bubble.me')).toContainText('<script>');
	expect(await page.evaluate(() => (window as any).__xss)).toBeUndefined();
});

test('ヘッダーの「すべて展開」「応答なし」で全部がそろう', async ({ page }) => {
	await open(page);
	await page.locator('.mode button[data-mode="all"]').click();
	await expect(page.locator('.day[data-d="2026-10-10"] .res:not([hidden])')).toHaveCount(5);
	await expect(page.locator('.mode button[data-mode="all"]')).toHaveAttribute('aria-pressed', 'true');
	await page.locator('.mode button[data-mode="none"]').click();
	await expect(page.locator('.res:not([hidden])')).toHaveCount(0);
});

test('目盛りの月のラベルは、その月の初日まで書く（2026/09/1 の形。37-B）', async ({ page }) => {
	// 目盛りの文字は canvas に描くので、描いた文字を記録して見る
	await page.addInitScript(() => {
		const w = window as any;
		w.__labels = [];
		const orig = CanvasRenderingContext2D.prototype.fillText;
		CanvasRenderingContext2D.prototype.fillText = function (text: string, x: number, y: number, max?: number) {
			w.__labels.push(String(text));
			return max === undefined ? orig.call(this, text, x, y) : orig.call(this, text, x, y, max);
		};
	});
	await openOldest(page);
	await page.waitForTimeout(500);
	const labels: string[] = await page.evaluate(() => (window as any).__labels);
	expect(labels).toContain('2026/09/1');
	expect(labels).toContain('2026/10/1');
});

test('目盛りの日の線をクリックすると、その日へ動く', async ({ page }) => {
	await open(page);
	const p = await dayLineY(page, '2026-09-05');
	await page.mouse.click(p.x, p.y);
	await expect(page.locator('.day[data-d="2026-09-05"] .turn').first()).toBeVisible();
	await expect.poll(() => page.evaluate(() => {
		const m = (document.querySelector('.main') as HTMLElement).getBoundingClientRect().top;
		return Math.abs((document.querySelector('.day[data-d="2026-09-05"]') as HTMLElement).getBoundingClientRect().top - m);
	})).toBeLessThan(10);
});

test('つまみをドラッグすると、右がその量だけ動く', async ({ page }) => {
	await open(page);
	const box = (await page.locator('.thumb').boundingBox())!;
	const before = await page.evaluate(() => (document.querySelector('.main') as HTMLElement).scrollTop);
	const k = await page.evaluate(() => (document.querySelector('.main') as HTMLElement).scrollHeight / (document.querySelector('.rail') as HTMLElement).clientHeight);
	await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
	await page.mouse.down();
	await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2 - 100, { steps: 10 });
	await page.mouse.up();
	const after = await page.evaluate(() => (document.querySelector('.main') as HTMLElement).scrollTop);
	// 下の日が描かれて高さが変わっても位置は保つので、多少のずれは許す
	expect(before - after).toBeGreaterThan(100 * k * 0.7);
	expect(before - after).toBeLessThan(100 * k * 1.3);
});

test('「すべて展開」のあとも、つまみはポインタに付いて動き、右は戻らずに上へ進む', async ({ page }) => {
	await open(page);
	await page.locator('.mode button[data-mode="all"]').click();
	await expect(page.locator('.day[data-d="2026-10-10"] .res:not([hidden])')).toHaveCount(5);
	const box = (await page.locator('.thumb').boundingBox())!;
	const x = box.x + box.width / 2;
	let y = box.y + box.height / 2;
	await page.mouse.move(x, y);
	await page.mouse.down();
	let last = Infinity;
	const rail = (await page.locator('.rail .track').boundingBox())!;
	for (let i = 0; i < 30 && y > rail.y + 40; i++) {
		y -= 12;
		await page.mouse.move(x, y);
		await page.waitForTimeout(60);
		const s = await page.evaluate(() => {
			const t = (document.querySelector('.thumb') as HTMLElement).getBoundingClientRect();
			return { top: (document.querySelector('.main') as HTMLElement).scrollTop, mid: t.top + t.height / 2 };
		});
		// 描き足しで全体の高さが変わっても、つまみはポインタから離れない
		expect(Math.abs(s.mid - y)).toBeLessThan(20);
		// 上へ動かしている間、右は下へ戻らない
		expect(s.top).toBeLessThanOrEqual(last + 2);
		last = s.top;
	}
	await page.mouse.up();
});

test('目盛りに乗せると 0.5 秒ほどで日時が出る。出たあとは待たずに追従し、外に出ると最初から', async ({ page }) => {
	await open(page);
	const p1 = await dayLineY(page, '2026-09-10');
	const p2 = await dayLineY(page, '2026-09-20');
	const tip = page.locator('.tip');
	await page.mouse.move(p1.x, p1.y);
	await page.waitForTimeout(200);
	await expect(tip).toBeHidden();
	await page.waitForTimeout(600);
	await expect(tip).toBeVisible();
	await expect(tip).toContainText('2026/09/10(木)');
	// 出たあとは、動かすだけで切り替わる
	await page.mouse.move(p2.x, p2.y);
	await expect(tip).toContainText('2026/09/20(日)', { timeout: 150 });
	// 外に出たら消え、戻ったときはまた待つ
	const main = (await page.locator('.main').boundingBox())!;
	await page.mouse.move(main.x + main.width / 2, main.y + 100);
	await expect(tip).toBeHidden();
	await page.mouse.move(p1.x, p1.y);
	await page.waitForTimeout(200);
	await expect(tip).toBeHidden();
});

test('発言の線に乗せると、日時と発言の先頭が出る', async ({ page }) => {
	await open(page);
	const p = await page.evaluate(() => {
		const m = document.querySelector('.main') as HTMLElement;
		const rail = document.querySelector('.rail') as HTMLElement;
		const t = document.querySelectorAll('.day[data-d="2026-10-10"] .turn')[2] as HTMLElement;
		const r = rail.getBoundingClientRect();
		return { x: r.right - 10, y: r.top + t.offsetTop / m.scrollHeight * rail.clientHeight };
	});
	await page.mouse.move(p.x, p.y);
	await expect(page.locator('.tip')).toContainText('2026/10/10(土) ', { timeout: 2000 });
	await expect(page.locator('.tip')).toContainText('依頼 40-');
});

test('「すべて展開」は sessionStorage に覚え、読み直しても続く（33-A）', async ({ page }) => {
	await open(page);
	await page.locator('.mode button[data-mode="all"]').click();
	await expect(page.locator('.mode button[data-mode="all"]')).toHaveAttribute('aria-pressed', 'true');
	await page.reload();
	// 開くといちばん古い日が出る
	await page.waitForSelector('.day[data-d="2026-09-01"] .turn');
	await expect(page.locator('.mode button[data-mode="all"]')).toHaveAttribute('aria-pressed', 'true');
	await expect(page.locator('.day[data-d="2026-09-01"] .res:not([hidden])')).toHaveCount(5);
	expect(await page.evaluate(() => sessionStorage.getItem('history2html.mode'))).toBe('all');
});

test('検索欄にカーソルが来たら、裏で全部の日（応答も）を読み始める', async ({ page }) => {
	await open(page);
	await page.locator('.find input').focus();
	await expect.poll(async () => (await loadedRes(page)).length, { timeout: 15000 }).toBe(40);
	await expect.poll(() => page.evaluate(() => document.querySelectorAll('script[src$="-req.js"]').length), { timeout: 15000 }).toBe(40);
});

test('検索は 3 文字以上で、当たったところへ飛び、件数を x/y で出す', async ({ page }) => {
	await open(page);
	const input = page.locator('.find input');
	const count = page.locator('.find .cnt');
	await input.fill('依頼');
	await page.waitForTimeout(500);
	await expect(count).toHaveText('');
	await input.fill('依頼 40-');
	await expect(count).toHaveText('1/5', { timeout: 15000 });
	await expect(page.locator('mark').first()).toBeInViewport();
	await expect(page.locator('mark').first()).toHaveText('依頼 40-');
	await page.locator('.find button[data-go="next"]').click();
	await expect(count).toHaveText('2/5');
	await page.locator('.find button[data-go="last"]').click();
	await expect(count).toHaveText('5/5');
	await page.locator('.find button[data-go="prev"]').click();
	await expect(count).toHaveText('4/5');
	await page.locator('.find button[data-go="first"]').click();
	await expect(count).toHaveText('1/5');
	await expect(page.locator('mark').first()).toBeInViewport();
});

test('1〜2 文字は、Enter を押したときに検索する（36-A）', async ({ page }) => {
	await open(page);
	const input = page.locator('.find input');
	await input.fill('40');
	await page.waitForTimeout(500);
	await expect(page.locator('.find .cnt')).toHaveText('');
	await input.press('Enter');
	await expect(page.locator('.find .cnt')).toHaveText(/^1\/\d+$/, { timeout: 15000 });
	await expect(page.locator('mark.cur')).toBeInViewport();
});

test('応答の中で当たったら、その応答を展開して見せる。遠い日へも飛ぶ', async ({ page }) => {
	await open(page);
	await page.locator('.find input').fill('応答 1-2');
	await expect(page.locator('.find .cnt')).toHaveText('1/1', { timeout: 15000 });
	const hit = page.locator('.day[data-d="2026-09-01"] .res mark');
	await expect(hit).toBeInViewport();
	await expect(hit).toHaveText('応答 1-2');
});

test('先頭へ ・ 最新へのボタンで、いちばん上といちばん下へ飛ぶ', async ({ page }) => {
	await open(page);
	await page.locator('.jump button[data-go="top"]').click();
	await expect(page.locator('.day[data-d="2026-09-01"] .turn').first()).toBeInViewport({ timeout: 10000 });
	await page.locator('.jump button[data-go="bottom"]').click();
	await expect.poll(() => gapToBottom(page), { timeout: 10000 }).toBeLessThan(3);
});

test('目盛りの左の余白は、クリックしても何も起きない', async ({ page }) => {
	await open(page);
	const before = await page.evaluate(() => (document.querySelector('.main') as HTMLElement).scrollTop);
	const gutter = (await page.locator('.rail .gutter').boundingBox())!;
	expect(gutter.width).toBeGreaterThan(4);
	await page.mouse.click(gutter.x + gutter.width / 2, gutter.y + gutter.height * 0.2);
	await page.waitForTimeout(300);
	expect(await page.evaluate(() => (document.querySelector('.main') as HTMLElement).scrollTop)).toBe(before);
});

test('表題はフォルダ名と 1 行の概要', async ({ page }) => {
	await open(page);
	await expect(page.locator('.hdr h1')).toHaveText('proj');
	await expect(page.locator('.hdr .lead')).toHaveText('ビューアの試しの概要');
});

test('CDN が読めなくても、本文を文字のまま出す', async ({ page }) => {
	await page.route('**/cdnjs.cloudflare.com/**', (r) => r.abort());
	await open(page);
	const first = page.locator('.day[data-d="2026-10-10"] .turn').first();
	await first.locator('.expw .exp').first().click();
	await expect(first.locator('.bubble.ai .plain')).toContainText('| 項目 | 値 |');
	await expect(first.locator('table')).toHaveCount(0);
});
