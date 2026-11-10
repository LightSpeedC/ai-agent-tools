---
schema: 1
id: i261110-09
title: issue render --all が _issues-archive.html を作り直さない
group: issue
created: 2026-11-10
---

file-manager の #1916 (ai-agent-rules 宛て) で分かった。issue render --all は、保管も含めて _issues.html 1 枚に出すだけで、_issues-archive.html は作り直さない。_issues-archive.html を作り直すのは、archive の操作のあとの autoRender (withArchive) だけ (src/issue/main.ts の runRender と autoRender)。--all を「全部作り直す」と受け取って、保管の一覧が古いまま残った。利用者が改善を求めた。直し方は選択が要る (240)。

## やること
- [済] 240-A: --out ・ id ・ --group を渡さない render は、_issues-archive.html も作り直す (中身が同じなら書かない)。試験を先に足し ❌Red 4 件を見てから直した。issue の試験 4 本が bun ・ node とも ✅。TOOLS-USAGE と使い方の表示を直した
