---
schema: 1
id: i261111-07
title: issue new --refs が chat の発言の番号 (#1923) を受け付けない
group: issue
created: 2026-11-11
from: ai-agent-rules
confirmed: false
---

ai-agent-rules の #1924。chat の依頼から課題を立てるとき、依頼の発言の番号を refs に入れたいが、--refs が「番号をカンマで区切る」で止まる。受ける形 (#1923 だけか、ルームを付けた形か) は決める必要がある。

今ある動き: `--refs` は課題 ・ 計画 ・ 調査の番号 (`p261103-01`) と `プロジェクト名:番号` だけを受け、形が違えば終了コード 5 (試験 `run-issue-ops-tests` の「--refs の形が違えば終了コード 5」)。`issue check` は refs の形が違えばエラー (value)、参照先が無ければ警告 (refs) (`run-issue-tests` の value-refs ・ refs-missing ・ refs-issue ・ refs-plan ・ refs-other-project)。`issue render` は refs の課題をリンクにし、ほかの番号は文字のまま出す (`run-issue-render-tests` の meta-info)。

決定: 262-A (`--refs` が `#1923` も受ける。ルーム付きは受けない)。`#` と 1 以上の数字だけ。`check` は形だけ見て参照先を探さず、`render` はリンクにしない。

## やること
- [済] 試験を先に足す (ops ・ check ・ render。ops と check の受け入れ側が ❌Red を確認)
- [済] `ops.ts` ・ `check.ts` を直す。使い方の文・仕様・TOOLS-USAGE を更新
- [未] ai-agent-rules に知らせ、確かめてもらう (確かめたら返信してほしい: `issue new --title x --group <g> --refs "i261111-03,#1923"` が通り、`refs: i261111-03, #1923` と書かれる)
