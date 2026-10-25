/*
	history2html（会話ログから公開用の HTML を作る）のテスト。計画は p261014-01。

	会話ログ（JSONL）はここで合成する。人を表す値は user1 ・ tester1 のような仮の名前、
	アドレスは example.com にする（共通ルール「テストのルール」）。

	**載せてはいけないものには目印（〜-MARK）を入れておき、出力のどこにも無いことを見る。**
	拾い方を名指しにした（知らない種類は捨てる）ことを守るため、知らない種類の記録も混ぜる。

	伏せ字は、書き出した後の全体をもう一度検査する 2 段目まで確かめる。
	1 段目をわざと外す（HISTORY2HTML_TEST_NO_MASK）と、2 段目が止めること。
*/
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..', '..');
const work = path.join(root, 'tmp', 'history2html-tests');
const main = path.join(root, 'src', 'history2html', 'main.ts');

let pass = 0;
let fail = 0;
function check(name: string, ok: boolean, detail: string = ''): void {
	if (ok) { pass++; console.log('  ✅ [OK] ' + name); }
	else { fail++; console.log('  ❌ [NG] ' + name + (detail ? '  ' + detail : '')); }
}

// ---- 材料 ----

/*
	環境から取る値は差し替える。本物のユーザー名 ・ マシン名をテストに持ち込まない。
	git の author は、作ったプロジェクトの .git に書く（git config はそのフォルダの値を返す）
*/
const User = 'tester1';
const Home = 'C:\\Users\\' + User;
const Host = 'HOST-TEST-01';
const AuthorName = 'Author One';
const AuthorMail = 'author1@example.com';
const Env = { HISTORY2HTML_USERNAME: User, HISTORY2HTML_HOME: Home, HISTORY2HTML_HOSTNAME: Host };

let uuid = 0;
function line(o: Record<string, unknown>): string {
	return JSON.stringify(o);
}
function base(type: string, sessionId: string, ts: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
	uuid++;
	return { type, uuid: 'u-' + uuid, parentUuid: null, sessionId, timestamp: ts, isSidechain: false, cwd: Home + '\\proj', ...extra };
}
function prompt(sid: string, ts: string, content: unknown, extra: Record<string, unknown> = {}): Record<string, unknown> {
	return base('user', sid, ts, { message: { role: 'user', content }, origin: { kind: 'human' }, promptSource: 'typed', ...extra });
}
function assistant(sid: string, ts: string, blocks: unknown[], extra: Record<string, unknown> = {}): Record<string, unknown> {
	return base('assistant', sid, ts, { message: { role: 'assistant', content: blocks }, ...extra });
}
function toolResult(sid: string, ts: string, id: string, content: string, isError: boolean): Record<string, unknown> {
	return base('user', sid, ts, { message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content, is_error: isError }] } });
}

// 伏せる値と、伏せてはいけない値（誤検出しないこと）。組み立てて書く（このソース自体が公開前の検査に当たらないように）
const Drive = 'C:';
const MaskText = [
	'自分のパス ' + Drive + '\\Users\\tester1\\proj\\a.ts と ' + Drive + '\\\\Users\\\\tester1\\\\proj と ' + Drive + '/Users/tester1/proj と /c' + '/Users/tester1/proj',
	'ほかの人のパス ' + Drive + '\\Users\\hanako\\docs',
	'author は ' + AuthorName + ' <' + AuthorMail + '>',
	'マシンは ' + Host + ' です',
	'連絡先 someone' + '@mail-sample.jp と user' + '@example.com',
	'コードネームは Bluebird',
	'セッション https://claude.ai/code/session_' + '01AbCdEfGh',
	'鍵 sk-ant-' + 'api03-AbCdEf0123456789xyz と ghp' + '_AbCdEfGh0123456789AbCdEfGh0123 と password=' + 'Abc-12345.xyz!',
	// 英数字だけの値（Abc12345xyz）は、コードの識別子と区別できないので当てない（check-public と同じ判定）
	'内部 build-server.local と 192.168' + '.10.20',
	'伏せない settings.local.json と 10.0.26300.1',
].join('\n');

