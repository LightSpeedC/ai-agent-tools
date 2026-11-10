/*
	issue decide migrate のテスト: 資料と課題に散っている過去の決定を decisions/ へ移す。
	計画は p261108-03 (188-A 〜 193-A)。

	期待値は、計画から先に手で書いた (実装の出力から作っていない)。
	本物のプロジェクトには触らない。tmp/ の下に、ケースごとの小さなプロジェクトを作る。
*/
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..', '..');
const work = path.join(root, 'tmp', 'issue-decide-migrate-tests');
const main = path.join(root, 'src', 'issue', 'main.ts');

let pass = 0;
let fail = 0;
function check(name: string, ok: boolean, detail: string = ''): void {
	if (ok) { pass++; console.log('  ✅ [OK] ' + name); }
	else { fail++; console.log('  ❌ [NG] ' + name + (detail ? '  ' + detail : '')); }
}

// ---- 材料 ----

const ProjectIdText = 'schema: 1\nproject_id: 7b0c4e1a9f3d4a62b8d51c2e6f90a3b7\n';
const Items = 'notes/40_issues/items/';
const Decisions = 'notes/40_issues/decisions/';
const Plan = 'notes/10_plan/';
const WrittenList = Decisions + '_decide-migrate-written.txt';

function page(title: string, body: string, created: string = '2026-11-03'): string {
	return `<!DOCTYPE html>\n<html lang="ja">\n<head>\n<meta charset="UTF-8">\n<title>${title}</title>\n</head>\n<body>\n<div class="titlebar"><div class="inner"><h1>${title}</h1>\n<p class="date">📅 作成: ${created} / 更新: ${created}</p></div></div>\n<div class="wrap">\n${body}\n</div>\n</body>\n</html>\n`;
}

/** 「決めること / 案 / 推す理由」の表 (案ごとに 1 行。決めることは rowspan) */
const OptionTable = `<section class="ch01" id="ch01"><h1>決めること</h1>
<p>本文。11-B に決めた。</p>
<table>
	<thead><tr><th>番号</th><th>決めること</th><th>案</th><th>推す理由</th></tr></thead>
	<tbody>
		<tr>
			<td class="nowrap">10-A</td>
			<td rowspan="2">実装の順序 (恒久)</td>
			<td><strong>A</strong>: TypeScript を先に作る</td>
			<td>突き合わせの相手になる</td>
		</tr>
		<tr>
			<td class="nowrap">10-B</td>
			<td><strong>B</strong>: 同時に作る</td>
			<td>早く揃う</td>
		</tr>
		<tr>
			<td>11-A</td>
			<td rowspan="2">マージンの既定</td>
			<td><strong>A</strong>: 30 分</td>
			<td>余裕を取る</td>
		</tr>
		<tr>
			<td>11-B</td>
			<td><strong>B</strong>: 10 分</td>
			<td>読みが少ない</td>
		</tr>
	</tbody>
</table>
<pre><code>12-A はコードの中なので拾わない</code></pre>
</section>`;

/** 「決めたこと」の表 (1 行が 1 件) と、同じ番号の案の表 (別の表) */
const DecidedTable = `<section class="ch01" id="ch01"><h1>決めたこと</h1>
<table>
	<thead><tr><th>番号</th><th>決めたこと</th><th>改める前の決定</th></tr></thead>
	<tbody>
		<tr><td class="nowrap">20-A</td><td>決定を 1 件 1 ファイルにする</td><td>―</td></tr>
		<tr><td class="nowrap">21-B</td><td>id を親の番号 + 連番にする</td><td>20-A の形</td></tr>
		<tr><td class="nowrap">22-A (番号の後ろに説明)</td><td>1 列目に説明が続いても表の行として読む</td><td>―</td></tr>
	</tbody>
</table>
<h2>選ばなかった案</h2>
<table>
	<thead><tr><th>番号</th><th>案</th></tr></thead>
	<tbody>
		<tr><td>21-A</td><td>独立した番号にする</td></tr>
	</tbody>
</table>
</section>`;

