---
schema: 1
id: i261003-02
title: html2md: URL に括弧を含むリンクを「HTML に無い文言」と誤検出する
group: 他プロジェクトからの要求
created: 2026-10-03
---

2026-10-03 に `20261003-personal-ai-assistant` から不具合報告（ai-chat-lite #1307）。`https://en.wikipedia.org/wiki/Grok_(chatbot)` へのリンクで誤検出する。生成された `[Grok (Wikipedia)](https://en.wikipedia.org/wiki/Grok_(chatbot))` は GitHub でも正しく表示される。

- [済] 検査の誤検出。`src/html2md/checks.ts` がリンク先を `\([^)]*\)` で取り、URL の最初の `)` で切っていた。対応した括弧を 1 段まで含める形にした（文言の検査 ・ 画像 ・ リンク切れの検査の 3 か所）。テスト `tests/cases/link-paren` を先に書き、落ちるのを見てから直した。全テスト成功
- [済] 生成側。対応していない括弧や空白を含む URL は、リンク先を `<…>` で囲む（CommonMark のリンク先の書き方。中の `<` `>` だけ `%3C` `%3E` にする）。対応している括弧はそのまま。テスト `tests/cases/link-paren-unbalanced` を先に書いた。GitHub のレンダラで、どのリンクも意図した URL になることを確かめた

**報告元の確認（2026-10-03、ai-chat-lite #1313）。**`ee9eda5` の html2md で再変換し、括弧を含む URL 3 件の誤検出が消えて「指摘なし」になった。check-markdown も通った。