const SidA = 'sess-a';
const SidB = 'sess-b';

/*
	時間の流れ（UTC → JST）

	  A1 14:59:50 → 10/13 23:59:50   日の境目の手前
	  A2 15:00:00 → 10/14 00:00:00   UTC 15:00 は JST の翌日
	  B1 15:05:00 → 10/14 00:05:00   B の応答は 15:25 で、A の通知（15:20）より後
	  A  15:20:00 → 10/14 00:20:00   通知（人の発言なしで始まる応答）
	  A3 15:40:00 → 10/14 00:40:00
	  B2 15:45:00 → 10/14 00:45:00
*/
function sessionA(): string[] {
	return [
		line({ type: 'custom-title', customTitle: '作業 A の題', sessionId: SidA }),
		line(base('attachment', SidA, '2026-10-13T14:59:40.000Z', { attachment: { type: 'hook_additional_context', content: '<system-reminder>ATTACHMENT-MARK</system-reminder>' } })),
		line(prompt(SidA, '2026-10-13T14:59:50.000Z', '依頼A1 です')),
		line(assistant(SidA, '2026-10-13T14:59:51.000Z', [{ type: 'thinking', thinking: 'THINKING-MARK', signature: 'x' }])),
		line(assistant(SidA, '2026-10-13T14:59:52.000Z', [{ type: 'text', text: '応答A1 の本文\n\n| 列1 | 列2 |\n|---|---|\n| a | b |' }])),
		line(assistant(SidA, '2026-10-13T14:59:53.000Z', [{ type: 'tool_use', id: 't1', name: 'Bash', input: { command: 'git status\nSECOND-LINE-MARK', description: 'x' } }])),
		line(toolResult(SidA, '2026-10-13T14:59:54.000Z', 't1', 'TOOL-RESULT-MARK', true)),
		line(assistant(SidA, '2026-10-13T14:59:55.000Z', [{ type: 'tool_use', id: 't2', name: 'Edit', input: { file_path: 'src/a.ts', old_string: 'EDIT-OLD-MARK', new_string: 'EDIT-NEW-MARK' } }])),
		line(toolResult(SidA, '2026-10-13T14:59:56.000Z', 't2', 'ok', false)),
		line(assistant(SidA, '2026-10-13T14:59:57.000Z', [{ type: 'tool_use', id: 't3', name: 'Read', input: { file_path: Home + '\\proj\\read-me.ts', offset: 10, limit: 20 } }])),
		line(toolResult(SidA, '2026-10-13T14:59:58.000Z', 't3', 'READ-CONTENT-MARK', false)),
		line(prompt(SidA, '2026-10-13T15:00:00.000Z', '依頼A2\n' + MaskText)),
		line(assistant(SidA, '2026-10-13T15:00:10.000Z', [{ type: 'text', text: '応答A2 ' + AuthorName + ' さんへ' }])),
		line(base('user', SidA, '2026-10-13T15:20:00.000Z', { message: { role: 'user', content: '<task-notification>NOTIFY-MARK</task-notification>' }, origin: { kind: 'task-notification' }, promptSource: 'system' })),
		line(assistant(SidA, '2026-10-13T15:20:05.000Z', [{ type: 'text', text: '通知への応答' }])),
		line(base('system', SidA, '2026-10-13T15:30:00.000Z', { subtype: 'compact_boundary', content: 'Conversation compacted' })),
		line(base('user', SidA, '2026-10-13T15:30:01.000Z', { message: { role: 'user', content: 'COMPACT-SUMMARY-MARK' }, isCompactSummary: true })),
		line(base('user', SidA, '2026-10-13T15:30:02.000Z', { message: { role: 'user', content: 'META-MARK' }, isMeta: true })),
		line(base('user', SidA, '2026-10-13T15:30:03.000Z', { message: { role: 'user', content: '<command-name>/compact</command-name> LOCAL-COMMAND-MARK' } })),
		line(assistant(SidA, '2026-10-13T15:30:04.000Z', [{ type: 'text', text: 'SIDECHAIN-MARK' }], { isSidechain: true })),
		line({ type: 'future-thing', sessionId: SidA, timestamp: '2026-10-13T15:30:05.000Z', content: 'UNKNOWN-MARK' }),
		'{ これは JSON として読めない行',
		line(prompt(SidA, '2026-10-13T15:40:00.000Z', '依頼A3')),
		line(base('user', SidA, '2026-10-13T15:40:10.000Z', { message: { role: 'user', content: [{ type: 'text', text: '[Request interrupted by user]' }] } })),
	];
}

