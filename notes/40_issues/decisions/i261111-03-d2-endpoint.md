---
schema: 1
id: i261111-03-d2
title: check-markdown の送らない口の形
parent: i261111-03
decided: 2026-11-15
chosen: A
---

## 案

- A: 環境変数 CHECK_MARKDOWN_ENDPOINT で送り先を差し替える (ローカルだけ許し、トークンは付けない)
- B: 環境変数 CHECK_MARKDOWN_NO_SEND=1 で、送らずに件数を出して終わる
