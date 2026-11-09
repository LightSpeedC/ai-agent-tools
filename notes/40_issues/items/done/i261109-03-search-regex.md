---
schema: 1
id: i261109-03
title: issue search で正規表現 (A|B|C 等) を使えるようにする (--regex)
group: issue
created: 2026-11-09
---

issue search は語の部分一致だけで、A|B|C のような OR や正規表現が使えない。213-A で、--regex を付けたときだけ正規表現として探す (大小は区別しない。既定は今の部分一致のまま)。壊れた式は終了コード 5。課題と決定の両方に効かせる。
