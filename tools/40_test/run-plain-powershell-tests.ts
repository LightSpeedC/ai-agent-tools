/*
	ps1 の試験 (html2md ・ text ・ convert-encoding) を、素の Windows PowerShell 5.1 でも psh でも流して、全件が通ること (課題 i261119-01)。
	夜 1 時のタスクは素の powershell で流す。psh は窓の出力エンコーディングを UTF-8 にするので、psh で通っても、素では落ちた
	(試験が子の出力を窓のエンコーディング = CP932 で読み、UTF-8 の日本語を化けさせていた)。
	素は、bun の入口 (既定) と node の入口 (runners/*-node.cmd) の両方、psh は既定の入口で見る。
*/
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..', '..');

let pass = 0;
let fail = 0;
function check(name: string, ok: boolean, detail: string = ''): void {
	if (ok) { pass++; console.log('  ✅ [OK] ' + name); }
	else { fail++; console.log('  ❌ [NG] ' + name + (detail ? '  ' + detail : '')); }
}

type Result = { code: number; out: string };

function plain(script: string, args: string[]): Result {
	// 素の Windows PowerShell 5.1 を子として起こし、窓の出力エンコーディングを CP932 (日本語の Windows の既定) にして流す。
	// bun の試験が先に窓のコードページを UTF-8 に書き換えて残すことがあり (夜の全件)、それだと素の状態を再現できない。
	// 終わったら、窓のエンコーディングを元に戻す (窓に残すと、隣のプロセスを化けさせる)
	const quote = (s: string): string => "'" + s.replace(/'/g, "''") + "'";
	const call = '& ' + quote(path.join(here, script)) + ' ' + args.map((a) => (a.startsWith('-') ? a : quote(a))).join(' ');   // -Target はパラメータ名として渡す
	const command = '$old = [Console]::OutputEncoding; try { [Console]::OutputEncoding = [System.Text.Encoding]::GetEncoding(932); ' + call + ' } finally { [Console]::OutputEncoding = $old }; exit $LASTEXITCODE';
	const r = spawnSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', command], { cwd: root, encoding: 'utf8', timeout: 600000 });
	return { code: r.status ?? -1, out: (r.stdout ?? '') + (r.stderr ?? '') };
}

function viaPsh(script: string): Result {
	// psh は psh.cmd。node は .cmd を直接起動できないので、shell 経由で呼ぶ (パスは " で囲む)
	const r = spawnSync('psh', ['"' + path.join(here, script) + '"'], { cwd: root, encoding: 'utf8', timeout: 600000, shell: true });
	return { code: r.status ?? -1, out: (r.stdout ?? '') + (r.stderr ?? '') };
}

/** 失敗の手掛かり: [NG] の行 (先頭 5 つ) */
function ngLines(out: string): string {
	return out.split('\n').filter((l) => l.includes('[NG]')).slice(0, 5).join(' / ');
}

/**
 * 成功の判定は終了コード 0 (3 本とも、1 件でも落ちれば 1 を返す)。出力の文言は見ない:
 * 素の PowerShell では、試験自身の Write-Host が CP932 で出ることがあり (窓の側のエンコーディング)、日本語の「すべて成功」は UTF-8 として読めない。
 * 出力が空でないことだけ、合わせて見る (起動できずに 0 を返す取り違えを避ける)
 */
const AllPassed = /\S/;

const suites = [
	{ name: 'html2md', script: 'run-tests.ps1', node: 'html2md-node.cmd' },
	{ name: 'text', script: 'run-text-tests.ps1', node: 'text-node.cmd' },
	{ name: 'convert-encoding', script: 'run-convert-encoding-tests.ps1', node: 'convert-encoding-node.cmd' },
];

if (process.platform !== 'win32') {
	console.log('  (Windows 以外なので飛ばした)');
} else {
	for (const s of suites) {
		console.log(`--- ${s.name}`);
		const a = plain(s.script, []);
		check(`${s.name}: 素の PowerShell + 既定の入口で、全件が成功し、終了コード 0`, a.code === 0 && AllPassed.test(a.out), `code=${a.code} ${ngLines(a.out)}`);
		const nodeEntry = path.join(here, 'runners', s.node);
		if (fs.existsSync(nodeEntry)) {
			const b = plain(s.script, ['-Target', nodeEntry]);
			check(`${s.name}: 素の PowerShell + node の入口 (runners/${s.node}) で、全件が成功し、終了コード 0`, b.code === 0 && AllPassed.test(b.out), `code=${b.code} ${ngLines(b.out)}`);
		} else {
			check(`${s.name}: node の入口 (runners/${s.node}) がある`, false, nodeEntry);
		}
		const c = viaPsh(s.script);
		check(`${s.name}: psh でも、全件が成功し、終了コード 0`, c.code === 0 && AllPassed.test(c.out), `code=${c.code} ${ngLines(c.out)}`);
	}
}

// 共有の部品 (invoke-utf8.ps1) の単体: .ps1 ・ .cmd ・ exe を起動でき、UTF-8 の日本語を化けずに読み、終了コードを返す (レビュー指摘 2)
if (process.platform === 'win32') {
	console.log('--- invoke-utf8.ps1 (Invoke-Utf8Lines)');
	const dir = path.join(root, 'tmp', 'invoke-utf8-tests');
	fs.rmSync(dir, { recursive: true, force: true });
	fs.mkdirSync(dir, { recursive: true });
	// 子の出力は、窓のエンコーディングによらず UTF-8 のバイトで書く。日本語は文字コードで作る (ps1 に BOM が無くても読める)
	fs.writeFileSync(path.join(dir, 'child.ps1'), '$o = [Console]::OpenStandardOutput(); $b = [Text.Encoding]::UTF8.GetBytes([string][char]0x65E5 + [string][char]0x672C + "`n" + "second`n"); $o.Write($b, 0, $b.Length); exit 3\n');
	fs.writeFileSync(path.join(dir, 'args.ps1'), 'foreach ($a in $args) { [Console]::Out.WriteLine("<" + $a + ">") }\n');
	fs.writeFileSync(path.join(dir, 'child.cmd'), '@echo off\r\necho cmd-%~1\r\nexit /b 4\r\n');
	const helper = path.join(here, 'invoke-utf8.ps1').replace(/'/g, "''");
	const script = `. '${helper}'; ` +
		`$a = @(Invoke-Utf8Lines '${path.join(dir, 'child.ps1').replace(/'/g, "''")}'); $ca = $LASTEXITCODE; ` +
		`$b = @(Invoke-Utf8Lines '${path.join(dir, 'child.cmd').replace(/'/g, "''")}' 'x y'); $cb = $LASTEXITCODE; ` +
		`Write-Output ('ps1=' + ($a.Count) + ',' + (($a[0].ToCharArray() | ForEach-Object { [int]$_ }) -join ':') + ',' + $a[1] + ',' + $ca); ` +
		`Write-Output ('cmd=' + $b.Count + ',' + $b[0] + ',' + $cb); ` +
		// 1 字の - で始まる引数 (-mx ・ -h ・ -f) が、部品の引数の名前に取り違えられず、そのまま子に届く。配列で渡す形と、空の文字列
		`$c = @(Invoke-Utf8Lines '${path.join(dir, 'args.ps1').replace(/'/g, "''")}' @('-mx', '-h', '-f', '--read', '', 'a b') -MergeStderr); ` +
		`Write-Output ('args=' + ($c -join '|'))`;
	const r = spawnSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', '$old = [Console]::OutputEncoding; try { [Console]::OutputEncoding = [System.Text.Encoding]::GetEncoding(932); ' + script + ' } finally { [Console]::OutputEncoding = $old }'], { cwd: root, encoding: 'utf8', timeout: 120000 });
	const out = (r.stdout ?? '') + (r.stderr ?? '');
	check('.ps1 の子: UTF-8 の日本語 (日本 = 26085:26412) を化けずに読み、2 行で、終了コード 3', out.includes('ps1=2,26085:26412,second,3'), out);
	check('.cmd の子: 空白を含む引数を 1 つとして渡し、終了コード 4', out.includes('cmd=1,cmd-x y,4'), out);
	check('- 1 字で始まる引数 (-mx ・ -h ・ -f) と空の文字列が、そのまま子に届く', out.includes('args=<-mx>|<-h>|<-f>|<--read>|<>|<a b>'), out);
	fs.rmSync(dir, { recursive: true, force: true });
}

console.log('');
console.log(`=== ps1 の試験 (素の PowerShell ・ psh): ${pass} 件成功 ・ ${fail} 件失敗 ===`);
process.exit(fail === 0 ? 0 : 1);
