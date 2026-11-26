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

file-manager からの依頼。
- issue コマンドで課題を done へ移動したとき、frontmatter に closed: YYYY-MM-DD（当日の日付）を自動付与する。
- todo / doing に戻したときは closed: を削除する。
- 一覧表示 (list) や検索 (search) でも closed を参照できるようにする。

## やること
- [未] meta.ts / check.ts に closed キーを追加（KeyOrder、日付形式・整合性検査）
- [未] ops.ts の setState で done 移動時に closed を付与、todo/doing 戻り時に削除
- [未] ops.ts / main.ts の list / search で closed を参照・出力できるようにする
- [未] テストを追加して全件パスを確認

## 決定の記録 (2026-11-26)

- 287-A: 「済にした日」は `done` に一本化する (i261120-01)。`closed` のキーは持たない。依頼の趣旨 (done へ移したときに日付を自動で書く・戻したら消す・list / search で参照する) は、`done` (JST の `yyyy-mm-dd hh:mm`) で満たした。
- 288-A: 取り込みは枝の側で衝突を解いた。develop の `closed` の実装 (KeyOrder・setState・list / search の表示・check の検査) は、`done` の実装に寄せた。
- 依頼元 (file-manager) には、キー名が `closed` でなく `done` になり、日付だけでなく時刻 (hh:mm) も入ることを伝え、確認を取る。確認が取れるまで済にしない。
