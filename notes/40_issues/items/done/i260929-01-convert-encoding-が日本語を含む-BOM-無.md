---
schema: 1
id: i260929-01
title: convert-encoding が日本語を含む BOM 無し UTF-8 を判定できない
group: 運用・方針の決定事項
created: 2026-09-29
---

共通ルール「cmd・bat・reg を作る・直す・消す」の修正手順（`--to utf8` → Edit → `--to cmd`）で、**最後の `--to cmd` が「文字コードを判定できません。--from で指定してください」（終了コード 3）で止まる**。`--from utf8` を付ければ通る。`bin/cx.cmd` で踏んだ（2026-09-28）。

**原因。**`src/lib/detector.ts` の `detect()` は、UTF-8 と SJIS の両方で成立し非 ASCII を含むものを `null`（判定しない）にする。半角カナの SJIS（`C2 B1` 等）を UTF-8 と誤認しないためである。ところが UTF-8 の日本語は 3 バイト列（`E3 xx xx` 等）で、SJIS の 2 バイト文字の並びとしても成り立ちやすい。`cx.cmd` を UTF-8 にしたものは、SJIS の構造検査も CP932 の厳密なデコードも通った。**しかも 2 バイト列（`C2`〜`DF` 始まり）を 1 つも含まず、守りたかった場面に当たらない。**

決めること（直し方）:

- A: 両方で成立し、UTF-8 として読んだとき 2 バイト列を含まないなら UTF-8 に決める（半角カナの誤認が起きる形だけを残す）
- B: 両方でデコードし、かな・漢字など日本語として自然な文字の割合が高いほうに決める
- C: 判定は変えず、共通ルールの修正手順の戻しを `--from utf8 --to cmd` にする（暫定。ほかの経路で同じく止まる）

`text` の `detectCombo`（`src/text/engine.ts`）も同じ考え方で、両方で成立すると UTF-8 に倒して `ambiguous` を立て、`edit` ・ `write` は拒否する。

<strong>B で進める（2026-09-29）。</strong>計画は [i260929-01 文字コード判定の改善](../10_plan/i260929-01-文字コード判定.md)。

<strong>対応（2026-09-29）。</strong>両方で成立するときは、読んだ文字が「よく使う文字」かの割合（`Nu` ・ `Ns`）で見分けるようにした。`src/lib/detector.ts` の `decideAmbiguous` を convert-encoding と `text` の両方が使う。C# 版（`ConvertEncodingCs` ・ `TextCs`）も揃えた。

- テストを先に書き、落ちるのを見てから直した（convert-encoding 32〜37 ・ 57〜61、`text` 2 件）。`text` の既存テストで両方妥当の例に使っていた `C2 B1` は SJIS に決まるようになったため、止まる例（`C2 B1 E3 82 A2`）に差し替えた
- 全テストが bun ・ node とも通る。C# 版でも判定のケースは通る（残る失敗は以前からのずれ。i260929-02 ）
- 判定できずに検査を素通りしていた `tests/cases/` の HTML 4 件が BOM 無しと分かり、BOM を付けた
