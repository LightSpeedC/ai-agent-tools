---
schema: 1
id: i261109-06
title: decide migrate で、両方を選んでいた決定が片方だけで移された疑いを見つける (--recheck)
group: issue
created: 2026-11-09
---

decide migrate は、同じ番号に別の字が出てくると、いちばん多い字を 1 つだけ選んで移していた。両方を選んでいた決定も片方だけで記録されたおそれがある。移し済みの番号は --dry-run で飛ばされるため見つからない。218-A で、--dry-run --recheck を足し、移し済みの決定について資料に出てくる字を数え直し、chosen と違う字が出てくる番号を一覧にする。直すのは issue decide new --chosen A,B --replaces <id>。
