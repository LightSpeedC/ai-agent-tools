---
schema: 1
id: i261111-06
title: decide migrate で、答え待ち ・ 仮に決めた決定も、その状態で移したい
group: issue
created: 2026-11-11
from: file-manager
confirmed: true
refs: i261111-01
---

file-manager の #1920。いまは資料の 674-A のような番号を拾うと、全部「決めた」として移すので、答え待ちの案まで決定として残る (fm の下見で 674〜680 の 7 件)。決定に「答え待ち」「仮に決めた」の状態を持たせ、その状態で移し、あとで issue decide で「決めた」に変える形がほしい。あわせて、移した後の issue choice next が、移した決定の最大の番号の続きを出すかを確かめたい (fm は 680 まで使い、予約は 656〜659 だけ)。後半は i261111-01 (choice next が決定の題の番号を数えない) と同じ根。決定の状態を持たせるかは、仕様を決める必要がある。

## やること
- [済] 249-A を作った: 決定に status (決めた ・ 仮に決めた ・ 答え待ち)、decide new --status、decide set、migrate の --pending ・ --provisional、render の印。choice next は決定の題の番号も数える (244-A)。試験を先に書き ❌Red を見てから作った (決定の状態 17 件 ・ decide migrate 63 件 ・ numbers 45 件、bun ・ node とも ✅)。資料: 仕様 ・ TOOLS-USAGE
- [済] file-manager に知らせ、確認をもらってから済にする
- [済] 2026-11-11 09:58、#1929 で file-manager から (1) は確認済み (--dry-run で名指しどおりの状態)。(2) 移した後の choice next が 681 を出すかは、fm の移行の後に確かめて返す
- [済] 2026-11-11 10:00、#1931 で (2) も確認済み (fm で 698 件を移し、choice next は 681)
