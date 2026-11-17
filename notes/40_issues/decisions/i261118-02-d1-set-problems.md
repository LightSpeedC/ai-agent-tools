---
schema: 1
id: i261118-02-d1
title: 形の誤りのあるファイルへの set の扱い
parent: i261118-02
decided: 2026-11-18
chosen: A
legacy_ids: :ai-agent-tools:274
---

## 案

- A: 今のまま書き、形の誤りが残っていれば標準エラーに issue check を案内する
- B: 形の誤りがあれば、書かずに終了コード 1 で止める
