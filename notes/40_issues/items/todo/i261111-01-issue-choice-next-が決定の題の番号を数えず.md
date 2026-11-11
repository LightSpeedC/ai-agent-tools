---
schema: 1
id: i261111-01
title: issue choice next が決定の題の番号を数えず、使った番号を返す (244-A)
group: issue
created: 2026-11-11
---

振り返り r261111-01 の候補 244。issue choice next が、decide new の題 (NNN: で始まる) に書いた番号を使った番号として数えないので、11/10 に手で付けて使った 234〜238 を返した。直す: 決定の題と本文の番号も数える。あわせて、応答の NNN-A の番号が予約に無ければ知らせる Stop フックを、ai-agent-rules に依頼する。
