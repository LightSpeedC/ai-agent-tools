---
schema: 1
id: i260830-15
title: PlayWright の projects/html2md/ の扱い
group: 運用・方針の決定事項
created: 2026-08-30
---

`N:/PlayWright/projects/html2md/contrast.spec.ts` を作ったが、後から `check-contrast.ps1` が独自の実装（`contrast/check-contrast.cjs`）を持っていることが分かり**重複している**。

削除するか、将来別の検証を書くときの台として残すか。共有環境の規約どおりの使い方ではある。

✅ **済** 2026-09-05 に<strong>フォルダごと削除した。</strong>使っていないものを残さない。

`projects/<自分のフォルダ名>/` は**各プロジェクトが持つ自分専用の領域**で、他プロジェクトのファイルではない。消すのは規約どおり。<strong>一度「共有環境なので触らない」と判断しかけたが、誤りだった。</strong>フォルダ規約は PlayWright の利用方法の文書にある。

消したのは本体 1 件と、出力・作業ファイル 4 件（レポート・実行結果・変換前の JSON）。**git には 1 件も追跡されていなかった。**
