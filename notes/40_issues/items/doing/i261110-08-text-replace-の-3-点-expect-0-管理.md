---
schema: 1
id: i261110-08
title: text replace の 3 点 (--expect 0、管理外の置き場、ファイル名の置き換え)
group: text
created: 2026-11-10
from: file-manager
confirmed: false
---

file-manager の #1911。課題の番号の振り直し (10 種類・131 件) で手間取った 3 点。

## やること

- [済] 1: --expect 0 で一致が 0 件なら終了コード 0 にした (試験を先に足し ❌Red を見てから直した。text-replace 38 件 bun ・ node とも ✅)
- [未] 2: --path を root にすると、Rust の target など .gitignore で外したものまで読む。既定で外すか、外すオプションを足すか (選択が要る)
- [未] 3: 番号がファイル名にも入っていた。名前も置き換えるオプション (git の管理下なら git mv) を足すか (選択が要る)
