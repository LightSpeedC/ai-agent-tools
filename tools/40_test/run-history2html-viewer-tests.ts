/*
	history2html のビューアのテスト（ブラウザ）。計画 p261014-01 の第 6 章。

	ここでは材料を作るだけで、ブラウザでの確かめは PlayWright 共有環境で回す
	（共通ルール「PlayWright テストの実行」。自分のプロジェクトには入れない）。

	  1. 40 日 ・ 2 セッションの会話ログを合成する（遅れて読む ・ 目盛りを確かめられる量）
	  2. history2html で書き出す
	  3. playwright-test で tests/history2html-viewer/ を回す（file:// のまま開く。決めたこと 13-A）

	PlayWright 共有環境が無い（クラウド等）ときは ⬜ 未実施として終わる。**黙って成功にはしない。**
	Markdown の表は CDN の marked で描くので、ネットに出られないと落ちる。
*/
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..', '..');
const work = path.join(root, 'tmp', 'history2html-viewer-tests');
const proj = path.join(work, 'proj');
const out = path.join(proj, 'notes', '91_history');
const main = path.join(root, 'src', 'history2html', 'main.ts');

console.log('');
console.log('=== history2html のビューア ===');
fs.rmSync(work, { recursive: true, force: true });
const jsonl = path.join(proj, 'etc', 'history', 'jsonl');
fs.mkdirSync(jsonl, { recursive: true });
fs.writeFileSync(path.join(proj, '_public-ng-words.txt'), '# 伏せる語\n', 'utf8');

// ---- 1. 材料 ----
let uuid = 0;
function rec(type: string, sid: string, ts: Date, extra: Record<string, unknown>): string {
	uuid++;
	return JSON.stringify({ type, uuid: 'v-' + uuid, sessionId: sid, timestamp: ts.toISOString(), isSidechain: false, ...extra });
}
const prompt = (sid: string, ts: Date, text: string) => rec('user', sid, ts, { message: { role: 'user', content: text }, origin: { kind: 'human' } });
const answer = (sid: string, ts: Date, text: string) => rec('assistant', sid, ts, { message: { role: 'assistant', content: [{ type: 'text', text }] } });
const tool = (sid: string, ts: Date, id: string, command: string) => rec('assistant', sid, ts, { message: { role: 'assistant', content: [{ type: 'tool_use', id, name: 'Bash', input: { command } }] } });

const Table = '結果は次のとおり。\n\n| 項目 | 値 |\n|---|---|\n| 件数 | 3 |\n| 状態 | 済 |';
// 生の HTML は効かせず、文字のまま出す（スクリプトを動かさない）
const Xss = '<script>window.__xss=1</script><img src=x onerror="window.__xss=2">';

const a: string[] = [JSON.stringify({ type: 'custom-title', customTitle: 'セッション A の題', sessionId: 'va' })];
const b: string[] = [];
const start = Date.UTC(2026, 8, 1, 0, 0, 0); // 2026-09-01 09:00 JST
for (let d = 0; d < 40; d++) {
	for (let n = 0; n < 5; n++) {
		const sid = n % 2 === 0 ? 'va' : 'vb';
		const lines = sid === 'va' ? a : b;
		const t = new Date(start + d * 86400000 + n * 3600000);
		const last = d === 39 && n === 4;
		lines.push(prompt(sid, t, '依頼 ' + (d + 1) + '-' + (n + 1) + (last ? ' ' + Xss : '')));
		lines.push(answer(sid, new Date(t.getTime() + 5000), n === 0 ? Table : last ? '応答 ' + Xss : '応答 ' + (d + 1) + '-' + (n + 1)));
		lines.push(tool(sid, new Date(t.getTime() + 6000), 't' + uuid, 'git status'));
	}
}
fs.writeFileSync(path.join(jsonl, 'va.jsonl'), a.join('\n') + '\n', 'utf8');
fs.writeFileSync(path.join(jsonl, 'vb.jsonl'), b.join('\n') + '\n', 'utf8');
fs.writeFileSync(path.join(proj, 'README.html'), '<!DOCTYPE html><title>README</title>\n<p class="lead">ビューアの試しの概要</p>\n', 'utf8');

// ---- 2. 書き出す ----
// 環境から取る値は差し替える。パスは分けて組み立てる（続けて書くと、このソース自体が公開前の検査に当たる）
const env = { ...process.env, HISTORY2HTML_USERNAME: 'tester1', HISTORY2HTML_HOME: 'C:' + '\\Users\\tester1', HISTORY2HTML_HOSTNAME: 'HOST-TEST-01' };
const g = spawnSync(process.execPath, [main, '--path', proj], { encoding: 'utf8', env });
if (g.status !== 0) {
	console.log('  ❌ [NG] 材料を書き出せませんでした  ' + (g.stdout ?? '') + (g.stderr ?? ''));
	process.exit(1);
}

// ---- 3. ブラウザで確かめる ----
const shell = process.platform === 'win32';
const probe = spawnSync(shell ? 'where' : 'which', ['playwright-test'], { encoding: 'utf8' });
if (probe.status !== 0) {
	console.log('  ⬜ [未実施] playwright-test が見つかりません（PlayWright 共有環境が無い）');
	fs.rmSync(work, { recursive: true, force: true });
	process.exit(0);
}
const r = spawnSync('playwright-test', ['--test-dir', path.join(root, 'tests', 'history2html-viewer'), '--out-dir', path.join(work, 'pw')], {
	encoding: 'utf8',
	shell,
	env: { ...env, HISTORY2HTML_VIEWER_DIR: out },
	timeout: 600000,
});
const text = (r.stdout ?? '') + (r.stderr ?? '');
// 合否の行だけを出す（PlayWright の出力は長い）
for (const l of text.split('\n')) {
	if (/passed|failed|flaky|skipped|✘|Error|expect\(/.test(l)) { console.log('  ' + l.trim()); }
}
if (r.status === 0) {
	console.log('  ✅ ビューアのテストはすべて成功');
	fs.rmSync(work, { recursive: true, force: true });
	process.exit(0);
}
console.log('  ❌ ビューアのテストに失敗があります（レポートは tmp/history2html-viewer-tests/pw）');
process.exit(1);