function sessionB(): string[] {
	const b1 = prompt(SidB, '2026-10-13T15:05:00.000Z', '依頼B1');
	return [
		line(b1),
		// 同じ記録が 2 回入っていても 1 回だけ載せる
		line(b1),
		line(assistant(SidB, '2026-10-13T15:25:00.000Z', [{ type: 'text', text: '応答B1' }])),
		line(prompt(SidB, '2026-10-13T15:45:00.000Z', [
			{ type: 'text', text: '依頼B2 <script>alert(1)</script>' },
			{ type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'IMAGE-DATA-MARK' } },
		])),
	];
}

/** プロジェクトを 1 つ作る。会話ログ ・ git の author ・ 伏せる語のリスト ・ README */
function makeProject(name: string, opts: { words?: boolean } = {}): string {
	const proj = path.join(work, name);
	const jsonl = path.join(proj, 'etc', 'history', 'jsonl');
	fs.mkdirSync(path.join(jsonl, SidA, 'subagents'), { recursive: true });
	fs.writeFileSync(path.join(jsonl, SidA + '.jsonl'), sessionA().join('\n') + '\n', 'utf8');
	fs.writeFileSync(path.join(jsonl, SidB + '.jsonl'), sessionB().join('\n') + '\n', 'utf8');
	// 下のフォルダ（サブエージェント）は読まない
	fs.writeFileSync(path.join(jsonl, SidA, 'subagents', 'agent-1.jsonl'), line(prompt(SidA, '2026-10-13T15:50:00.000Z', 'SUBAGENT-FILE-MARK')) + '\n', 'utf8');
	if (opts.words !== false) {
		fs.writeFileSync(path.join(proj, '_public-ng-words.txt'), '# 伏せる語\nbluebird\n', 'utf8');
	}
	// タイトルバーの概要（.lead）を表題に使う。概要にも伏せ字を掛ける
	fs.writeFileSync(path.join(proj, 'README.html'), '<!DOCTYPE html><title>README</title>\n<div class="titlebar"><div class="inner"><h1>proj</h1>\n<p class="lead">試しの <code>道具</code> の概要。' + AuthorName + ' が作る</p></div></div>\n', 'utf8');
	spawnSync('git', ['init', '-q', proj]);
	spawnSync('git', ['-C', proj, 'config', 'user.name', AuthorName]);
	spawnSync('git', ['-C', proj, 'config', 'user.email', AuthorMail]);
	return proj;
}

function run(args: string[], cwd: string = root, env: Record<string, string> = {}): { code: number, out: string, err: string } {
	const r = spawnSync(process.execPath, [main, ...args], { encoding: 'utf8', cwd, env: { ...process.env, ...Env, ...env }, timeout: 120000 });
	return { code: r.status ?? -1, out: r.stdout ?? '', err: r.stderr ?? '' };
}

/** 出したデータのファイルを、ビューアと同じ形で読む（history2html.index ・ day ・ res を受ける） */
function load(file: string): any {
	let got: any = null;
	if (!fs.existsSync(file)) { return null; }
	const api = {
		index: (o: unknown) => { got = o; },
		day: (d: string, o: unknown) => { got = { d, o }; },
		res: (d: string, o: unknown) => { got = { d, o }; },
	};
	new Function('history2html', fs.readFileSync(file, 'utf8'))(api);
	return got;
}

