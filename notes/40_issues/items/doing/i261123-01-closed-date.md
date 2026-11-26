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

- 287-D: 「済にした日」のキーは `closed` に一本化し、`done` は作らない (i261120-01 の枝で足した `done` は `closed` に改名)。値は日時 `yyyy-mm-dd hh:mm` (JST) で、日付だけ (`yyyy-mm-dd`) の既存値も有効のまま受ける。依頼の趣旨 (済へ移したときに自動で書く・戻したら消す・list / search で参照する) は、`closed` で満たした。(先に出た 287-A の「done に一本化」は、利用者の見直しで 287-D に置き換わった)
- 288-A: 取り込みは枝の側で衝突を解く。develop の `closed` の実装 (KeyOrder・setState・list / search の表示・check の検査) と、枝の日時の実装 (started ・ stats ・ backfill ・ archive) を `closed` の 1 つにまとめた。
- 依頼元 (file-manager) には、値が日付だけでなく時刻 (hh:mm) も入ることを伝え、確認を取る。確認が取れるまで済にしない。
