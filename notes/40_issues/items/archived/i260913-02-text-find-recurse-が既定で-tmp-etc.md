---
schema: 1
id: i260913-02
title: text find --recurse が既定で tmp ・ etc を舐める
group: 他プロジェクトからの要求
created: 2026-09-13
---

2026-09-13、`ai-agent-rules` から報告（public ルーム #831）。**共通ルール「名前を変えたら全体を検査する」に従って `text find --recurse` を素で撃ったところ、`etc/history/jsonl` のセッションログ（11.8 MB）に当たり、過去の会話が出力に出た。**

> [!CAUTION]
> **共通ルール違反を誘発する。**「.gitignore で除外されたファイルの取り扱い」は「除外されたものは原則として読まない／出力に含めない」としている。<strong>素で撃つと必ずこれを破る。</strong>会話ログには個人名・パスもあり得る。

### 調べた

**報告のとおり。**`dirSet()`（`src/text/find.ts`）は引数が無ければ空の `Set` を返すため、**既定の除外が無い。**`tmp/` に置いた語が `--recurse` で当たることを実測した。このプロジェクトの `etc/` は 58 MB ある。

**ほかの道具とも不揃い。**`check-markdown` ・ `check-contrast` は `tmp` ・ `etc` ・ `node_modules` ・ `.git` を既定で外し、`check-public` は git が追跡しているものだけを見る。**`text find` だけが素通し。**

### 直し方の案

- <strong>A（推し）既定で `tmp` ・ `etc` ・ `node_modules` ・ `.git` を外す。</strong>ほかの 3 つと揃う。解除は `--no-default-exclude` のような明示で受ける
- B `--recurse` のときだけ既定で外す。単一フォルダの指定は素通しのまま
- C 変えない。呼ぶ側が `--exclude-dir` を付ける

<strong>C は採らない。</strong>報告元が書いているとおり「新ルールが `--recurse` を指示しているので、付け忘れる人は増える」。**付け忘れたときに黙って会話ログを読む形は、道具の側が悪い。**

A は後方互換を壊す（`tmp/` を探していた呼び出しが当たらなくなる）。ただし `tmp/` ・ `etc/` を意図して探す場面は少なく、**破る側の害のほうが大きい。**

✅ **済** <strong>記録の是正。</strong>A 案は既に実装・テストとも揃っていた（`src/text/find.ts` の `DefaultExcludeDirs`、`tools/40_test/run-text-tests.ps1` の「既定で外すフォルダ（i260913-02）」節）。記録の更新だけが漏れていたため、実測（テスト62件成功）のうえで済に直す。