/** 無いもの（undefined）も空の文字列にして比べられるようにする */
function json(v: unknown): string {
	return JSON.stringify(v) ?? '';
}

/** フォルダの下の全ファイルの中身をつなげる */
function readAll(dir: string): string {
	let s = '';
	if (!fs.existsSync(dir)) { return s; }
	for (const e of fs.readdirSync(dir, { withFileTypes: true, recursive: true })) {
		if (e.isFile()) { s += fs.readFileSync(path.join(e.parentPath, e.name), 'utf8') + '\n'; }
	}
	return s;
}

console.log('');
console.log('=== history2html ===');
fs.rmSync(work, { recursive: true, force: true });
fs.mkdirSync(work, { recursive: true });

// ---- 1. 置き場の既定: カレントのプロジェクトの etc/history/jsonl を読み、notes/91_history に書く ----
const proj = makeProject('proj');
const out = path.join(proj, 'notes', '91_history');
let r = run([], proj);
check('--path を省くとカレントのプロジェクトを読み、終了コード 0', r.code === 0, r.out + r.err);
check('notes/91_history に書く（決めたこと 17）', fs.existsSync(path.join(out, 'index.html')) && fs.existsSync(path.join(out, 'data', 'index.js')));

// ---- 2. 出力の形 ----
const idx = load(path.join(out, 'data', 'index.js'));
check('目次に日が 2 つ（UTC 15:00 は JST の翌日）', idx != null && idx.days.map((d: any) => d.d).join(',') === '2026-10-13,2026-10-14', JSON.stringify(idx?.days?.map((d: any) => d.d)));
check('日の曜日が入る', idx != null && idx.days[0].w === '火' && idx.days[1].w === '水');
// 人の発言は -req.js、応答は -res.js（依頼と応答の対）
const day13 = load(path.join(out, 'data', '2026-10', '2026-10-13-req.js'));
const day14 = load(path.join(out, 'data', '2026-10', '2026-10-14-req.js'));
const res13 = load(path.join(out, 'data', '2026-10', '2026-10-13-res.js'));
const res14 = load(path.join(out, 'data', '2026-10', '2026-10-14-res.js'));
check('日ごとに、人の発言のファイルと応答のファイルが分かれる', day13 != null && day14 != null && res13 != null && res14 != null);
check('時刻は JST の hh:mm:ss', day13?.o[0]?.t === '23:59:50' && day14?.o[0]?.t === '00:00:00', JSON.stringify([day13?.o[0]?.t, day14?.o[0]?.t]));
const day13File = path.join(out, 'data', '2026-10', '2026-10-13-req.js');
const dayText = fs.existsSync(day13File) ? fs.readFileSync(day13File, 'utf8') : '';
check('人の発言のファイルに応答の本文は入らない', dayText.includes('依頼A1') && !dayText.includes('応答A1'));

// ---- 3. 拾うもの ・ 捨てるもの ----
const all = readAll(out);
for (const mark of ['ATTACHMENT-MARK', 'THINKING-MARK', 'SECOND-LINE-MARK', 'TOOL-RESULT-MARK', 'EDIT-OLD-MARK', 'EDIT-NEW-MARK', 'READ-CONTENT-MARK',
	'NOTIFY-MARK', 'COMPACT-SUMMARY-MARK', 'META-MARK', 'LOCAL-COMMAND-MARK', 'SIDECHAIN-MARK', 'UNKNOWN-MARK', 'SUBAGENT-FILE-MARK', 'IMAGE-DATA-MARK']) {
	check('載せない: ' + mark, !all.includes(mark));
}
check('AI の本文は応答のファイルに載る（表の Markdown のまま）', json(res13?.o).includes('応答A1') && json(res13?.o).includes('| 列1 | 列2 |'));