const issueMd = (id: string, body: string): string => `---\nschema: 1\nid: ${id}\ntitle: 題\ngroup: g\ncreated: 2026-11-04\n---\n\n${body}\n`;

const Legacy = `<!DOCTYPE html>\n<html lang="ja"><head><meta charset="UTF-8"><title>課題</title></head><body>
<h1>グループ</h1>
<details><summary><span class="no">i261101-05</span><span class="badge b-ok">済</span>旧の課題</summary>
<p>40-C で決めた。</p>
</details>
</body></html>
`;

function existingDecision(project: string): string {
	return `---\nschema: 1\nid: p261106-01-d1\ntitle: 既にある\nparent: p261106-01\ndecided: 2026-11-06\nchosen: A\nlegacy_ids: :${project}:20-A\n---\n\n## 案\n\n- A: 既にある案\n`;
}

function mkProject(name: string, extra: Record<string, string> = {}): string {
	const dir = path.join(work, name);
	fs.rmSync(dir, { recursive: true, force: true });
	fs.mkdirSync(dir, { recursive: true });
	const files: Record<string, string> = {
		[Items + 'project-id.txt']: ProjectIdText,
		[Items + 'done/i261104-01-題.md']: issueMd('i261104-01', '本文で (30-A) に決めた。`31-A` はコードの中。i261108-03 ・ 2026-11-08 ・ UTF-8 は番号ではない。'),
		[Plan + 'p261103-01-案の表.html']: page('案の表', OptionTable),
		[Plan + 'p261106-01-決めたこと.html']: page('決めたこと', DecidedTable, '2026-11-06'),
		['notes/50_spec/番号の無い資料.html']: page('番号の無い資料', '<table><thead><tr><th>番号</th><th>決めたこと</th></tr></thead><tbody><tr><td>50-A</td><td>親にできない</td></tr></tbody></table>'),
		['notes/40_issues/issues-legacy.html']: Legacy,
		[Decisions + 'p261106-01-d1-既にある.md']: existingDecision(name),
		...extra,
	};
	for (const [rel, text] of Object.entries(files)) {
		const full = path.join(dir, rel);
		fs.mkdirSync(path.dirname(full), { recursive: true });
		fs.writeFileSync(full, text);
	}
	return dir;
}

type Result = { code: number; out: string; err: string };
function run(args: string[], dir: string): Result {
	const r = spawnSync(process.execPath, [main, 'decide', 'migrate', ...args, '--root', dir], {
		cwd: dir, env: { ...process.env, ISSUE_TEST_TODAY: '2026-11-08' }, encoding: 'utf8', timeout: 60000,
	});
	return { code: r.status ?? -1, out: (r.stdout ?? '').trim(), err: (r.stderr ?? '').trim() };
}
function json(r: Result): any {
	try { return JSON.parse(r.out); } catch { return null; }
}
function decisionFiles(dir: string): string[] {
	try { return fs.readdirSync(path.join(dir, Decisions)).filter((n) => n.endsWith('.md')).sort(); } catch { return []; }
}
function read(dir: string, rel: string): string {
	try { return fs.readFileSync(path.join(dir, rel), 'utf8'); } catch { return ''; }
}
function fileOf(dir: string, id: string): string {
	const n = decisionFiles(dir).find((f) => f.startsWith(id + '-'));
	return n === undefined ? '' : read(dir, Decisions + n);
}

// ---- dry-run ----

