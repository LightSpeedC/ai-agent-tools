# text の .gitignore と --rename 計画 (ai-agent-tools)

`text find` ・ `text replace` が .gitignore で外したものを読まないようにし、`text replace --rename` でファイル名も置き換えられるようにする。課題 i261110-08 (file-manager の #1911)。

> 📅 作成: 2026-11-10 / 更新: 2026-11-10

[^^](../../README.md)

**対象 ・ 入力 ・ 出力**: 対象は、このプロジェクトの `src/text/` (`find.ts` ・ `replace.ts` ・ `main.ts`) と試験 (`run-text-replace-tests.ts` ・ text の試験)、TOOLS-USAGE。入力は、`--path` の下のファイルと git の管理の情報。出力は、書き換えたファイルの中身と名前。

## 目次

1. [決めたこと](#1-決めたこと)
2. [今ある動きと試験](#2-今ある動きと試験)
3. [進め方](#3-進め方)

## 1. 決めたこと

2026-11-10 に、利用者が選んだ。決定のファイルは `i261110-08-d1` ・ `d2`。

| 番号 | 問い | 選んだ案 |
|---|---|---|
| 238-A | .gitignore で外したもの (Rust の target 等) を読むか | git の管理下では、既定で読まない。find ・ replace の両方。選ばなかった案: 外すオプションを足す |
| 239-A | ファイル名も置き換えるか | `--rename` を足す。git の管理下なら `git mv`。選ばなかった案: 足さない |

## 2. 今ある動きと試験

今ある動き: 直したあとも、次の動きを保つ。どれも `run-text-replace-tests.ts` と text の試験で見る。

- find と replace は、同じ `selectTargets` でファイルを選ぶ (`--path` ・ 第 2 位置引数 ・ `-r` ・ `--include` ・ `--exclude` ・ `--exclude-dir`)
- 既定で外すフォルダは `tmp` ・ `etc` ・ `node_modules` ・ `.git` と、`_` で始まるもの。`--no-default-exclude` で既定を外す
- replace は全部のファイルを組み立ててから書く。0 件 (終了コード 1。`--expect 0` なら 0) ・ 表せない文字 (5) ・ `--expect` と違う (6) なら、どのファイルも書き換えない
- 文字コード ・ BOM ・ 改行を保つ。`--dry-run` は書き換えない

## 3. 進め方

どの手順も、試験を先に書き、❌Red を見てから作る。bun と node の両方で流す。

### 1. .gitignore で外したものを読まない (238-A)

1. `--path` が git の管理下なら、最初に `git ls-files -o -i --exclude-standard --directory` を 1 回だけ流し、外されたフォルダとファイルを受け取る
2. walk は、そのフォルダに入らず、そのファイルを拾わない。target のような大きいフォルダも中を読まない
3. git の管理下でない ・ git が無いときは、今の動きのまま
4. `--no-default-exclude` を渡したら、これも外さない
5. 外した件数を「.gitignore で外した N 件」と 1 行出す
6. 試験: 一時フォルダで `git init` し、`.gitignore` に `target/` を書く。find ・ replace が target の中を見ないこと、`--no-default-exclude` なら見ること、git の外では今のままであること

### 2. --rename でファイル名も置き換える (239-A)

1. 中身と同じ検索語 ・ `--regex` ・ `-i` で、ファイルの名前 (フォルダ名は含めない) も置き換える
2. 名前の変わった数を、合計と `--expect` に数える。`--dry-run` は古い名前と新しい名前を並べて出す
3. 書く前にすべて調べ、次のどれかがあれば、何も書き換えずに終了コード 7 で止める: 新しい名前のファイルが既にある ・ 2 つのファイルが同じ名前になる ・ 名前に使えない文字が入る
4. 中身を書き終えてから名前を変える。git の管理下のファイルは `git mv`、管理外は `fs.renameSync`
5. 試験: 名前だけ ・ 中身だけ ・ 両方が一致する場合、ぶつかって止まる場合、git mv で変えたことが `git status` に出る場合、`--dry-run` では何も変えない場合

### 3. 仕上げ

1. TOOLS-USAGE と使い方の表示を直す
2. text の試験を bun と node で全件流す
3. 課題 i261110-08 に結果を書き、file-manager に知らせて確認を頼む

[^^](../../README.md)
