# 要求 01 — PowerShell 学習資料から

> 📅 作成: 2026-08-29 / 更新: 2026-08-29

`N:\2026\20260822-powershell-pwsh-learn` から `html2md.exe` への要求。

## 目次

1. [背景](#1-背景)
2. [置き換えられなかった理由](#2-置き換えられなかった理由)
3. [要求項目](#3-要求項目)
4. [論点 — 図を PNG にするか SVG にするか](#4-論点--図を-png-にするか-svg-にするか)
5. [現行の変換仕様（参考）](#5-現行の変換仕様参考)

## 1. 背景

| 項目 | 内容 |
|---|---|
| 資料 | 本編 12 章 ＋ 付録 3 本 ＋ 構成 1 本 ＋ README |
| HTML | 17 ファイル |
| Markdown | 19 ファイル（`docs/rules/` の手書き 2 本を含む） |
| 図 | 63 枚（すべて HTML 内のインライン SVG） |
| 現行の変換器 | `N:\2026\PlayWright\projects\20260822-powershell-pwsh-learn\export-markdown.spec.ts`（Playwright + TypeScript） |

現行はブラウザで HTML を描画し、DOM を辿って Markdown を組み立てている。図は同じブラウザで SVG 要素を撮影して PNG にしている（`capture-figures.spec.ts`、`deviceScaleFactor: 3`）。

## 2. 置き換えられなかった理由

`html2md.exe` は要素の変換（h1〜h6・p・ul/ol・pre・table・blockquote・figure・nav・footer・callout）と `<strong>` 化を備えており、そこは十分だった。次の 5 点が無いため、そのままでは差し替えられない。

| # | 不足している機能 | 影響 |
|---|---|---|
| 1 | 章カード（`.chapters`）の表化 | README の章一覧が箇条書きに落ちる |
| 2 | `.html` → `.md` のリンク書き換え | 生成した md 内のリンクが全滅する |
| 3 | `#chNN` → GitHub スラッグの変換 | 同一ファイル内のアンカーが飛ばない |
| 4 | 画像の相対パス計算 | 階層の違うファイルで画像が表示されない |
| 5 | 図の出力形式（SVG 固定） | 既存 63 枚の PNG と方式が変わる（[4章](#4-論点--図を-png-にするか-svg-にするか)） |

## 3. 要求項目

### 3.1 章カード（`.chapters`）を表にする <strong>［優先度: 高］</strong>

README のトップに置いた 15 枚のカードを、Markdown では表にしたい。箇条書きだと `span` が連結されて読めなくなる。

**入力**

```html
<ul class="chapters">
	<li class="c01"><a href="docs/01-背景.html">
		<span class="no">第1部 基礎編</span>
		<span class="ttl">01. PowerShell の生まれた経緯</span>
		<span class="desc">DOS・Bash・Node.js と比較しながら、何を解決する道具なのかを掴む</span></a></li>
</ul>
```

**期待する出力**

```markdown
| 章 | タイトル | 内容 |
| --- | --- | --- |
| 第1部 基礎編 | [01. PowerShell の生まれた経緯](docs/01-背景.md) | DOS・Bash・Node.js と比較しながら、何を解決する道具なのかを掴む |
```

`.no` `.ttl` `.desc` の 3 つの `span` を列に割り当て、`.ttl` をリンクにする。クラス名は `notes/90_rules/html-class-rules.md` に追加してほしい。

### 3.2 `.html` → `.md` のリンク書き換え <strong>［優先度: 高］</strong>

変換対象になったファイルへのリンクだけを `.md` に差し替える。対象外の HTML（外部サイト・変換しないページ）は `.html` のまま残す。

```markdown
[03. 実行環境](docs/03-実行環境.html)  →  [03. 実行環境](docs/03-実行環境.md)
[GitHub](https://github.com/...)      →  そのまま
```

現行は「変換対象の basename 集合」を作り、その集合に含まれるものだけ書き換えている。対象外を書き換えると存在しないファイルを指すため、この絞り込みが要る。

### 3.3 アンカーを GitHub のスラッグに変換する <strong>［優先度: 高］</strong>

HTML では `id="ch03"` で参照しているが、Markdown では見出しテキストから生成されるスラッグになる。

```markdown
[03.2 実行ポリシー](docs/03-実行環境.html#ch02)
  ↓
[03.2 実行ポリシー](docs/03-実行環境.md#032-実行ポリシー--なぜ動かないのか)
```

<strong>同一ファイル内のリンク（`#ch04` 単独）も対象。</strong>ここは現行でも一度取りこぼし、9 箇所が飛ばない状態になっていた。

スラッグの生成規則（現行の実装）:

1. 小文字化する
2. バッククォートを削る
3. `. , / # ! $ % ^ & * ; : { } = + ~ ( ) [ ] ' " ? ！ ？ 。 、 （ ） 「 」` を削る
4. 前後の空白を落とす
5. 連続する空白を `-` にする

### 3.4 画像の相対パスをファイルの置き場所から求める <strong>［優先度: 中］</strong>

画像は 1 か所（`docs/images/`）に集約し、参照は各 md の位置から計算したい。

| md の位置 | 画像への相対パス |
|---|---|
| `README.md` | `docs/images/` |
| `docs/01-背景.md` | `images/` |
| `docs/plan/構成案.md` | `../images/` |

現行は「ルート直下か否か」の 2 分岐で書いていて、3 階層目で壊れた。**出力先ディレクトリからの相対パスを毎回計算する**のが正しい。

### 3.5 タイトルバーから冒頭を組み立てる <strong>［優先度: 中］</strong>

**入力**

```html
<div class="titlebar">
	<div class="inner">
		<h1>01. PowerShell の生まれた経緯</h1>
		<p>DOS・Bash・Node.js と比べながら、PowerShell が何を解決するために作られたのかを追う</p>
		<p class="meta">📅 作成: 2026-08-22 / 更新: 2026-08-22 ／ 対象: JavaScript の基本文法を知っている経験者</p>
	</div>
</div>
```

**期待する出力**

```markdown
# 01. PowerShell の生まれた経緯

> DOS・Bash・Node.js と比べながら、PowerShell が何を解決するために作られたのかを追う

📅 作成: 2026-08-22 / 更新: 2026-08-22 ／ 対象: JavaScript の基本文法を知っている経験者
```

1 つ目の `p` は引用、2 つ目（`.meta`）はそのまま本文行にする。

### 3.6 章間ナビを冒頭と末尾に出す <strong>［優先度: 中］</strong>

`<footer>` の内容を md の末尾に出し、あわせて<strong>冒頭にも同じナビを置きたい</strong>。900 行を超える章があり、次の章へ行くのに末尾までスクロールさせたくない。

```markdown
# 11. C# を埋め込む — Add-Type

> ...
📅 作成: ... / 更新: ...

前章: [10. ハンズオン課題](10-ハンズオン.md) ／ 次章: [12. Office と COM](12-COMとOffice.md) ／ [目次に戻る](../README.md)

### この章で何ができるようになるか
...

---

PowerShell 学習資料 11 ／ 前章: ... ／ 次章: ... ／ [目次に戻る](../README.md)
```

冒頭は footer の 1 行目から `PowerShell 学習資料 NN ／` の接頭辞を落として使っている。ナビを持たないページ（README）には出さない判定が要る（「前章」「次章」「目次に戻る」を含むかで判定）。

### 3.7 バッジを文字に落とす <strong>［優先度: 中］</strong>

色でしか区別していない情報は Markdown では読めなくなる。

```html
<span class="badge b-ps7">pwsh 7</span> では既定が UTF-8 です
```

```markdown
**［pwsh 7］** では既定が UTF-8 です
```

角括弧は全角 `［］` を使う。半角だとリンク記法と紛らわしい。

### 3.8 コードブロックの言語を推測する <strong>［優先度: 低］</strong>

`<pre><code>` に言語の指定が無いので、中身から判定している。現行の判定順:

| 順 | 条件 | 言語 |
|---|---|---|
| 1 | `├──` `└──` `│` を含む | `text`（ツリー図） |
| 2 | 行頭に `---` が 3 つ以上 | `text`（出力例の区切り線） |
| 3 | `@echo off` `REM ` `C:\>` `%~dp0` `%ERRORLEVEL%` | `bat` |
| 4 | `const ` `=>` `require(` `console.log` `process.exit` | `javascript` |
| 5 | `{` `[` で始まり `"key":` を含む | `json` |
| 6 | `SELECT` と `FROM` の両方があり `$変数` が無い | `sql` |
| 7 | `$ ps aux` または行頭 `$ ` | `bash` |
| 8 | 上記以外 | `powershell` |

6 番目で `SELECT` だけを条件にすると `Where-Object` を含む PowerShell を SQL と誤判定する。両方を要求する必要がある。

この機能が無い場合、既定を `powershell` にできるオプションでも足りる。

## 4. 論点 — 図を PNG にするか SVG にするか

**ここが最大の相違点。**

| | 現行（PNG） | html2md.exe（SVG 切り出し） |
|---|---|---|
| 生成方法 | ブラウザで描画してスクリーンショット | HTML から `<svg>` を抜いてファイル化 |
| CSS 変数 | <strong>解決済み</strong>（描画後に撮るため） | <strong>未解決</strong>（`var(--accent)` が文字列のまま残る） |
| フォント | 本文と完全に一致 | 閲覧環境依存 |
| ファイルサイズ | 63 枚で 17.9 MB | 大幅に小さい |
| Git の差分 | バイナリなので差分圧縮が効かない | テキストなので効く |
| 再撮影時の揺れ | <strong>あり</strong>（アンチエイリアスで毎回バイト差が出る） | なし |

この資料の図は<strong>章ごとのアクセント色を CSS 変数から取っている</strong>。

```html
<section class="ch03">
	<svg viewBox="0 0 780 250">
		<linearGradient id="g-03-1a">
			<stop offset="0" stop-color="var(--accent)"/>
			<stop offset="1" stop-color="var(--accent2)"/>
		</linearGradient>
		<rect fill="url(#g-03-1a)"/>
	</svg>
</section>
```

`--accent` は `.ch03 { --accent: hsl(168,78%,25%); }` のように section のクラスで定義されている。**SVG を単体ファイルに切り出すと、この変数が解決されず色が失われる。**

要求としては次のいずれか。

- **案A**: SVG 切り出し時に、その要素に効いている CSS 変数を解決して `stop-color` に直接埋め込む
- **案B**: PNG 出力にも対応する（ブラウザが要るので html2md.exe 単体では難しい）
- **案C**: 図だけは現行の Playwright 撮影を残し、md 生成のみ html2md.exe を使う

**案A が本筋**だと考える。CSS 変数の解決は、対象要素の祖先を遡って `--名前: 値` を集めれば静的に決まる。`@media` や JS による上書きが無い前提なら、ブラウザは不要。

あわせて、切り出した SVG には次を付けてほしい（`~/.claude/CLAUDE.md` の「HTML→Markdown 変換ルール」より）。

- `xmlns="http://www.w3.org/2000/svg"` と `width` / `height`
- 先頭に白背景の矩形（`<rect width="100%" height="100%" fill="#ffffff"/>`）。透過のままだとダークモードで文字が読めない

## 5. 現行の変換仕様（参考）

置き換えの判断材料として、現行が行っている変換を挙げる。3 章に書いていないものはすでに `html2md.exe` にあると理解している。

| HTML | Markdown |
|---|---|
| `<section>` + `h1` | `## 見出し`（レベルを 1 つ下げる） |
| `h2` `h3` | `###` `####` |
| `.callout` | `> [!NOTE]` |
| `<div class="table-wrap"><table>` | Markdown テーブル。改行は `<br>`、`\|` はエスケープ |
| `<figure>` + `figcaption` | 画像参照 ＋ 直後に `*キャプション*` |
| `<nav class="toc">` | 出力しない（見出しから目次を別途生成） |
| セクション一覧 | `## 目次` として `- [見出し](#スラッグ)` を並べる |
| `<footer>` | `---` の水平線 ＋ 内容 |

### 生成後の検証

同じフォルダの `check-markdown.ps1` で GitHub のレンダラに投げて確認している。**変換器を差し替えたら、この検証を通すことが受け入れ条件**になる。

現行の出力は 19 ファイルすべて指摘 0 件。

### 移行の進め方の希望

いきなり全面切り替えはしない。`--dry-run` で現行の出力と 1 ファイルずつ突き合わせ、差分が説明できる状態にしてから切り替えたい。差分の確認には図の 63 枚も含まれる。
