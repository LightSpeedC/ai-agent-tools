---
schema: 1
id: i260907-02
title: 文字コード対応テキスト・ツール一式（Read/Grep/Edit/Write の代わり）
group: 運用・方針の決定事項
created: 2026-09-07
---

2026-09-07 に ai-chat-lite（#621）から<strong>要望が来た。</strong>Claude Code の Grep は SJIS・UTF-16 を漏らす。**0 件ではなく一部だけが返る**ため欠けに気づけず、一括置換のたびに bat・cmd・reg が取り残される。共通ルールにはいま**手作業の回避策**（bat・cmd を別に探す、`convert-encoding --read` で出して当たる）があるが、探すたびに人が覚えている必要がある形なので**道具にしたい**、という内容。

要望の形（案）。名前・オプションはこちらで決めてよいとのこと。

- `find-text <検索語> -Path <対象> -Recurse` のように渡す。**文字コードはツールが判定する**
- 出力は**パス・行番号・行**（Grep と同じ形）＋**判定した文字コード**
- `-Include *.cmd,*.bat` のような絞り
- 正規表現は将来でよく、まず素の文字列で足りる
- 置き場は `convert-encoding`・`check-markdown`・`check-contrast` と同じ（PATH 通し、ランチャー不要）

決まったら共通ルールの回避策をこの道具に差し替える、と向こうは言っている。

⚠️ **着手** 2026-09-07 に<strong>実装を検討すると返信した。</strong>まず仕様を検討し、**利用者の承認を得てから開発する。**

⚠️ **着手** 利用者との相談で<strong>スコープが広がった。</strong>検索（find-text）だけでなく、**UTF-8 以外で壊れるツール一式の代わり**にする。対象は Read・Grep・Edit・Write の 4 つ（Glob・SendUserFile は壊れないので対象外）。文字コードだけでなく<strong>改行まで含めた「組」</strong>で扱い（SJIS/CRLF・UTF-16LE/CRLF・UTF-8BOM/LF など）、1 エンジン＋4 動詞（`read-text`・`find-text`・`edit-text`・`write-text`）にする。`edit-text` は行範囲＋合言葉（チェックサム）の楽観ロックで、省トークンと競合検知を兼ねる。仕様は[notes/10_plan/](../10_plan/p260907-01-text-tools.md)。

✅ **済** 2026-09-08 に<strong>実装した。</strong>多機能コマンド `text`（`text.exe`）1 本に `read`／`find`／`edit`／`write` を載せ、判定エンジンを共有（`src/Text/`、csc ビルド `build-text.cmd`）。`find` はサクラエディタの grep（ファイル毎）を参考にした ◎/■/◆ 形式、`read` は ◆ ヘッダー＋`行番号 6 桁:タブ`、`edit` は `--digest`（CRC32 8 hex ＝ 行範囲ハッシュ＋サイズ＋更新日時）で競合検知、`--from` は組の指定・中身入力は `--in`／`--old-file`／`--new-file`。**テスト 43 件すべて成功**（`tools/40_test/run-text-tests.ps1`、`run-all-tests` に組み込み）。`--col`・`--regex`・`--all` は将来。

✅ **済** 共通ルールの「ツールごとの文字コードの扱い」は、すでに `text read`／`text find` を使う形に差し替わっている（i260910-03 の6）。ai-chat-lite への周知は別途確認する。
