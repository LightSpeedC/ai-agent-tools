---
schema: 1
id: i261114-02-d1
title: 258: 包まれた子の中の ui-lock run が UI_LOCK_HELD を見たとき
parent: i261114-02
decided: 2026-11-14
chosen: B
---

## 案

- A: pid が owner.json の持ち主と同じで生きていれば素通し
- B: A に加え、その pid が自分の祖先かも確かめる