// ---- 4. ツールは名前と 1 行の要約だけ（決めたこと 14-A） ----
const items13: any[] = res13?.o?.[0] ?? [];
const bash = items13.find((x) => x.k === 'u' && x.n === 'Bash');
const edit = items13.find((x) => x.k === 'u' && x.n === 'Edit');
const read = items13.find((x) => x.k === 'u' && x.n === 'Read');
check('Bash はコマンドの 1 行目と「…」', bash?.x === 'git status …', JSON.stringify(bash));
check('失敗した呼び出しに印が付く', bash?.e === 1 && edit?.e === undefined, JSON.stringify([bash, edit]));
check('Edit はパスだけ', edit?.x === 'src/a.ts', JSON.stringify(edit));
check('Read はパスと行の範囲。パスも伏せる', read?.x === '~\\proj\\read-me.ts (10〜29 行)', JSON.stringify(read));

// ---- 5. 伏せる ----
for (const [label, value] of [
	// 4 つの形（\ ・ 重なった \\ ・ / ・ /c/Users/）のどれも残らない。出力は JSON で \ が重なるので、名前そのもので見る
	['自分のユーザー名（パスの中の 4 つの形と、ツールの要約）', User],
	['ほかの人のパス', 'hanako'], ['author の名前', AuthorName], ['author のアドレス', AuthorMail], ['マシン名', Host],
	['メールアドレス', 'someone@'], ['伏せる語（大小を問わない）', 'Bluebird'], ['セッションの URL', 'session_01AbCdEfGh'],
	['鍵の形', 'sk-ant-api03'], ['GitHub の鍵', 'ghp_AbCdEf'], ['password=', 'Abc-12345.xyz!'], ['内部のホスト名', 'build-server.local'], ['プライベートの IP', '192.168.10.20'],
]) {
	check('伏せる: ' + label, !all.includes(value));
}
const a2 = JSON.stringify(day14?.o?.[0]?.x ?? '');
for (const [label, value] of [
	['自分のパスは ~', '~\\\\proj\\\\a.ts'], ['ほかの人は <username>', '<username>'], ['〈個人名〉', '〈個人名〉'], ['〈メールアドレス〉', '〈メールアドレス〉'], ['<hostname>', '<hostname>'],
	['〈伏せ字〉', '〈伏せ字〉'], ['〈セッションURL〉', '〈セッションURL〉'], ['〈認証情報〉', '〈認証情報〉'], ['<IPアドレス>', '<IPアドレス>'],
]) {
	check('置き換え: ' + label, a2.includes(value), a2.slice(0, 600));
}
for (const [label, value] of [['文書用のアドレス', 'user@example.com'], ['ファイル名の .local', 'settings.local.json'], ['版の番号', '10.0.26300.1']]) {
	check('伏せすぎない: ' + label, a2.includes(value), a2.slice(0, 600));
}
check('AI の本文の author も伏せる', json(res14?.o).includes('〈個人名〉') && !json(res14?.o).includes(AuthorName));

// ---- 6. 時間が重なったセッション（決めたこと 20-A） ----
const kinds14 = (day14?.o ?? []).map((x: any) => x.k + ':' + (x.x ?? '').split('\n')[0]).join(' / ');
check('依頼は人の発言の時刻順。通知は前の依頼に混ざらない',
	kinds14 === 'p:依頼A2 / p:依頼B1 / n:通知 / c: / p:依頼A3 / p:依頼B2 <script>alert(1)</script>［画像］', kinds14);
