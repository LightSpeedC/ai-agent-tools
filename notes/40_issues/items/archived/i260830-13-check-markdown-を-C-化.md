---
schema: 1
id: i260830-13
title: check-markdown を C# 化
group: 共通化の残り段階
created: 2026-08-30
---

html2md は C# 化したが、`check-markdown.ps1` は PowerShell のまま。C# 化すると `ConvertTo-Json` の UTF-8 バイト列の扱いなど ps1 固有の注意が不要になる。

C# 化したら CLAUDE.md の「生成した Markdown は GitHub のレンダラで検証する」の記述も更新する。

✅ **済** 2026-09-05 に<strong>やらないと決めて閉じた。</strong>ps1 のまま動いており、UTF-8 バイト列の扱いは既に片付いている。C# 化しても得るものが無い。
