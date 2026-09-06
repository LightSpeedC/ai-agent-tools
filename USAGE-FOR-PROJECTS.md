# html2md を他のプロジェクトから使う

HTML から Markdown を生成し、双方を検証する。自プロジェクトには何もインストールしない。

> 📅 作成: 2026-09-04 / 更新: 2026-09-06

[← html2md](README.md) ／ [タグ対応仕様](notes/10_plan/html2md-tag-spec.md) ／ [クラス名の取り決め](notes/90_rules/html-class-rules.md)

## 目次

1. [4 つのコマンド](#1-4-つのコマンド)
2. [html2md で変換する](#2-html2md-で変換する)
3. [検証する](#3-検証する)
4. [文字コードと改行を直す](#4-文字コードと改行を直す)
5. [つまずきやすいところ](#5-つまずきやすいところ)

## 1. 4 つのコマンド

<strong>このフォルダは PATH に入っている。パスを書かずに名前だけで呼べる。</strong>自プロジェクトに何かをインストールする必要はなく、ランチャーを置く必要もない。

| コマンド | 何をするか |
|---|---|
| `html2md` | HTML から Markdown を生成し、そのまま検査する |
| `check-markdown` | 生成した Markdown が **GitHub 上で意図どおりに表示されるか**を実測する |
| `check-contrast` | HTML の文字色と背景色が **読める組み合わせか**をブラウザで実測する |
| `convert-encoding` | ファイルの文字コードと改行を、**ファイルの種類ごとに決められた形へ**変換する |

どちらの検証ツールも<strong>推測せず実物で判定する。</strong>前者は GitHub のレンダラに投げ、後者はブラウザで描画して計測する。ローカルの理屈と実物の表示は一致しないことがある。

> [!IMPORTANT]
> `html2md-ps` という名前でも呼べるが、これは**参照実装の PowerShell 版**で、通常は使わない。**exe の 65 倍遅い**（実測 228 ms 対 14.9 秒）。exe の挙動を読んで確かめたいときと、`csc.exe` が使えない環境のために残している。

## 2. html2md で変換する

### 基本

プロジェクトのフォルダで実行する。**既定では root の `README.html` と `notes/` 配下を変換する。**

```powershell
html2md --root .
html2md --root . --dir docs --dir notes
html2md --root . --dry-run
```

| オプション | 既定 | 内容 |
|---|---|---|
| `--root <パス>` | カレントフォルダ | 対象のプロジェクトフォルダ |
| `--dir <名前>` | `notes` | 探索するフォルダ。複数回指定できる |
| `--exclude <名前>` | `index.html` | 変換しないファイル名。複数回指定できる |
| `--extra <名前>` | — | ルート直下の追加ファイル。複数回指定できる |
| `--no-readme` | — | ルート直下の `README.html` を対象から外す |
| `--dry-run` | — | 書き出さず、変換結果と検査結果だけを表示する |
| `--help` | — | 説明を表示する |

終了コードは `0`＝指摘なし、`1`＝指摘あり、`2`＝引数や対象の誤り。

> [!WARNING]
> <strong>`docs/` を持つプロジェクトは `--dir docs` を忘れない。</strong>付けずに実行すると `docs/` が変換されないまま、そこへのリンクだけが残る。`docs/` の HTML へのリンクは `.html` のまま出るので壊れはしないが、Markdown 側から `docs/` の内容に到達できなくなる。

### ルート直下の README 以外を変換する

ルート直下は `README.html` だけを見る。**ほかのファイルは `--extra` で名指しする。**

```powershell
html2md --root . --extra USAGE-FOR-PROJECTS.html
```

この文書自身もこの形で生成している。名指しにしているのは、**作業用に置いた HTML まで拾わないため。**

### HTML の書き方

変換に使うクラス名は[クラス名の取り決め](notes/90_rules/html-class-rules.md)に合わせる。<strong>プロジェクトごとに違う名前を使わない。</strong>どのタグがどう変換されるかは[タグ対応仕様](notes/10_plan/html2md-tag-spec.md)にある。

**リンクは常に `.html` と書く。**`.md` への置き換えは html2md が行う。HTML 側で先取りして `.md` と書くと、HTML のリンクが壊れたまま Markdown 側だけ正しくなり、気づきにくい。

### 変換対象から外す

外し方は 3 通り。**何を外したいかで選ぶ。**

| 外すもの | 書き方 |
|---|---|
| ページ全体 | `head` に `<meta name="md-skip">` を置く |
| 要素だけ | その要素に `class="md-skip"` を付ける |
| ファイル名で | `--exclude <名前>` を渡す |

ページ全体を外すのは、変換すると構造が失われるものに使う。`details` で畳んだ課題一覧が該当する。Markdown に `details` の記法が無いため、畳みが解けて見出しも消える。

外したページへのリンクは、<strong>拡張子を置き換えず `.html` のまま残る。</strong>除外の判定は html2md が行うので、書き手は常に `.html` と書けばよい。

> [!NOTE]
> GitHub はリポジトリ内の `.html` をレンダリングせず<strong>ソース表示にする。</strong>畳みは効かないが、中身には到達できる。

## 3. 検証する

### Markdown が GitHub で崩れていないか

```powershell
check-markdown -Path . -Recurse
```

Markdown を GitHub のレンダラに投げ、返る HTML に `**` が記号のまま残っていないかを見る。**日本語では `**` が強調にならないことがある**（前後の文字で開閉が決まる）。html2md は該当箇所を `<strong>` に置き換えるが、実物で確かめるのはこちら。

認証なしは 60 回/時。`-Token` を渡すと 5000 回/時になる。

### HTML の色が読める組み合わせか

```powershell
check-contrast -Path . -Recurse
```

ブラウザで実際に描画し、前景色と実効背景色の比を計算する。<strong>1.5:1 未満を 0 件にする。</strong>検出したいのは「白に白」「黒に黒」「色の継承事故」で、値を上げると誤検出に埋もれる。

ブラウザは PlayWright 共有環境を借りる。**自プロジェクトに Playwright を入れる必要はない。**

## 4. 文字コードと改行を直す

Windows で扱うファイルは種類ごとに求められる形式が違う。**用途名を渡せば、文字コードと改行の組み合わせを覚えなくて済む。**

```powershell
convert-encoding tools/80_ops/foo.ps1 --to ps1
convert-encoding tools/80_ops/foo.cmd --to cmd
convert-encoding notes/memo.html      --to html
```

### 用途名

| 用途名 | 文字コード | 改行 |
|---|---|---|
| `ps1` | UTF-8 BOM 付き | CRLF |
| `cmd` `bat` | SJIS（CP932） | CRLF |
| `reg` | UTF-16 LE ＋ BOM | CRLF |
| `html` | UTF-8 BOM 付き | LF |

### 文字コード名でも書ける

用途名の代わりに `utf8` `utf8bom` `sjis` `utf16le` `utf16be` を渡せる。`/` の後ろに `lf` か `crlf` を足すと改行も指定できる。

```powershell
convert-encoding foo.txt --to sjis        # 文字コードだけ変える
convert-encoding foo.txt --to sjis/crlf   # 文字コードと改行
convert-encoding foo.txt --to /crlf       # 改行だけ変える
convert-encoding foo.txt --info           # いまの状態を見るだけ
```

> [!IMPORTANT]
> **改行を書かなければ、改行は変えない。**「指定しなかったものは変えない」で通している。用途名だけは例外で、種類ごとに改行まで決まる。

### 変換元は自動で判定する

BOM → UTF-8 → SJIS の順に調べる。<strong>判定できなければ何も書き込まずに終える。</strong>推測で変換すると元へ戻せないため。`--from` で明示すると判定を飛ばす。

### 失われる文字があれば止まる

SJIS に無い文字（絵文字・ハングル・簡体字など）は `?` に置き換わって元に戻せない。<strong>変換の前に検査し、見つかれば書き換えずに終了コード 4 で終える。</strong>その文字と行番号を出すので、どこを直せばよいか分かる。承知のうえで進めるときは `--force` を付ける。

> [!NOTE]
> <strong>変換後のバイト列が元と同じなら、ファイルに触らない。</strong>更新日時が変わらないので、何度実行しても同じ結果になる。

詳細は[仕様書](notes/10_plan/p260906-01-convert-encoding.md)にある。

## 5. つまずきやすいところ

### Markdown を直接編集しない

<strong>HTML を正とし、Markdown は生成物として扱う。</strong>生成された `.md` を直しても次回の実行で上書きされる。内容を変えるときは HTML を直して再実行する。

### 更新日は HTML 側で直す

Markdown の日付は変換で引き継がれる。**個別に管理しない。**

### 指摘と警告は別物

| 印 | 意味 | 終了コード |
|---|---|---|
| ★ | 指摘。直す必要がある（リンク切れ・HTML に無い文言など） | `1` |
| ▲ | 警告。判断に委ねる（更新日が古い可能性など） | `0` |

「更新日が古い可能性」は<strong>体裁だけの変更なら直さなくてよい。</strong>本文を書き換えた日を書く決まりのため、警告に留めている。

### SVG は独立ファイルに切り出される

インライン SVG は `images/` に書き出され、`![](images/xxx.svg)` で参照される。**GitHub は Markdown 内のインライン SVG をサニタイズで除去するため。**

切り出すとき `var(--accent)` のような CSS 変数は実際の値に置き換わる。<strong>章ごとに色が違うので、その図がどの章にあるかを見て解決する。</strong>解決できない変数はそのまま残る。

### 参照実装との一致を壊さない

html2md 側に手を入れる場合、<strong>exe と `html2md-ps` の出力が一致することを `tools/40_test/run-tests.cmd` が検査している。</strong>片方だけ直すと落ちる。

[← html2md](README.md)
