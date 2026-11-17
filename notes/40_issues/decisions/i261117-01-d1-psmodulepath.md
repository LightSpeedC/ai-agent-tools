---
schema: 1
id: i261117-01-d1
title: psh が 5.1 を呼ぶ前の PSModulePath の戻し方
parent: i261117-01
decided: 2026-11-17
chosen: A
legacy_ids: :ai-agent-tools:268
---

## 案

- A: 5.1 を呼ぶ前に、子へ渡す環境から PSModulePath を外す (5.1 が Machine と User から自分で組み立てる。--pwsh では外さない)
- B: レジストリの Machine と User を読み、展開して並べて渡す
- C: 混ざった値から 7 の置き場だけを除く (暫定)