console.log('--- dry-run');
{
	const dir = mkProject('proj');
	const before = decisionFiles(dir);
	const r = run(['--dry-run', '--json'], dir);
	const j = json(r);
	check('--dry-run は終了コード 0 で、JSON を出す', r.code === 0 && j !== null, r.out + r.err);
	check('--dry-run は何も書かない', JSON.stringify(decisionFiles(dir)) === JSON.stringify(before) && !fs.existsSync(path.join(dir, WrittenList)));
	const legacy = (j?.move ?? []).map((m: any) => m.legacy).sort();
	check('表から 10 ・ 11 ・ 21 ・ 22、本文から 30 ・ 40 を移す (20 は既にある)', JSON.stringify(legacy) === JSON.stringify(['10-A', '11-B', '21-B', '22-A', '30-A', '40-C']), JSON.stringify(legacy));
	check('1 列目の番号の後ろに説明が続く行も、表から読む (本文から拾ったに入れない)', !(j?.fromText ?? []).includes('22') && (j?.move ?? []).some((m: any) => m.legacy === '22-A' && m.from === 'table'), JSON.stringify(j?.move));
	check('既にある旧番号 (20) を飛ばした数に出す', JSON.stringify(j?.skipped ?? []) === JSON.stringify(['20']), JSON.stringify(j?.skipped));
	check('本文に記録が無く A とみなした番号は 10 だけ (192-A)', JSON.stringify(j?.assumedA ?? []) === JSON.stringify(['10']), JSON.stringify(j?.assumedA));
	check('本文から拾った番号は 30 ・ 40 (193-A)', JSON.stringify((j?.fromText ?? []).slice().sort()) === JSON.stringify(['30', '40']), JSON.stringify(j?.fromText));
	check('コードの中 (12 ・ 31) と、番号 ・ 日付の一部は拾わない', !legacy.some((x: string) => /^(12|31|8|0|11-0|3)-/.test(x) && !['11-B'].includes(x)));
	check('番号の無い資料の表は「読めない」に出す', (j?.unreadable ?? []).some((u: any) => String(u.where).includes('番号の無い資料.html') && String(u.message).includes('50')), JSON.stringify(j?.unreadable));
	const t = run(['--dry-run'], dir);
	check('文字の出力に、件数と一覧が出る', t.code === 0 && t.out.includes('移す: 6 件') && t.out.includes('A とみなした') && t.out.includes('本文から拾った'), t.out);
	check('出力に絶対パスを出さない', !t.out.includes(dir) && !t.out.includes(dir.replace(/\\/g, '/')));
	check('既定 (引数なし) は --dry-run', run([], dir).out.includes('移す: 6 件'));
}

// ---- apply ----

