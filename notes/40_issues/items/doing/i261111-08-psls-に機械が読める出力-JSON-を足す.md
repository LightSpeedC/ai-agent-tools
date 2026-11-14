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

今ある動き: psls は全プロセスをツリーで出し、キーワードで絞り込み (一致行は太字 ・ 緑、祖先も残す)、`-f` で exe をフルパスにし、`--no-trim` で切り詰めず、同名別パスは `*1` ・ `*2` と対応表で区別する。取れない項目は `-` (コマンド行は `(-)`)。試験 `run-psls-tests` の各行の形式 ・ 絞り込み ・ 太字 ・ `--full-path` ・ メモリ欄 ・ `--no-trim` ・ VT モードで守る。`--json` を足しても、これらは変えない。

決定: i261111-08-d1 (263-A フラットな配列、ツリー表示と同じ順) ・ i261111-08-d2 (264-A 起動時刻は JST の ISO 8601)。オプションは `--json` (issue など他の道具と同じ)。キーは `pid` ・ `ppid` ・ `name` ・ `exe` ・ `creation` ・ `cmdline` ・ `memBytes`。取れない値は `null`。

## やること
- [済] 試験を先に足す (❌Red を確認。--json の 10 件が落ち、既存の 21 件は成功)
- [済] `--json` を実装し、使い方の文 ・ TOOLS-USAGE を更新
- [未] ai-agent-rules に知らせ、確かめてもらう (確かめたら返信してほしい: `psls --json <キーワード>` で、親子を取りたいプロセスの `pid` ・ `ppid` ・ `name` ・ `cmdline` が読めること)
