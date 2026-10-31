/*
	run-all-tests.ps1 の -Online の試験 (i260910-03、68-A)。

	-Online を付けたときだけ、check-markdown ・ check-contrast を一括実行に含める。
	既定は含めない (check-markdown は GitHub の API を使い、認証なしは 60 回/時)。

	中身は実行しない。-List は、走らせる試験の一覧を出して終わる。
	API もブラウザも使わない。

	bun でも node でも走る。
*/

import { spawnSync } from 'node:child_process';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const launcher = path.join(here, 'run-all-tests.ps1');

let pass = 0;
let fail = 0;

function check(name: string, cond: boolean, detail: string): void {
	if (cond) { pass++; console.log('  [OK] ' + name); }
	else { fail++; console.log('  [NG] ' + name + '  ' + detail.slice(0, 160).replace(/\r?\n/g, ' / ')); }
}

function list(extra: string[]): { code: number; out: string } {
	const r = spawnSync('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', launcher, '-List', ...extra], { encoding: 'utf8', timeout: 60000 });
	return { code: r.status ?? -1, out: (r.stdout ?? '') + (r.stderr ?? '') };
}

console.log('');
console.log('=== run-all-tests -Online の試験 ===');
console.log('');

// 既定。API を使う試験は含めない
let r = list([]);
check('-List は 0 で終わる', r.code === 0, r.out);
check('既定の一覧に html2md が入る', r.out.includes('html2md'), r.out);
check('既定では check-markdown を含まない', !r.out.includes('check-markdown'), r.out);
check('既定では check-contrast を含まない', !r.out.includes('check-contrast'), r.out);

// -Online
r = list(['-Online']);
check('-Online でも 0 で終わる', r.code === 0, r.out);
check('-Online で check-markdown を含む', r.out.includes('check-markdown'), r.out);
check('-Online で check-contrast を含む', r.out.includes('check-contrast'), r.out);

console.log('');
if (fail === 0) {
	console.log('=== ' + pass + ' 件すべて成功 ===');
	process.exit(0);
}
console.log('=== ' + fail + ' 件失敗 (成功 ' + pass + ' 件) ===');
process.exit(1);