console.log('--- apply');
{
	const dir = mkProject('proj');
	const r = run(['--apply'], dir);
	check('--apply は終了コード 0', r.code === 0, r.out + r.err);
	check('6 件を書く (既にある 1 件と合わせて 7 件)', decisionFiles(dir).length === 7, decisionFiles(dir).join(' '));
	const d10 = fileOf(dir, 'p261103-01-d1');
	check('親は表がある資料の番号、連番は旧番号の順 (10 → d1)', d10.includes('legacy_ids: :proj:10-A') && d10.includes('parent: p261103-01'), d10);
	check('案の表は、全部の案と推す理由を書く', d10.includes('- A: TypeScript を先に作る (推す理由: 突き合わせの相手になる)') && d10.includes('- B: 同時に作る (推す理由: 早く揃う)'), d10);
	check('案の表の問いは「決めること」の文 (rowspan)', d10.includes('title: 実装の順序 (恒久)'));
	check('A とみなしたことを本文に書く', d10.includes('chosen: A') && d10.includes('推奨の A とみなした'));
	check('決めた日は、資料の作成日', d10.includes('decided: 2026-11-03'));
	const d11 = fileOf(dir, 'p261103-01-d2');
	check('本文に出てくる字 (11-B) を選んだ案にする', d11.includes('chosen: B') && d11.includes('legacy_ids: :proj:11-B') && d11.includes('title: マージンの既定'), d11);
	const d21 = fileOf(dir, 'p261106-01-d2');
	check('既にある決定 (d1) の続きの連番 (21 → d2)', d21.includes('legacy_ids: :proj:21-B'), d21);
	check('決めたことの表と、別の表の案をまとめる', d21.includes('chosen: B') && d21.includes('- A: 独立した番号にする') && d21.includes('- B: id を親の番号 + 連番にする'), d21);
	check('決めたことの表は、問いを「記録なし」にし、ほかの列を本文に残す', d21.includes('title: 記録なし (旧 21)') && d21.includes('改める前の決定: 20-A の形'), d21);
	const d30 = fileOf(dir, 'i261104-01-d1');
	check('本文から拾った番号は、出てきた課題を親にする', d30.includes('parent: i261104-01') && d30.includes('legacy_ids: :proj:30-A'), d30);
	check('本文から拾った番号の案は「記録なし」、出てきた箇所を書く', d30.includes('- A: 記録なし') && d30.includes('## 出てきた箇所') && d30.includes('(30-A) に決めた'), d30);
	const d40 = fileOf(dir, 'i261101-05-d1');
	check('旧課題の HTML から拾い、C まで案の行を埋める', d40.includes('chosen: C') && d40.includes('- A: 記録なし') && d40.includes('- B: 記録なし') && d40.includes('- C: 記録なし'), d40);
	check('書いたファイルの一覧を残す', read(dir, WrittenList).trim().split('\n').length === 6, read(dir, WrittenList));
	const c = spawnSync(process.execPath, [main, 'check', '--root', dir], { encoding: 'utf8' });
	check('書いたあとの issue check は問題なし', c.status === 0, (c.stdout ?? '') + (c.stderr ?? ''));
	const again = json(run(['--dry-run', '--json'], dir));
	check('2 回目は、全部が既にあるので移すものが 0', (again?.move ?? [1]).length === 0, JSON.stringify(again?.move));
	const u = run(['--undo'], dir);
	check('--undo は書いた 6 件だけを消し、既にあった決定は残す', u.code === 0 && JSON.stringify(decisionFiles(dir)) === JSON.stringify(['p261106-01-d1-既にある.md']), decisionFiles(dir).join(' ') + u.out + u.err);
	check('--undo は一覧も消す', !fs.existsSync(path.join(dir, WrittenList)));
	check('一覧が無いときの --undo は終了コード 1', run(['--undo'], dir).code === 1);
}

// ---- 218-A: 移し済みの決定を数え直す (--recheck) ----

console.log('--- recheck');
{
	const dir = mkProject('recheck', {
		[Plan + 'i261012-01-両方.html']: page('両方', '<p>決めたこと: 5-A と 5-B の両方 ・ 6-A。</p><ul><li>7-A: 先に作る</li><li>7-B: 後で作る</li></ul><p>7-A に決めた。8-A・B を採る。</p>', '2026-10-12'),
	});
	run(['--apply'], dir);
	const j = json(run(['--dry-run', '--recheck', '--json'], dir));
	const list = j?.recheck ?? [];
	check('218-A: --recheck は、移し済みの決定で、両方を選んだと読める字 (5-A と 5-B の両方) を出す',
		list.length >= 1 && list[0].legacy === '5' && list[0].letters === 'A ・ B' && typeof list[0].id === 'string' && list[0].chosen === 'A', JSON.stringify(j));
	check('219-A: 「8-A・B」の並べ方も拾う', list.some((h: any) => h.legacy === '8' && h.letters === 'A ・ B'), JSON.stringify(list));
	check('219-A: 案の一覧 (7-A: … 7-B: …) のように別々に出てくる字は拾わない', !list.some((h: any) => h.legacy === '7'), JSON.stringify(list));
	check('219-A: 拾うのは 5 と 8 の 2 件だけ', list.length === 2, JSON.stringify(list));
	const t = run(['--dry-run', '--recheck'], dir);
	check('218-A: 文字の出力に、決定の id と出てきた字、直し方 (--chosen ・ --replaces) を出す',
		t.out.includes(list[0]?.id ?? '???') && t.out.includes('A ・ B') && t.out.includes('--replaces'), t.out);
	check('218-A: --recheck は何も書かない (移すものは 0 件のまま)', (j?.move ?? [1]).length === 0);
	const k = json(run(['--dry-run', '--json'], dir));
	check('218-A: --recheck を付けなければ、recheck を出さない', k !== null && k.recheck === undefined, JSON.stringify(k));
}

