/*
	html2md の作成日 ・ 更新日の検査（testUpdatedDate）のテスト。

	日本語の「作成: … / 更新: …」と、英語の「Created: … / Updated: …」を認める（i261003-01）。
	英語を主にした資料を並べるプロジェクトがあるため。認めるのはこの 2 つの形だけで、
	日本語と英語の混在や大小の違いは認めない（書き方が揺れないようにする）。
*/
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { testUpdatedDate } from '../../src/html2md/checks.ts';

const here = path.dirname(fileURLToPath(import.meta.url));
const work = path.resolve(here, '..', '..', 'tmp', 'html2md-date-tests');

let pass = 0;
let fail = 0;
function check(name: string, html: string, expected: string): void {
	const p = path.join(work, 'doc.html');
	fs.writeFileSync(p, html);
	const actual = testUpdatedDate(p);
	if (actual === expected) { pass++; console.log('  [OK] ' + name); }
	else { fail++; console.log('  [NG] ' + name + '  期待 ' + JSON.stringify(expected) + ' / 実際 ' + JSON.stringify(actual)); }
}

// 更新日はファイルの更新日より古くないこと（今日にする）
const d = new Date();
const today = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
const notFound = '作成日・更新日の記載が見つかりません';

console.log('');
console.log('=== html2md の作成日 ・ 更新日の検査 ===');
fs.rmSync(work, { recursive: true, force: true });
fs.mkdirSync(work, { recursive: true });

check('日本語の書式を認める', '<p class="date">📅 作成: 2026-01-01 / 更新: ' + today + '</p>', '');
check('英語の書式（Created: / Updated:）を認める', '<p class="date">📅 Created: 2026-01-01 / Updated: ' + today + '</p>', '');
check('英語でも更新日が古ければ警告', '<p class="date">📅 Created: 2026-01-01 / Updated: 2026-01-02</p>',
	'更新日が古い可能性: ヘッダ 2026-01-02 / ファイル更新 ' + today + '（体裁だけの変更ならこのままでよい）');
check('日本語と英語の混在は認めない', '<p class="date">📅 作成: 2026-01-01 / Updated: ' + today + '</p>', notFound);
check('大小の違う英語は認めない', '<p class="date">📅 created: 2026-01-01 / updated: ' + today + '</p>', notFound);
check('記載が無ければ見つからない', '<p>本文</p>', notFound);

fs.rmSync(work, { recursive: true, force: true });
console.log('');
console.log(fail === 0 ? '=== ' + pass + ' 件すべて成功 ===' : '=== ' + fail + ' 件失敗（成功 ' + pass + ' 件）===');
process.exit(fail === 0 ? 0 : 1);