const resText14 = (res14?.o ?? []).map((xs: any[]) => xs.filter((x) => x.k === 'a' || x.k === 'm').map((x) => x.x).join('+')).join(' / ');
check('応答はそれぞれの依頼の下に入る（B1 の応答は A の通知より後でも B1 の下）', resText14.startsWith('応答A2 〈個人名〉 さんへ / 応答B1 / 通知への応答 / '), resText14);
check('中断は、その依頼の応答に印として入る', resText14.includes('中断'), resText14);
check('セッションの題が目次に入る。題が無ければ「セッション N」', idx?.sessions?.map((s: any) => s.n).join(',') === '作業 A の題,セッション 2', JSON.stringify(idx?.sessions));
check('同じ記録は 1 回だけ', (day14?.o ?? []).filter((x: any) => (x.x ?? '').startsWith('依頼B1')).length === 1);
check('左の目盛りの短い線は人の発言ごと（通知は入らない。決めたこと 15-A）', idx?.days?.[1]?.p?.length === 4, JSON.stringify(idx?.days?.[1]?.p));

// ---- 7. ビューアの HTML ----
const htmlFile = path.join(out, 'index.html');
const html = fs.existsSync(htmlFile) ? fs.readFileSync(htmlFile) : Buffer.alloc(0);
const htmlText = html.toString('utf8');
check('index.html は BOM 付き', html[0] === 0xEF && html[1] === 0xBB && html[2] === 0xBF);
check('index.html は html2md の対象にしない（md-skip）', htmlText.includes('<meta name="md-skip">'));
check('README へ戻るリンク', htmlText.includes('href="../../README.html"'));
check('CDN は版を固定し、SRI を付ける', /marked\/\d+\.\d+\.\d+\//.test(htmlText) && /dompurify\/\d+\.\d+\.\d+\//.test(htmlText) && (htmlText.match(/integrity="sha512-/g) ?? []).length === 2);
check('題はプロジェクトのフォルダ名', htmlText.includes('<title>proj'));
check('1 行の概要は README の .lead から取り、タグを外して伏せる（31-A）', htmlText.includes('試しの 道具 の概要。〈個人名〉 が作る') && !htmlText.includes(AuthorName), htmlText.slice(0, 900));
check('データの名前は -req.js と -res.js', fs.existsSync(path.join(out, 'data', '2026-10', '2026-10-14-req.js')) && !fs.existsSync(path.join(out, 'data', '2026-10', '2026-10-14.js')));

// ---- 8. 画面には件数だけを出す ----
check('標準出力に本文を出さない', !r.out.includes('依頼A1') && !r.out.includes('応答A1') && r.out.includes('依頼'), r.out);
check('伏せた後の語を ✅ 付きで並べる（元の値は出さない。34-A）', r.out.includes('✅ 〈個人名〉') && r.out.includes('✅ ~') && r.out.includes('✅ 〈伏せ字〉') && !r.out.includes(AuthorName) && !r.out.includes('Bluebird'), r.out);
check('伏せる仕組みが働いているときは警告しない', !r.out.includes('⚠️'), r.out);

// ---- 8b. 中身が同じファイルは書かない（38-A）。会話が増えても、変わるのは新しい日 ・ 最終日 ・ 目次だけ ----
{
	const files = ['data/2026-10/2026-10-13-req.js', 'data/2026-10/2026-10-13-res.js', 'data/index.js', 'index.html'].map((f) => path.join(out, f));
	const before = files.map((f) => fs.statSync(f).mtimeMs);
	const wait = Date.now() + 1100;
	while (Date.now() < wait) { /* 更新日時の粒度より長く待つ */ }
	const r2 = run([], proj);
	const after = files.map((f) => fs.statSync(f).mtimeMs);
	check('2 回目は、中身が同じファイルの更新日時を変えない', r2.code === 0 && before.every((t, i) => t === after[i]), JSON.stringify([before, after]));
}

// ---- 9. 出し先 ----
fs.mkdirSync(path.join(out, 'data', '2026-01'), { recursive: true });
fs.writeFileSync(path.join(out, 'data', '2026-01', '2026-01-01.js'), '// 古い日', 'utf8');
r = run([], proj);
check('前回の印があれば作り直し、消えた日のファイルを残さない', r.code === 0 && !fs.existsSync(path.join(out, 'data', '2026-01', '2026-01-01.js')), r.out + r.err);
const other = path.join(work, 'other-out');
fs.mkdirSync(other, { recursive: true });
fs.writeFileSync(path.join(other, 'keep.txt'), 'keep', 'utf8');
r = run(['--path', proj, '--out', other]);
check('印の無い空でないフォルダには書かない（終了コード 2）', r.code === 2 && !fs.existsSync(path.join(other, 'index.html')) && fs.existsSync(path.join(other, 'keep.txt')), r.out + r.err);

// ---- 10. 伏せ漏れの検査（2 段目） ----
const proj2 = makeProject('proj-leak');
r = run(['--path', proj2], root, { HISTORY2HTML_TEST_NO_MASK: 'path' });
check('置き換えをすり抜けた値があれば、何も書かずに終了コード 1', r.code === 1 && !fs.existsSync(path.join(proj2, 'notes')), r.out + r.err);
check('どこに何が残ったかは、ファイル名と種類だけを出す', (r.out + r.err).includes('実体パス') && !(r.out + r.err).includes('tester1'), r.out + r.err);

// ---- 11. 伏せる語のリストが無ければ止める ----
const proj3 = makeProject('proj-nowords', { words: false });
r = run(['--path', proj3]);
check('伏せる語のリストが無ければ、何も書かずに終了コード 2', r.code === 2 && !fs.existsSync(path.join(proj3, 'notes')), r.out + r.err);

// ---- 11b. 入力フォルダを指定できる（--in）。相対はカレントから ----
const elsewhere = path.join(work, 'elsewhere-jsonl');
fs.cpSync(path.join(proj, 'etc', 'history', 'jsonl'), elsewhere, { recursive: true });
const proj4 = makeProject('proj-in');
fs.rmSync(path.join(proj4, 'etc'), { recursive: true, force: true });
r = run(['--path', proj4, '--in', path.relative(work, elsewhere)], work);
check('--in で指定したフォルダの会話ログを読む', r.code === 0 && fs.existsSync(path.join(proj4, 'notes', '91_history', 'data', 'index.js')), r.out + r.err);

// ---- 11c. --lead で概要を渡せる ----
r = run(['--path', proj, '--lead', '渡した概要']);
check('--lead で渡した概要を使う', r.code === 0 && fs.readFileSync(path.join(out, 'index.html'), 'utf8').includes('渡した概要'), r.out + r.err);

// ---- 11d. 伏せる仕組みが働いていないときは警告する（書き出しは止めない。34-A） ----
const proj5 = makeProject('proj-empty-words');
fs.writeFileSync(path.join(proj5, '_public-ng-words.txt'), '# 空\n', 'utf8');
fs.rmSync(path.join(proj5, '.git'), { recursive: true, force: true });
// git の外にする。上のフォルダ（このリポジトリ）と、個人 ・ システムの設定の author を拾わないようにする
r = run(['--path', proj5], root, { GIT_CEILING_DIRECTORIES: work, GIT_CONFIG_GLOBAL: path.join(work, 'no-gitconfig'), GIT_CONFIG_NOSYSTEM: '1' });
check('リストが空なら警告し、書き出しは続ける', r.code === 0 && r.out.includes('⚠️') && r.out.includes('伏せる語のリストが空'), r.out + r.err);
check('git の author が取れなければ警告する', r.out.includes('⚠️') && r.out.includes('author'), r.out + r.err);

// ---- 12. 引数 ----
r = run(['--help']);
check('--help は 0 で使い方を出す', r.code === 0 && r.out.includes('--word-list'), r.out);
r = run(['--nonsense']);
check('知らないオプションは 2', r.code === 2);
r = run(['--path', path.join(work, 'nothing-here')]);
check('会話ログのフォルダが無ければ 2', r.code === 2);

fs.rmSync(work, { recursive: true, force: true });
console.log('');
if (fail === 0) {
	console.log('=== ' + pass + ' 件すべて成功 ===');
	process.exit(0);
}
console.log('=== ' + fail + ' 件失敗（成功 ' + pass + ' 件）===');
process.exit(1);
