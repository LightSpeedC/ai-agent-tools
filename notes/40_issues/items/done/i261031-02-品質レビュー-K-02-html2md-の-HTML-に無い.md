---
schema: 1
id: i261031-02
title: 品質レビュー K-02: html2md の「HTML に無い文言」が、callout の中の表の区切り行を指摘する
group: 運用・方針の決定事項
created: 2026-10-31
---

2026-10-31 の HTML 品質レビューの指摘。`notes/10_plan/i260917-01-less.html` が、`html2md` の実行で「HTML に無い文言 1 件 (163 行目: `> |---|---|---|`)」と指摘されていた。

<strong>原因。</strong>callout の中の表は、Markdown では引用の中に出て、区切り行が `> |---|---|---|` の形になる。区切り行を読み飛ばす判定が、行頭の `>` を考えていなかった (`src/html2md/checks.ts` の `testExtraText`)。区切り行は記法そのものなので、直し方は 1 つ。

- [済] テストを先に書き、落ちるのを見てから直した (`tools/40_test/run-html2md-extra-tests.ts`。❌Red 2 件 → ✅Green 3 件。bun ・ node とも)。引用の中でも、本物の付け足しの文言は指摘することも固定した
- [済] 修正は 1 行 (区切り行の判定の前に、行頭の引用記号を外す)
- [済] `html2md --root . --extra TOOLS-USAGE.html` の指摘が 0 件になった (警告は更新日の 25 件で、体裁だけの変更なのでこのまま)
