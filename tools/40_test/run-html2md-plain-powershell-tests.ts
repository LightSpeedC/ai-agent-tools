/*
	html2md の golden 試験 (run-tests.ps1) を、素の Windows PowerShell 5.1 で流しても通ること (課題 i261119-01)。
	夜 1 時のタスクは素の powershell で流す。psh は窓の出力エンコーディングを UTF-8 にするので、psh で通っても、素では落ちた
	(run-tests.ps1 が子の出力を窓のエンコーディング = CP932 で読み、日本語の ★ の行を拾えなかった)。
	bun の入口 (既定) と node の入口 (runners/html2md-node.cmd) の両方で、全ケースが通ることを見る。
*/
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..', '..');
const script = path.join(here, 'run-tests.ps1');

let pass = 0;
let fail = 0;
function check(name: string, ok: boolean, detail: string = ''): void {
	if (ok) { pass++; console.log('  ✅ [OK] ' + name); }
	else { fail++; console.log('  ❌ [NG] ' + name + (detail ? '  ' + detail : '')); }
}

function plain(args: string[]): { code: number; out: string } {
	// psh ではなく、素の Windows PowerShell 5.1 を子として起こす (窓のコードページは既定のまま)
	const r = spawnSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script, ...args], { cwd: root, encoding: 'utf8', timeout: 600000 });
	return { code: r.status ?? -1, out: (r.stdout ?? '') + (r.stderr ?? '') };
}

console.log('--- 素の PowerShell で run-tests.ps1 を流す');
if (process.platform !== 'win32') {
	console.log('  (Windows 以外なので飛ばした)');
} else {
	const a = plain([]);
	check('既定 (bun 優先の入口) で、全ケースが成功し、終了コード 0', a.code === 0 && /ケースすべて成功/.test(a.out), a.out.split('\n').filter((l) => l.includes('[NG]')).slice(0, 5).join(' / '));
	const nodeEntry = path.join(here, 'runners', 'html2md-node.cmd');
	if (fs.existsSync(nodeEntry)) {
		const b = plain(['-Target', nodeEntry]);
		check('node の入口 (runners/html2md-node.cmd) でも、全ケースが成功し、終了コード 0', b.code === 0 && /ケースすべて成功/.test(b.out), b.out.split('\n').filter((l) => l.includes('[NG]')).slice(0, 5).join(' / '));
	} else {
		check('node の入口 (runners/html2md-node.cmd) がある', false, nodeEntry);
	}
}

console.log('');
console.log(`=== html2md (素の PowerShell): ${pass} 件成功 ・ ${fail} 件失敗 ===`);
process.exit(fail === 0 ? 0 : 1);
