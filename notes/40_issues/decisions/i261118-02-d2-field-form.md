---
schema: 1
id: i261118-02-d2
title: version と kind の値の検査
parent: i261118-02
decided: 2026-11-18
chosen: A
legacy_ids: :ai-agent-tools:275
---

## 案

- A: issue check で形が違えば警告にする。set は書く
- B: set も形が違えば終了コード 5 で止め、check はエラーにする
