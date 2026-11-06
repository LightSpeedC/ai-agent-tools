---
schema: 1
id: i261018-01
title: Git の同期を壊さずに行う共有ツールを作る（ai-agent-rules の p261018-01）
group: 他プロジェクトからの要求
created: 2026-10-18
---

2026-10-18 に `ai-agent-rules` から依頼（ai-chat-lite #1530）。複数のセッション・PC・クラウドから書き換えられるリポジトリ（Obsidian Vault・共通ルール）を、壊さずに GitHub と同期する。名前・引数・ロックの持ち方・期限・終了コードなどの決め事は、こちらに任せるとのこと。

- 同じ clone で同時に呼ばれても、commit → pull --rebase → push の一続きが重ならない（排他のロック）。取れないときは 3 秒おきに 9 秒まで取り直し、だめなら飛ばす。残ったロックで止まり続けない
- 変更をすべて載せる呼び方と、名指しのパスだけを載せる呼び方（名指し以外の commit 前の変更は残したまま同期できる）
- ほかの clone の push を取り込んでから送る。ぶつかったら止めて報告し、手元の commit と変更を消さない
- Windows ・ Linux ・ Mac ・ クラウド（sh のみ）で動く。git の呼び出しは timeout 付き。日時は JST。出力は短く
- reset --hard ・ stash ・ checkout -- は使わない。git の設定は書き換えない
- テストは、裸のリポジトリと clone 2 つで、先に書く。名前が決まったら依頼元へ教える

決めること: 名前、引数、ロックの持ち方、期限、終了コード。仕様を決めるものなので、計画を出して利用者の判断を待つ。計画は [safe-push 計画](../10_plan/i261018-01-safe-push.md)。<strong>決めたこと（2026-10-18、利用者の判断）。</strong>名前は `safe-push`。決める点（41 〜 54）は、計画のとおりにすべて決まった。**計画を承認（2026-10-18、利用者の判断）。**

- [済] テストを先に書き（`run-safe-push-tests.ts`）、落ちるのを見てから実装した（❌Red → ✅Green。85 件。bun ・ node とも）
- [済] 実装（`src/safe-push/main.ts` ・ `bin/safe-push` ・ `bin/safe-push.cmd`）。**動かしたのは Windows だけ**。Linux ・ Mac ・ クラウドの sh は未確認
- [済] TOOLS-USAGE（第 14 章）に使い方を書き、README の一覧に足した。計画書に結果と、計画から変えた点を書いた
- [済] 依頼元へ、実装した旨と使い方を返信し、確認を依頼した（ai-chat-lite #1535）
- [済] 報告元の確認（2026-10-25）。**共通ルール側**（#1537）: `safe-push <リポジトリ> common-rules.md rules` で、手元の未 push の commit 3 件が送られ、終了コード 0、origin が手元と一致した。**Vault 側**（ai-obsidian-vault、#1646）: Stop フックから呼ばれた `safe-push <Vault> --all` で、10/20 〜 10/25 に 45 回 commit ・ push されている。10/25 09:17 に手で実行したときも、終了コード 0、「同期しました (commit 1 ・ push 済)」で、origin と一致した。**両方が OK**
