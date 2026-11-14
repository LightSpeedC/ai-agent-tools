---
schema: 1
id: i261114-02
title: ui-lock run が子に取っている印 (UI_LOCK_HELD) を渡し、包まれた中の ui-lock は待たずに通す
group: ui-lock
created: 2026-11-14
from: file-manager #1953
confirmed: true
---

包んだ子の中で別の道具が同じロックを取りに行くと、子が待って固まる。fm は owner.json の pid が祖先かを見て避けている。依頼の形: ui-lock run が子に UI_LOCK_HELD=<ui-lock の pid> を渡す。中の ui-lock run がそれを見たときの動き (素通し・祖先の確かめ方) は決める。

## やること
- [済] TS (bun ・ node) と Rust の両方に作る (258-B ・ 259-A ・ 260-A ・ 261-A)
- [済] file-manager に知らせ、確かめてもらう
