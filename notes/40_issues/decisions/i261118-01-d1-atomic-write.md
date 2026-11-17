---
schema: 1
id: i261118-01-d1
title: 書き込みの原子化の範囲と方法
parent: i261118-01
decided: 2026-11-18
chosen: A
legacy_ids: :ai-agent-tools:273
---

## 案

- A: 共通の writeAtomic (一時ファイル + 置き換え) を、既にあるファイルを書き直す 7 か所 (set ・ confirm ・ todo ・ decide set ・ render ・ uuid) で使う
- B: A に加えて課題ごとの錠 (ロックファイル) で、読んでから書くまでを 1 つずつにする
