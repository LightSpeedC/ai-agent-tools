---
schema: 1
id: i261111-08
title: psls に機械が読める出力 (JSON) を足す
group: psls
created: 2026-11-11
from: ai-agent-rules
confirmed: false
---

ai-agent-rules の #1934。i261111-06 (向こうの番号) のフックで、プロセスの親子を取るのに psls を使えず、Get-CimInstance Win32_Process で代わりにした。ProcessId ・ ParentProcessId ・ Name ・ CommandLine を機械が読める形 (JSON 等) で出してほしい。オプション名と形は決める必要がある。
