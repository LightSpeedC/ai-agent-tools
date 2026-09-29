# ai-agent-tools

HTML と Markdown、文字コード、公開前の検査。プロジェクトを問わず使う道具の置き場。

> 📅 作成: 2026-08-27 / 更新: 2026-09-29

[^^](../)

AI エージェントと人が、どのプロジェクトでも同じ手順で使う道具を 1 か所に集めたもの。**ドキュメントは HTML で書いて Markdown を生成する**、**ファイルは種類ごとに決まった文字コードと改行で置く**、**公開する前に機械で確かめる**、といった共通ルールの取り決めを、その場の判断に任せず道具で守れるようにする。

道具は `bin/` にあり、`bin/` は PATH に入っているので、どのプロジェクトからも名前だけで呼べる。**使い方は [TOOLS-USAGE](TOOLS-USAGE.md) にある。**

## 道具

| 道具 | 何のためにあるか |
|---|---|
| `html2md` | HTML を正として、GitHub で読むための Markdown を生成する。生成したあとにリンク ・ アンカー ・ 文言の食い違いを検査する |
| `check-markdown` | 生成した Markdown が GitHub 上で意図どおりに表示されるかを、GitHub のレンダラに投げて実物で確かめる |
| `check-public` | public のリポジトリに出す前に、個人名 ・ 実体パス ・ 認証情報などが混ざっていないかを機械で止める |
| `convert-encoding` | ファイルを種類ごとに決まった文字コードと改行へ、判断の余地なく変換する。判定できなければ書き換えない |
| `text` | SJIS ・ UTF-16 のファイルも壊さずに読む ・ 探す ・ 書き換える（Read ・ Grep ・ Edit ・ Write の代わり） |
| `psh` | PowerShell を呼び、出力を UTF-8 に直して流す |
| `less` | UTF-8 の出力を、化けずにページングして読む（`more` の代わり） |
| `psls` | プロセスを親子のツリーで一覧し、キーワードで絞り込む |

`bin/` にはほかに、このリポジトリの持ち主が使う起動用の cmd（`cc` ・ `cx` ・ `w` など）も置いている。

## フォルダの構成

| フォルダ | 中身 |
|---|---|
| `bin/` | 道具の入口。PATH に入れるのはここだけ |
| `src/` | 道具の本体。TypeScript（bun を優先し、無ければ node で動く）。`psh-rs/` は psh の Rust 版、`〜Cs/` は C# 版（突き合わせ用） |
| `tests/` | テストの入力と期待値 |
| `tools/` | ビルド（`20_build`）・テスト（`40_test`）・測定（`90_misc`） |
| `notes/` | このリポジトリを管理する資料（下の各章） |

## 目次

1. [調査](#1-調査)
2. [計画と仕様](#2-計画と仕様)
3. [課題](#3-課題)
4. [ルールと手順](#4-ルールと手順)

## 1. 調査

| 資料 | 内容 |
|---|---|
| [レビュー #649 全文](notes/01_research/i260908-04-review649.md) | html2md 全体のレビュー（2026-09-08）の原資料 |
| [html2md の処理系比較](tools/90_misc/bench-html2md/処理系比較-html2md.html) | 実際の HTML → Markdown 変換で、C# の exe と TypeScript 版の時間とメモリを測った |
| [check-public の処理系比較](tools/90_misc/bench-check-public/処理系比較-check-public.html) | 同じ検査を 6 つの処理系で書き、速さ ・ 事前の段 ・ 行数を測った |

処理系比較の 2 つは、測るための手順と一緒に `tools/90_misc/` に置いている。

## 2. 計画と仕様

| 資料 | 内容 |
|---|---|
| [html2md ツール共通化計画](notes/10_plan/html2md-plan.md) | 各プロジェクトに散在した変換スクリプトを 1 本にまとめるまでの段取りと、生成後の検査 |
| [html2md タグ対応仕様](notes/10_plan/html2md-tag-spec.md) | どのタグをどう変換するか。実測した結果と、まだ決まっていない論点 |
| [convert-encoding 仕様書](notes/10_plan/p260906-01-convert-encoding.md) | 文字コードの判定 ・ 変換の手順 ・ 終了コード ・ テストケース |
| [text ツール仕様書](notes/10_plan/p260907-01-text-tools.md) | read ・ find ・ edit ・ write の仕様。合言葉（digest）・組の判定 ・ 出力の形 |
| [SJIS ファイルの扱い方](notes/10_plan/p260908-01-sjis-file-handling.md) | cmd ・ bat を壊さず、差分を見ながら作成 ・ 修正 ・ 削除する手順の比較 |
| [check-public 計画](notes/10_plan/p260912-01-check-public.md) | public のリポジトリに出す前に、出してはいけないものが混ざっていないかを機械で止める |
| [bun への移植](notes/10_plan/p260912-02-bun移植.md) | C# の 3 本（convert-encoding ・ text ・ html2md）を TypeScript に移し、bun で走らせる |
| [less 計画](notes/10_plan/i260917-01-less.md) | UTF-8 の出力を DOS の `more` で受けると化ける問題を、UTF-8 で読めるページャーで解決する |
| [psls 計画](notes/10_plan/p260921-01-プロセス一覧.md) | プロセス一覧を、キーワードで絞り込みながら親子のツリーで表示する CLI ツール |
| [文字コード判定の改善 計画](notes/10_plan/i260929-01-文字コード判定.md) | UTF-8 と SJIS のどちらとも取れるバイト列を、読んだ結果の自然さで見分ける |
| [psh の Rust 化 計画](notes/10_plan/p260929-01-psh-rust.md) | psh を Rust の単体の exe にする。守る仕様 ・ 置き場 ・ テスト ・ 前後の比較 |

## 3. 課題

これから解決することは [課題](notes/40_issues/issues.html) に集めている。

## 4. ルールと手順

| 資料 | 内容 |
|---|---|
| [ローカルルール](notes/90_rules/local-rules.md) | このプロジェクトでだけ通る決めごと。共通ルールとの差と、踏んだ落とし穴 |
| [HTML クラス名の取り決め](notes/90_rules/html-class-rules.md) | html2md が読むクラス名。バッジ ・ callout ・ 表 ・ 図の書き方 |
| [開発の手順](notes/90_rules/development.md) | ツールを直すときに回すテスト、期待値の作り直し、ビルド |

[^^](../)
