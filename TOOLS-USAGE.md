# ai-agent-tools を他のプロジェクトから使う

HTML と Markdown、文字コード、公開前の検査。自プロジェクトには何もインストールしない。

> 📅 作成: 2026-09-04 / 更新: 2026-09-21

[← ai-agent-tools](README.md) ／ [タグ対応仕様](notes/10_plan/html2md-tag-spec.md) ／ [クラス名の取り決め](notes/90_rules/html-class-rules.md)

## 目次

1. [使えるコマンド](#1-使えるコマンド)
2. [html2md で変換する](#2-html2md-で変換する)
3. [検証する](#3-検証する)
4. [文字コードと改行を直す](#4-文字コードと改行を直す)
5. [文字コードを問わず読む・探す・書く（text）](#5-文字コードを問わず読む探す書くtext)
6. [PowerShell を呼ぶ（psh）](#6-powershell-を呼ぶpsh)
7. [ページングして読む（less）](#7-ページングして読むless)
8. [プロセス一覧を見る（psls）](#8-プロセス一覧を見るpsls)
9. [つまずきやすいところ](#9-つまずきやすいところ)

## 1. 使えるコマンド

<strong>このフォルダは PATH に入っている。パスを書かずに名前だけで呼べる。</strong>自プロジェクトに何かをインストールする必要はなく、ランチャーを置く必要もない。

| コマンド | 何をするか |
|---|---|
| `html2md` | HTML から Markdown を生成し、そのまま検査する |
| `check-markdown` | 生成した Markdown が **GitHub 上で意図どおりに表示されるか**を実測する |
| `check-contrast` | HTML の文字色と背景色が **読める組み合わせか**をブラウザで実測する |
| `convert-encoding` | ファイルの文字コードと改行を、**ファイルの種類ごとに決められた形へ**変換する |
| `text` | SJIS・UTF-16 でも壊さず**読む・探す・編集する・書く**（Read・Grep・Edit・Write の代わり） |
| `check-public` | 公開前に、**外に出してはいけないもの**が混ざっていないかを見る |
| `psh` | PowerShell を呼び、出力を **UTF-8 に直して流す**（第 6 章） |
| `less` | UTF-8 セーフなページャー。DOS の `more` の文字化けを避ける（第 7 章） |
| `psls` | プロセス一覧をツリー表示する。物理メモリ使用量・キーワード絞り込み付き（第 8 章） |

どちらの検証ツールも<strong>推測せず実物で判定する。</strong>前者は GitHub のレンダラに投げ、後者はブラウザで描画して計測する。ローカルの理屈と実物の表示は一致しないことがある。

### 中身が TypeScript に変わった（2026-09-12）

**どれも TypeScript で書いてある。**`html2md` ・ `text` ・ `convert-encoding` は C# の exe から、`check-contrast` ・ `check-markdown` は PowerShell から移した。`psh` ・ `check-public` は最初から TypeScript である。

呼び出し方・出力の中身は変えていない。**使う側の書き換えは要らない**（`check-〜` のオプションだけ `--` へ寄せたが、古い形も受ける）。

| 項目 | 前（C# の exe） | 後（TypeScript） |
|---|---|---|
| 実体 | `html2md.exe` | `html2md` ・ `html2md.cmd` から `src/html2md/main.ts` |
| 実行に要るもの | なし（単体で動く） | **`bun` か `node`**（bun を優先） |
| 標準出力の文字コード | CP932 | **常に UTF-8** |
| Bash から呼んだとき | **日本語が化ける** | 化けない |

**残した C# 版も UTF-8 で出すように直した**ので、いまはどれを呼んでも標準出力は UTF-8 である。

> [!IMPORTANT]
> <strong>素の PowerShell 5.1 から呼ぶと化ける。</strong>5.1 は標準出力を CP932 として読むため、UTF-8 で出す側と打ち消し合わない（実測で `→` が壊れた）。受け手側に 1 行置いて揃える。**`psh` 経由なら要らない**（第 6 章）。
> ```powershell
> [Console]::OutputEncoding = [System.Text.Encoding]::UTF8
> ```

移す前の C# 版は `html2md-cs.exe` ・ `text-cs.exe` ・ `convert-encoding-cs.exe` として残してある。<strong>突き合わせ用で、ふだん呼ぶものではない。</strong>結果が食い違ったときの切り分けに使う。

## 2. html2md で変換する

### 基本

プロジェクトのフォルダで実行する。**既定では root の `README.html` と `notes/` 配下を変換する。**

```powershell
html2md --root .                          # 既定（README.html と notes/）を変換する
html2md --root . --dir docs --dir notes   # docs/ も対象に加える
html2md --root . --dry-run                # 書き出さず、結果と指摘だけ見る
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

生成する `.md` と切り出した `.svg` は、<strong>BOM 無しの UTF-8 ＋ LF で書く。</strong>共通ルールが置く `.editorconfig` ・ `.gitattributes` の宣言（`.md` は LF）に合わせてある。元の HTML が CRLF でも、生成物は LF になる。

> [!WARNING]
> <strong>`docs/` を持つプロジェクトは `--dir docs` を忘れない。</strong>付けずに実行すると `docs/` が変換されないまま、そこへのリンクだけが残る。`docs/` の HTML へのリンクは `.html` のまま出るので壊れはしないが、Markdown 側から `docs/` の内容に到達できなくなる。

### ルート直下の README 以外を変換する

ルート直下は `README.html` だけを見る。**ほかのファイルは `--extra` で名指しする。**

```powershell
html2md --root . --extra TOOLS-USAGE.html
```

この文書自身もこの形で生成している。名指しにしているのは、**作業用に置いた HTML まで拾わないため。**

### HTML の書き方

変換に使うクラス名は[クラス名の取り決め](notes/90_rules/html-class-rules.md)に合わせる。<strong>プロジェクトごとに違う名前を使わない。</strong>どのタグがどう変換されるかは[タグ対応仕様](notes/10_plan/html2md-tag-spec.md)にある。

**リンクは常に `.html` と書く。**`.md` への置き換えは html2md が行う。HTML 側で先取りして `.md` と書くと、HTML のリンクが壊れたまま Markdown 側だけ正しくなり、気づきにくい。

### 章一覧を表にする（chapters）

カード風に並べた章一覧は、`ul` に `chapters` を付けると 3 列の表になる。<strong>`data-columns` は必須。</strong>表の見出し文言は HTML に書かれたものしか使えないため、無いと変換が止まる。

```html
<ul class="chapters" data-columns="部,タイトル,内容">
	<li><a href="docs/01-背景.html">
		<span class="part">第1部 基礎編</span>
		<span class="ttl">01. PowerShell の生まれた経緯</span>
		<span class="desc">DOS・Bash・Node.js と比較しながら、何を解決する道具なのかを掴む</span>
	</a></li>
</ul>
```

詳しいクラス名は[クラス名の取り決め](notes/90_rules/html-class-rules.md)を参照。

### 変換対象から外す

外し方は 3 通り。**何を外したいかで選ぶ。**

| 外すもの | 書き方 |
|---|---|
| ページ全体 | `head` に `<meta name="md-skip">` を置く |
| 要素だけ | その要素に `class="md-skip"` を付ける |
| ファイル名で | `--exclude <名前>` を渡す。**効くのは `--dir` で探したファイルだけ**で、`README.html` と `--extra` で名指ししたものは素通りする |

ページ全体を外すのは、変換すると構造が失われるものに使う。ログのように機械が書き足すページが該当する。

`details` は既定でタグのまま出る。GitHub が解釈するので畳みが効く。**畳むより見出しが要るページには `class="md-flat"` を付ける。**`summary` が見出しになり、中身はその配下の本文になる。課題の一覧のように 1 件ずつ引くものに向く。

外したページへのリンクは、<strong>拡張子を置き換えず `.html` のまま残る。</strong>除外の判定は html2md が行うので、書き手は常に `.html` と書けばよい。

> [!NOTE]
> GitHub はリポジトリ内の `.html` をレンダリングせず<strong>ソース表示にする。</strong>畳みは効かないが、中身には到達できる。

## 3. 検証する

### Markdown が GitHub で崩れていないか

```shell
check-markdown . --recurse
```

Markdown を GitHub のレンダラに投げ、返る HTML に `**` が記号のまま残っていないかを見る。**日本語では `**` が強調にならないことがある**（前後の文字で開閉が決まる）。html2md は該当箇所を `<strong>` に置き換えるが、実物で確かめるのはこちら。

認証なしは 60 回/時。`--token` を渡すと 5000 回/時になる。

### HTML の色が読める組み合わせか

```shell
check-contrast . --recurse
```

**オプションはどれも同じ形**（`--path` ・ `-p` ・ 名前を付けない対象）。この 2 つは以前 PowerShell 製で `-Path` 形式だったが、<strong>TypeScript へ移して `--` へ寄せた。</strong>古い形も当面は受ける。

移す前の PowerShell 版は `check-contrast-ps.ps1` ・ `check-markdown-ps.ps1` として残してある。**突き合わせ用で、ふだん呼ぶものではない。**

ブラウザで実際に描画し、前景色と実効背景色の比を計算する。<strong>1.5:1 未満を 0 件にする。</strong>検出したいのは「白に白」「黒に黒」「色の継承事故」で、値を上げると誤検出に埋もれる。

ブラウザは PlayWright 共有環境を借りる。**自プロジェクトに Playwright を入れる必要はない。**

**計測には待ち時間の上限がある**（既定 300 秒・`--timeout` で変えられる）。ブラウザが返らなくなったときに、<strong>止まったままにならないため。</strong>上限で打ち切られたときは、その旨と延ばし方を出す。

### 公開前に、出してはいけないものが混ざっていないか

```shell
check-public                      # カレントのプロジェクトを見る
check-public --word-list _ng.txt  # 除外語リストを指定する
```

コミットは履歴に残る。<strong>一度上げたものを消すには履歴の書き換えが要る。</strong>上げる前に機械で見る。

| 項目 | 見るもの | `--skip` |
|---|---|---|
| メールアドレス | 一般的なアドレスの形。`example.com` ・ `noreply@` は除く | `mail` |
| 実体パス | `C:\Users\` の直後が伏せ字でないもの | `path` |
| 認証情報 | `password` ・ `token` などに**値が続くもの** | `secret` |
| 異体字 | 日本語・英数字に混ざったキリル・ハングル | `script` |
| 除外語 | リストに書いた語。顧客名・案件名は式では見つけられない | `words` |
| git の author | `user.name` ・ `user.email` を本文から探す | `author` |

> [!CAUTION]
> <strong>当たった値そのものは画面に出さない。</strong>出力は会話ログや CI のログに残る。伏せるための道具が漏らす側にまわってはいけない。出るのはファイルと行番号、当たった項目だけ。

**見るのは git が追跡しているファイルだけ。**`.gitignore` で外したものは公開されないため、見れば必ず誤検出になる（除外語リスト自身がそこにある）。`--all` で全部を見られる。

#### 対象の決め方

<strong>拾う拡張子を並べる形にしていない。</strong>外すのは中身がテキストでないものだけ（画像・音声・書庫・実行ファイル・フォント・文書・データベース）で、**残りはすべて見る。**

- **拡張子を持たないファイルも見る**（`html2md` ・ `text` のような sh のランチャー）
- <strong>`.svg` も見る。</strong>図の中に文字が入る
- <strong>SJIS ・ UTF-16 も取りこぼさない。</strong>ここを外すと `cmd` ・ `reg` だけが検査されない状態になる
- <strong>文字コードを判定できないものも、UTF-8 として読めるなら見る。</strong>BOM 無しで日本語を含むファイルは UTF-8 とも SJIS とも読めて決まらない。`convert-encoding` は書き換えずに止めるが、**検査では逆で、読める形があるのに飛ばすと黙って漏れる**

> [!WARNING]
> <strong>拾う側を並べると、並べ忘れたものが黙って外れる。</strong>外れていることは出力を見ても分からない。実際に `.svg` 6 件と sh のランチャー 7 件が漏れていた（他プロジェクトからの指摘で判明）。

除外語リストは**先頭 `_` のファイルを既定にする**（`_public-ng-words.txt`）。リスト自体が機密になるため、共通ルールにより全階層が Git 管理外になる置き方を採る。<strong>リストが無ければ、その項目を飛ばしたことを画面に出す。</strong>黙っては通さない。

### どちらも既定で除外するフォルダがある

`check-markdown` ・ `check-contrast` は、<strong>次のフォルダを既定で対象から外す。</strong>除外した件数は画面に出ないので、対象が思ったより少ないときはここを疑う。

| ツール | 既定の除外 |
|---|---|
| `check-markdown` | `tmp` ・ `etc` ・ `node_modules` ・ `.git` |
| `check-contrast` | 上記に加えて `contrast`（自身の出力先） |

`-Exclude` に正規表現を渡すと差し替えられる。**足すのではなく置き換わる**ので、既定の分も要るなら書き足す。

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
convert-encoding foo.cmd --read           # 中身を UTF-8 で出す
convert-encoding foo.cmd --dump           # 中身を 16 進で出す
```

### フォルダをまとめて見る（--info と --check）

`--info` と `--check` は**フォルダも受ける**。その下を再帰して 1 ファイルずつ見る。書き込みはしない。

```powershell
convert-encoding . --info    # 全件を出す。終了コードは常に 0
convert-encoding . --check   # 規約に合わないものだけ。あれば 1
```

```text
tools/40_test/run-tests.ps1  utf8bom+lf  → ps1 は utf8bom+crlf
notes/10_plan/plan.html      utf8+lf     → html は utf8bom+lf

=== 2 件が規約に合いません ===
```

**あるべき組は拡張子で決まる。**`ps1` は BOM 付き UTF-8 ＋ CRLF、`cmd` ・ `bat` は SJIS ＋ CRLF、`reg` は UTF-16 LE ＋ CRLF、`html` ・ `htm` は BOM 付き UTF-8 ＋ LF。**そのほかは BOM 無し UTF-8**（`.editorconfig` の `[*]`）。

**改行は、規約を置いた拡張子だけ見る。**`md` ・ `js` ・ `mjs` ・ `ts` ・ `json` ・ `css` ・ `cs` ・ `go` ・ `rs` ・ `yml` ・ `sh` ・ `svg` ・ `xml` 等は LF。**`txt` ・ `log` ・ `csv` のような、規約を置いていないものは問わない**（`.gitattributes` の `* text=auto eol=lf` で git 側は LF に揃うため、作業ツリーまで縛らない）。**文字コードは git が変換しないので、拡張子によらず見る。**

<strong>改行が混ざっていれば、それだけで規約に合わない。</strong>単独の CR も同じ。<strong>これは拡張子によらず見る。</strong>改行がまったく無いファイルは合っている扱い。

> [!TIP]
> <strong>表示する組と改行の名前は、`--to` ・ `--from` に書く綴りと同じ小文字。</strong>出た名前をそのまま指定へ渡せる（`text` も同じ）。**非 ASCII を含まないファイルは `ascii` と出す**——`utf8` と `sjis` でバイト列が同じで区別できないため。**組が増えたわけではない**ので `--from ascii` は受けない。

既定で `tmp` ・ `etc` ・ `node_modules` ・ `.git`、**先頭 `_` のファイルとフォルダ**、バイナリを見ない。`--include` で絞り、`--exclude` ・ `--exclude-dir` で既定に足す（カンマ区切りで複数書ける）。`.gitignore` は読まない。

```powershell
convert-encoding . --check --include "*.ps1,*.cmd"
convert-encoding . --info  --exclude-dir "dist,_releases"
```

> [!TIP]
> <strong>テストの最後に置くと、編集の道具が落とした BOM や改行をその場で拾える。</strong>このリポジトリでは `tools/40_test/run-all-tests.ps1` が全テストのあとに `--check` を回し、違反があれば全体を失敗にしている。

### cmd・bat を作る・直す・消す（Windows）

SJIS の cmd・bat は、**標準ツールで書く／編集して差分を見てから、SJIS 化する**。編集は UTF-8 の状態で標準 Edit / Write に任せると、ハーネスのきれいな差分が得られる。

```powershell
# 作成: 標準 Write で書く → 変換
convert-encoding foo.cmd --to cmd

# 修正: UTF-8 化 → 標準 Edit（差分が出る）→ 戻す
convert-encoding foo.cmd --to utf8
#（標準 Edit で foo.cmd を編集）
convert-encoding foo.cmd --to cmd
```

> [!WARNING]
> **編集中は `.cmd` が UTF-8 のまま。編集したらすぐ `--to cmd` で戻す**（中断すると UTF-8 で残り、日本語入りは正しく動かない）。読むのは `text read`、消すのは `Remove-Item`（文字コード無関係）。手段の比較は html2md の `notes/10_plan/p260908-01-sjis-file-handling.html`。

### SJIS のファイルを読む

<strong>読み取りツールは SJIS を UTF-8 として読むため化ける。</strong>文字コードを指定する手段が無いので、`--read` を通す。

```powershell
convert-encoding tools/80_ops/foo.cmd --read
```

> [!WARNING]
> <strong>スクリプトから使うときは受け取る側を UTF-8 に固定する。</strong>Windows PowerShell 5.1 は外部コマンドの出力を OEM コードページ（932）として読むため化ける。`[Console]::OutputEncoding = [System.Text.Encoding]::UTF8` を先に置く。pwsh 7 は既定で UTF-8。

### バイト列を 16 進で見る

**判定できないファイルや、化けて見えるファイルの中身をバイト単位で確かめる。**`--offset` と `--bytes` で範囲を絞れる。16 バイトごとに改行する。

```powershell
convert-encoding foo.cmd --dump                     # 全体
convert-encoding foo.cmd --dump --offset 0 --bytes 16   # 先頭 16 バイト
```

出力はそのまま `--from hex` に渡せる。書き換えて戻す往復ができる。

> [!IMPORTANT]
> **改行を書かなければ、改行は変えない。**「指定しなかったものは変えない」で通している。用途名だけは例外で、種類ごとに改行まで決まる。

### 変換元は自動で判定する

BOM を見たあと、UTF-8 と SJIS の両方で検査して決める。<strong>判定できなければ何も書き込まずに終える。</strong>推測で変換すると元へ戻せないため。`--from` で明示すると判定を飛ばす。

> [!NOTE]
> <strong>半角カタカナだけの短いファイルは、UTF-8 とも SJIS とも読めて止まることがある。</strong>そのときは `--from sjis` のように明示する。ふつうの日本語文なら数十文字あれば一意に決まる。

### 失われる文字があれば止まる

SJIS に無い文字（絵文字・ハングル・簡体字など）は `?` に置き換わって元に戻せない。<strong>変換の前に検査し、見つかれば書き換えずに終了コード 4 で終える。</strong>その文字と行番号を出すので、どこを直せばよいか分かる。承知のうえで進めるときは `--force` を付ける。

**元のバイト列が指定した組として読めないときも、同じ終了コード 4 で止まる**（原因は逆で、変換元のバイトが読めない側）。同一組へのバイト保持は対象外。`--from` で組を明示すれば読み方を変えられる。

> [!NOTE]
> <strong>変換後のバイト列が元と同じなら、ファイルに触らない。</strong>更新日時が変わらないので、何度実行しても同じ結果になる。

詳細は[仕様書](notes/10_plan/p260906-01-convert-encoding.md)にある。

## 5. 文字コードを問わず読む・探す・書く（text）

`text` は 1 本の多機能コマンドで、**SJIS（cmd・bat）・UTF-16（reg）・UTF-8BOM（html）でも壊さず**読み・検索・編集・書き込みができる。標準の Read・Grep・Edit・Write がこれらで化ける・漏らす・破壊するのを避けるためのもの。**文字コードと改行の「組」はツールが判定する**ので、渡す前に知っている必要はない。**変換先で表現できない文字は、黙って `?` にせず書かずに止まる**（下記）。

> [!IMPORTANT]
> <strong>`text` の主役は `read`（読む）と `find`（探す）。</strong>cmd・bat の作成・修正は convert-encoding ＋標準ツールで足りる（差分も見える／前章）。`edit` / `write` は**数百行以上の非 UTF-8 や reg など**の補足。

| サブコマンド | 代わり | 何をするか |
|---|---|---|
| `text read` | Read | 何であろうと読み、UTF-8 で見せる |
| `text find` | Grep | 何であろうと探す（SJIS の日本語も当たる） |
| `text edit` | Edit | 部分置換して**元の組のまま書き戻す** |
| `text write` | Write | 指定・または既存の組で全文を書く |

### 読む・探す

```powershell
text read tools/80_ops/foo.cmd            # SJIS でも化けずに読む（◆ ヘッダに組・digest）
text read tools/80_ops/foo.cmd --lines 3-5  # 範囲を絞る（省トークン）
text find 日本語 --path . --recurse --include "*.cmd,*.reg"
```

`find` は**ファイルごとに ◆ 見出し＋一致行**を出す（サクラエディタの grep 風）。**複数の glob はダブルクォートで囲む**（`"*.cmd,*.reg"`）。フォルダを外すのは `--exclude-dir`。

#### 既定で外すフォルダ

`find` は **`tmp` ・ `etc` ・ `node_modules` ・ `.git` を見ない**（`check-markdown` ・ `check-contrast` と同じ）。`--exclude-dir` は**この既定に足す**形で、渡しても既定は消えない。

> [!CAUTION]
> <strong>`etc/history/jsonl` には会話ログが入る。</strong>素で `--recurse` を撃つとここまで読み、<strong>過去の会話が出力に出る。</strong>共通ルール「.gitignore で除外されたファイルの取り扱い」を破ることになるため、既定で外してある。

意図して見たいときは `--no-default-exclude` で解除する。**付け忘れると読んでしまう形ではなく、明示したときだけ読む形にしてある。**

### 編集する

```powershell
text edit foo.cmd --old "powershell.exe" --new "powershell"     # 中身で指す
text edit foo.cmd --lines 3-3 --digest 9f2a1c33 --new "..."     # 行範囲＋合言葉
```

`--digest` は `read` が返す合言葉（行範囲＋サイズ＋更新日時）。**read してから edit する間に別の人が更新していれば、合言葉が合わずに止まる**（競合検知）。`old_string` を書かずに済むぶんトークンも軽い。ファイルから中身を渡すときは `--old-file` / `--new-file`。

### 書く

```powershell
text write new.cmd --to cmd --in tmp/body.txt   # 用途名で組を決めて書く
text write app.reg --keep --in tmp/body.txt     # 既存の組を保って書く
echo @echo off | text write new.cmd --to cmd    # 標準入力／第 2 引数でも渡せる
```

> [!WARNING]
> **変換先で表現できない文字は、書かずに `exit 5` で止まる**（cmd＝SJIS に無い絵文字・ハングル・`✓` など）。黙って `?` にはしない。`edit` も同じ。中身は `--in <path>` か第 2 引数で渡す（空の標準入力では上書きしない）。

> [!IMPORTANT]
> **UTF-8 と分かっているファイルは標準の Edit のほうが快適**（差分プレビュー・自動追跡）。`text` の出番は **SJIS・UTF-16・UTF-8BOM** のときと、大きな範囲を安く置換したいとき。`--from <組>` で判定を上書きできる（`convert-encoding --from` と同じ「入力側」の指定）。

詳しい仕様は html2md 側の `notes/10_plan/p260907-01-text-tools.html` にある。

## 6. PowerShell を呼ぶ（psh）

<strong>Bash から PowerShell を呼ぶと、日本語の出力が化ける。</strong>PowerShell が呼んだ .NET 製の exe が CP932 で出すため。`psh` は間に入って、受け取ったバイト列を読み分けて **UTF-8 で流し直す。**

```shell
psh tools/40_test/run-tests.ps1          # ps1 を実行する（引数はそのまま後ろに足す）
psh -c "Get-ChildItem . | Measure-Object"  # 式を実行する
psh --pwsh -c "$PSVersionTable.PSVersion"  # pwsh（7）で走らせる
```

| オプション | 意味 |
|---|---|
| `-c <式>` ・ `--command <式>` | 式を実行する。**式は 1 つの引数として渡す** |
| `--pwsh` | pwsh（7）で走らせる。**先頭に置く** |
| `--help` ・ `-h` | 使い方を出して終わる。**先頭に置いたときだけ**（`psh foo.ps1 --help` の `--help` は `foo.ps1` へ渡る） |

オプションを付けなければ第 1 引数を ps1 のパスとして `-File` で実行する。<strong>いずれも `-NoProfile -ExecutionPolicy Bypass` が付く。</strong>終了コードは PowerShell のものをそのまま返す。

### 既定は 5.1。7 ではない

ps1 は Windows PowerShell 5.1 で動くように書く決めがある。<strong>厳しい側で動かさないと、7 でしか通らない書き方に気づけない。</strong>起動も 5.1 のほうが速い（実測 185ms 対 285ms。7 は .NET Core の起動コストが乗る）。

### クォートの注意

`powershell -Command "…"` に文字列を渡すと<strong>引用符が二重に解釈される。</strong>エラーにならず、静かに違う内容で動くことがある。`psh` は子プロセスを配列のまま起動するので、この段が 1 つ減る。

> [!WARNING]
> <strong>式の中の `$` は呼び出し側のシェルが先に食う。</strong>Bash から渡すならシングルクォートで囲む（`psh -c '$PSVersionTable'`）。**PowerShell に渡したい変数を、呼び出し側で展開させない。**

## 7. ページングして読む（less）

<strong>DOS の `more` へ UTF-8 の出力をパイプすると文字化けする。</strong>PowerShell・.NET 系の出力コードページ問題の受け手側（第 6 章と根が同じ）。`less` は UTF-8 のまま画面に収まる分だけ表示する。

```shell
type README.md | more   # 文字化けする（DOS の既定のコードページで読むため）
type README.md | less   # UTF-8 のまま化けずに読める
```

| キー | 動き |
|---|---|
| `q` | 終了 |
| `PageDown` ・ `Space` | 画面の高さの 3/4 くらい下 |
| `↓` ・ `Enter` | 1 行下 |
| `↑` | 1 行上 |
| `PageUp` | 画面の高さの 3/4 くらい上 |

出力先が端末でない（ファイルへのリダイレクト等）ときは、ページングせずそのまま流す。<strong>パイプ専用で、ファイル引数は受けない。</strong>検索・行番号表示は今回持たない。

**入力の文字コードは自動判定する**（UTF-8・SJIS・UTF-16 等。`convert-encoding`・`text` と同じ判定ロジック）。決められないときは UTF-8 として読む。

## 8. プロセス一覧を見る（psls）

**プロセスを親子関係のツリーで一覧する。**`bun:ffi` で Windows API を直接呼ぶため **Bun 専用**（`node` では「bun が必要です」で終わる）。

```shell
psls               # 全プロセスをツリーで見る
psls claude.exe    # "claude.exe" を含む行だけに絞り込む（大小文字は区別しない）
```

| 形式 | 意味 |
|---|---|
| `<pid> <開始時刻> (<経過時間>) <物理メモリ> <exe> <罫線><コマンド行>` | 1行1プロセス。既定は親子関係のツリー表示 |
| キーワード（省略可） | 含む行だけに絞り込む（大小文字は区別しない）。一致行は太字＋緑でハイライトし、ツリーの形を保つため祖先も残す |
| `-f`, `--full-path` | exe 欄をフルパスで表示する（既定はファイル名のみ。同名別パスは `*1`・`*2` で区別し、末尾に対応表を出す） |
| `--no-trim` | コマンド行を端末幅で切り詰めない |

取得できない項目（権限不足等）は `-`（コマンド行は `(-)`）にする。**管理者として実行すると `SeDebugPrivilege` を自動で有効化し、より多くのプロセスの情報を取得できる**（一般ユーザーでは無効化されずそのまま動く）。

## 9. つまずきやすいところ

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

### 期待値との一致を壊さない

html2md 側に手を入れる場合、<strong>出力が `tests/golden/` の期待値と一致することを `tools/40_test/run-tests.cmd` が検査している。</strong>出力を変える修正なら落ちるので、差分を目で確かめてから期待値を作り直す。

[← ai-agent-tools](README.md)
