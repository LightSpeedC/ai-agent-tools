# ai-agent-tools の開発の手順

ツールを直すときに回すテスト、期待値の作り直し、ビルド。使い方は [TOOLS-USAGE](../../TOOLS-USAGE.md) を見る。

> 📅 作成: 2026-09-29 / 更新: 2026-09-30

[^^](../../README.md) ／ [ローカルルール](local-rules.md)

## 目次

1. [テスト](#1-テスト)
2. [期待値（golden）の作り直し](#2-期待値goldenの作り直し)
3. [ビルド](#3-ビルド)

## 1. テスト

<strong>直したら全件を回す。</strong>個別のテストだけを通して先に進まない。

```shell
psh tools/40_test/run-all-tests.ps1
```

ダブルクリックなら `tools/40_test/run-all-tests.cmd`。1 本でも落ちれば終了コード 1 を返す。最後に `convert-encoding --check` でリポジトリ全体の文字コードと改行も見る。

### 何をどの処理系で回すか

| テスト | 回し方 |
|---|---|
| ps1 で書いたもの（html2md ・ convert-encoding ・ text） | 入口（`bin/`）を通して 1 回。bun があれば、`tools/40_test/runners/` の node 用の当て木を `-Target` に渡してもう 1 回 |
| ts で書いたもの | 入っている処理系（bun ・ node）すべてで回す |
| psh の Rust 版 | ビルドしてあれば、`PSH_TARGET` に exe を渡して、bun と node の両方から呼ぶ。ビルドしていなければ「飛ばした」と表示する |
| HTML のルール | `check-html-rules.ts`。このリポジトリの HTML が共通ルール（戻るリンク ・ 目次 ・ 日付 ・ README からのリンク等）に沿っているか |
| 型チェック | `tsc --noEmit`。bun も node も型を見ないため、ここでしか食い違いが出ない |

> [!IMPORTANT]
> <strong>優先するランチャーがあると、もう一方は 1 ケースも通らない。</strong>入口は bun を優先するので、bun のある環境では node で回らない。node でも動くことは、当て木で別に確かめている（ローカルルール「優先するランチャーがあると、もう一方は 1 ケースも通らない」）。

### 別の実装に当てる

テストは既定で入口（`bin/`）を試す。別の実装を試すときは名指しする。

```shell
# psh の Rust 版に当てる
PSH_TARGET="$(pwd -W)/src/psh-rs/target/release/psh.exe" node tools/40_test/run-psh-tests.ts
```

## 2. 期待値（golden）の作り直し

html2md のテスト（`tools/40_test/run-tests.ps1`）は、変換した結果が `tests/golden/` に置いた期待値と**完全に一致すること**を見る。出力そのものだけでなく、終了コードと検査の指摘（★ の行）も固定している。

出力を変える修正を入れたときは、**差分を目で確かめてから**作り直す。

```shell
psh tools/40_test/run-tests.ps1 -UpdateGolden              # すべて
psh tools/40_test/run-tests.ps1 -Case anchor-badge -UpdateGolden  # 1 ケースだけ
```

> [!WARNING]
> <strong>確かめずに作り直すと、担保が無くなる。</strong>期待値は実装の出力から作られるので、実装が何を出しても通る。新しいケースは、期待値を手で書いてから実装する（共通ルール「テストを先に書く」）。

## 3. ビルド

<strong>TypeScript 版はビルドが要らない。</strong>bun ・ node がソースをそのまま走らせる。ビルドが要るのは次のものだけで、入口は `tools/20_build/` にある。

| 作るもの | 入口 | 出力先 |
|---|---|---|
| psh の Rust 版 | `build-psh-rs.cmd` | `src/psh-rs/target/release/psh.exe` |

**入口の名前はツール名と処理系で付ける**（`build-<ツール>-<処理系>.cmd`）。どれを作る入口か、名前で分かる。exe はどれも git に含めない。

### Rust 版

`cargo` が要る。psh の入口（`bin/psh.cmd` ・ `bin/psh`）は、exe があればそれを使い、無ければ TypeScript 版に落ちる。

[^^](../../README.md)