// ---- 資料ごとに振り直した番号 (194-A) ----

console.log('--- 資料ごとの番号');
{
	const dir = mkProject('perdoc', {
		[Plan + 'i261012-01-一つ目.html']: page('一つ目', '<p>決めたこと: 1-C ・ 2-A。</p>', '2026-10-12'),
		[Plan + 'i261012-02-二つ目.html']: page('二つ目', '<p>決めたこと: 1-B。</p>', '2026-10-12'),
	});
	const j = json(run(['--dry-run', '--json'], dir));
	const ones = (j?.move ?? []).filter((m: any) => /(^|\/)1-[A-Z]$/.test(m.legacy)).map((m: any) => `${m.parent} ${m.legacy}`).sort();
	check('2 つ以上の資料に出てくる番号は、資料ごとに別の決定にする', JSON.stringify(ones) === JSON.stringify(['i261012-01 i261012-01/1-C', 'i261012-02 i261012-02/1-B']), JSON.stringify(ones));
	check('1 つの資料にしか出てこない番号は、これまでどおり 1 件 (旧番号に資料を付けない)', (j?.move ?? []).some((m: any) => m.legacy === '2-A' && m.parent === 'i261012-01'));
	check('資料ごとに分けた番号は、字が割れた一覧に出さない', !(j?.split ?? []).some((s: any) => s.number === '1'), JSON.stringify(j?.split));
	run(['--apply'], dir);
	check('旧番号は :プロジェクト:資料の番号/番号-字 の形で残す', fileOf(dir, 'i261012-01-d1').includes('legacy_ids: :perdoc:i261012-01/1-C'), fileOf(dir, 'i261012-01-d1'));
	check('2 回目は、資料ごとの旧番号も既にあるとして飛ばす', (json(run(['--dry-run', '--json'], dir))?.move ?? [1]).length === 0);
}

// ---- 前提 (課題の移行が済んでいること) ----

console.log('--- 前提');
{
	const dir = mkProject('premise', { 'notes/40_issues/issues.html': Legacy });
	const r = run(['--dry-run'], dir);
	check('課題の移行が済んでいない (issues.html が残っている) と、終了コード 1 で止める', r.code === 1 && (r.out + r.err).includes('issue migrate'), r.out + r.err);
	const noItems = mkProject('premise2');
	fs.rmSync(path.join(noItems, Items, 'project-id.txt'));
	const r2 = run(['--dry-run'], noItems);
	check('items/project-id.txt が無いと、終了コード 1 で止める', r2.code === 1 && (r2.out + r2.err).includes('issue migrate'), r2.out + r2.err);
}

// ---- 巻き戻し ----

console.log('--- 書いたあとの確かめ');
{
	// issue check のエラー (名前の形が違う決定) が残っていると、書いたものを全部消して止まる
	const dir = mkProject('rollback', { [Decisions + 'bad.md']: 'x\n' });
	const before = decisionFiles(dir);
	const r = run(['--apply'], dir);
	check('確かめで落ちたら、終了コード 1', r.code === 1, r.out + r.err);
	check('書いたものを全部消して、元に戻す', JSON.stringify(decisionFiles(dir)) === JSON.stringify(before), decisionFiles(dir).join(' '));
	check('戻したときは一覧を残さない', !fs.existsSync(path.join(dir, WrittenList)));
	check('戻したことを出す', r.out.includes('元に戻した'), r.out);
}

// ---- 引数 ----

console.log('--- 引数');
{
	const dir = mkProject('args');
	check('--apply と --undo は一緒に使えない (終了コード 5)', run(['--apply', '--undo'], dir).code === 5);
	check('知らないオプションは終了コード 5', run(['--bogus'], dir).code === 5);
}

