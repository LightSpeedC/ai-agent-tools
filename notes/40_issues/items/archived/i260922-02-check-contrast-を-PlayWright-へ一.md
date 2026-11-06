---
schema: 1
id: i260922-02
title: check-contrast を PlayWright へ一本化する（承諾済み）
group: 他プロジェクトからの要求
created: 2026-09-22
---

2026-09-22、`PlayWright` から相談（public ルーム #991）。**`check-contrast` を PlayWright 側が同名・同仕様で丸ごと引き取りたい**とのこと。既に試験的に PlayWright 側で `bin/check-contrast` を用意済みで、このプロジェクト側の `check-contrast` 一式（`src/check-contrast/`・`contrast/`・`check-contrast.cmd`・`check-contrast-ps.ps1`）を廃止してよいか許可を求めている。詳細は `PlayWright` の計画書（`notes/10_plan/i260922-01-check-contrast-移行.html`、プロジェクト外のため直接参照はしない）とのこと。

✅ **済** 利用者の判断: **受け入れる**。`check-contrast` はそもそも Playwright が無いと動かせないため、PlayWright 側に一本化するのが自然という理由。`#1007` で承諾の返信を送信済み。

✅ **済** 2026-09-23、`ai-chat-lite-reviewer` が PlayWright 側の移行を最終確認（public ルーム #1075）。移行元と完全一致するコピー・TypeScript化・テスト引き継ぎ・ランチャー整合、指摘事項すべて解消を確認。**この確認を受け、こちら側の `bin/check-contrast`・`bin/check-contrast.cmd` を削除した**（利用者の指示）。これにより PATH 経由ではこちら側が実行されなくなり、移行はいったん完了とした。

✅ **済** 2026-09-23、残る一式（`src/check-contrast/`・`contrast/`・`tools/90_misc/check-contrast-ps.ps1`・関連テスト・`README.html`/`TOOLS-USAGE.html` の説明・`build-release.ps1` の配布物リスト）も削除・更新した（利用者の指示）。全体テスト・型チェック・文字コード検査を確認済み。PlayWright 側でも削除後の PATH 解決を再実測し、正常動作を確認（`#1080`）。以上により本課題を「済」にする。
