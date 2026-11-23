---
schema: 1
id: i261123-01
title: issue: done 移動時に closed: YYYY-MM-DD を自動付与し、list / search で参照できるようにする
group: issue
created: 2026-11-23
from: file-manager
confirmed: false
refs: i261120-01
---

file-manager からの依頼。&#10;- issue コマンドで課題を done へ移動したとき、frontmatter に closed: YYYY-MM-DD（当日の日付）を自動付与する。&#10;- todo / doing に戻したときは closed: を削除する。&#10;- 一覧表示 (list) や検索 (search) でも closed を参照できるようにする。&#10;&#10;## やること&#10;- [未] meta.ts / check.ts に closed キーを追加（KeyOrder、日付形式・整合性検査）&#10;- [未] ops.ts の setState で done 移動時に closed を付与、todo/doing 戻り時に削除&#10;- [未] ops.ts / main.ts の list / search で closed を参照・出力できるようにする&#10;- [未] テストを追加して全件パスを確認
