// PreToolUse フック: src/ を Edit・Write する前に、試験 (tools/40_test/ か tests/) を変えていなければ知らせる。止めない。
// 課題 i261111-04 (247-A)。決定 266-A (このプロジェクトの .claude/settings.json に置く) ・ 267-A (「変えた」は git status の差分で見る)。
// 242 で共通の部品を先に直し、text replace も計画書を書かずに作った。共通ルール「テストを先に書く」を、直す前に思い出させる。
// 体裁・コメント・資料だけの直しには知らせが出るが、止めないので害はノイズだけ。
// 入力が壊れていても、git の外でも、黙って通す (フックの不具合で編集を止め続けないため)。
// node でも bun でも動くよう、標準モジュールだけで書く。
import { execFileSync } from 'node:child_process';

const Message =
	'src/ を直す前に、試験 (tools/40_test/ か tests/) を先に変えていません (共通ルール「テストを先に書く」)。'
	+ '不具合の修正・機能の追加なら、先に落ちる試験を書き、❌Red を見てから src/ を直してください。'
	+ '体裁・コメント・資料だけの直しなら、このまま進めてかまいません。(課題 i261111-04。知らせるだけで、止めません)';

// Windows は大小を区別しないため、区切りと大小を揃えて比べる
function key(p: string): string {
	return p.replace(/\\/g, '/').toLowerCase();
}

function git(cwd: string, args: string[]): string | null {
	try {
		return execFileSync('git', args, { cwd, encoding: 'utf8', timeout: 10000, windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] });
	} catch {
		return null;
	}
}

/** git status の変更 (新しいファイルも含む) のパスを、リポジトリの根からの相対で返す。-z は、名前を引用符で囲まず、改名は 2 つのパスになる */
function changedPaths(top: string): string[] | null {
	const out = git(top, ['-c', 'core.quotepath=false', 'status', '--porcelain=v1', '-z', '--untracked-files=all']);
	if (out === null) return null;
	const tokens = out.split('\0').filter((t) => t !== '');
	const paths: string[] = [];
	for (let i = 0; i < tokens.length; i++) {
		const entry = tokens[i];
		paths.push(key(entry.slice(3)));
		// 改名・複写は、次の 1 つが元のパス (状態の 2 文字は付かない)
		if (/^[RC]/.test(entry) || /^.[RC]/.test(entry)) {
			i++;
			if (i < tokens.length) paths.push(key(tokens[i]));
		}
	}
	return paths;
}

async function main(): Promise<void> {
	let text = '';
	for await (const chunk of process.stdin) text += chunk;
	let data: { tool_name?: string; tool_input?: { file_path?: unknown }; cwd?: unknown };
	try {
		data = JSON.parse(text);
	} catch {
		return;
	}
	if (data.tool_name !== 'Edit' && data.tool_name !== 'Write') return;
	const file = data.tool_input?.file_path;
	const cwd = data.cwd;
	if (typeof file !== 'string' || typeof cwd !== 'string' || file === '' || cwd === '') return;

	const topRaw = git(cwd, ['rev-parse', '--show-toplevel']);
	if (topRaw === null) return;
	const top = key(topRaw.trim()).replace(/\/+$/, '');
	const f = key(file);
	if (!f.startsWith(top + '/')) return; // 置き場の外
	if (!f.slice(top.length + 1).startsWith('src/')) return; // src/ の下だけ (src2/ のような別のフォルダは対象外)

	const changed = changedPaths(topRaw.trim());
	if (changed === null) return;
	if (changed.some((p) => p.startsWith('tools/40_test/') || p.startsWith('tests/'))) return;

	console.log(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', additionalContext: Message } }));
}

await main();
