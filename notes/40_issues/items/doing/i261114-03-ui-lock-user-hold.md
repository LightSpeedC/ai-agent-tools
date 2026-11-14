---
schema: 1
id: i261114-03
title: ui-lock に利用者の画面操作を守る口 (kind=user ・ hold/release ・ 10 分で終了の知らせ) を足す
group: ui-lock
created: 2026-11-14
from: file-manager #1955
confirmed: false
---

fm の課題 i261114-0c (決定 740-A・741-A・742-C)。(1) 持ち主の種類 kind に「利用者」を足し、owner.json と status に出す。(2) コマンドを包まずに取る・放す口 (例 ui-lock hold --kind user --pid <pid> / ui-lock release)。(3) 待つ側に、持ち主が利用者ならそう出す (トーストも「利用者が使用中」)。(4) 持ち主の pid が消えたら放棄として取れる。(5) 待つ間、持ち主が利用者で 10 分を超えたら、持ち主の fm へ「終了」の知らせを送る口。ミューテックスは持つプロセスが要るので、hold が誰に持たせるかを決める。形は利用者と決めてから作る。

## やること
- [済] TS (bun ・ node) と Rust の両方に作る (258-B ・ 259-A ・ 260-A ・ 261-A)
- [未] file-manager に知らせ、確かめてもらう