console.log('');
// ---- 字の無い旧番号 (:proj:210) も既にあるとみなす (i261110-05) ----

console.log('--- 字の無い旧番号');
{
	const dir = mkProject('bare', {
		[Decisions + 'i261104-01-d1-字なし.md']: '---\nschema: 1\nid: i261104-01-d1\ntitle: 字なし\nparent: i261104-01\ndecided: 2026-11-04\nchosen: A\nlegacy_ids: :bare:30\n---\n\n## 案\n\n- A: a\n',
	});
	const j = json(run(['--dry-run', '--json'], dir));
	check('legacy_ids に字の無い番号 (:bare:30) があれば、30 は既にあるとみなして移さない', !(j?.move ?? []).some((m: any) => String(m.legacy).startsWith('30-')), JSON.stringify((j?.move ?? []).map((m: any) => m.legacy)));
}

// ---- 見出しに「案」の無い案の表 (i261110-05) ----

console.log('--- 見出しに「案」の無い案の表');
{
	const body = `<section class="ch01" id="ch01"><h1>決めること</h1>
<h2>60: 受け持ち (2026-11-01、60-A に決定)</h2>
<table>
	<thead><tr><th>番号</th><th>中身</th><th>恒久 / 暫定</th></tr></thead>
	<tbody>
		<tr><td>60-A (推奨)</td><td>決めて起こす</td><td>恒久</td></tr>
		<tr><td>60-B</td><td>決めるだけ</td><td>恒久</td></tr>
	</tbody>
</table></section>`;
	const dir = mkProject('noheader', { [Plan + 'p261107-01-見出しの無い案.html']: page('見出しの無い案', body, '2026-11-07') });
	const r = run(['--dry-run', '--json'], dir);
	const m = (json(r)?.move ?? []).find((x: any) => String(x.legacy).startsWith('60-'));
	check('同じ表に同じ番号の行が 2 つ以上あれば、案の表として読む (最後の行の字を選んだ字にしない)', m !== undefined && m.legacy === '60-A' && m.chosen === 'A', JSON.stringify(m) + ' / ' + (json(r)?.move ?? []).map((x: any) => x.legacy).join(',') + r.err);
	const a = run(['--apply'], dir);
	const d60 = decisionFiles(dir).map((f) => read(dir, Decisions + f)).find((t) => t.includes(':noheader:60-')) ?? '';
	check('案の表として読んだとき、両方の案の文を残す', a.code === 0 && d60.includes('- A: 決めて起こす') && d60.includes('- B: 決めるだけ') && d60.includes('chosen: A'), a.out + a.err + ' / ' + d60);
	// 誤った字で移った決定を、手で置き換えたあとの --recheck
	const wrongId = /^id: (\S+)$/m.exec(d60)?.[1] ?? '';
	fs.writeFileSync(path.join(dir, Decisions, 'p261107-01-d9-置き換え.md'), `---\nschema: 1\nid: p261107-01-d9\ntitle: 受け持ち\nparent: p261107-01\ndecided: 2026-11-10\nchosen: A\nreplaces: ${wrongId}\nlegacy_ids: :noheader:60-A\n---\n\n## 案\n\n- A: 決めて起こす\n- B: 決めるだけ\n`);
	const rc = json(run(['--dry-run', '--recheck', '--json'], dir));
	const ids = (rc?.recheck ?? []).map((h: any) => h.id);
	check('--recheck は、置き換えられた決定と、--replaces で書いた決定を出さない (人が見直し済み)', !ids.includes(wrongId) && !ids.includes('p261107-01-d9'), JSON.stringify(ids));
}

console.log(`=== issue (decide migrate): ${pass} 件成功 ・ ${fail} 件失敗 ===`);
fs.rmSync(work, { recursive: true, force: true });
process.exit(fail === 0 ? 0 : 1);
