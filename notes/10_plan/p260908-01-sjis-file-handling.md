# SJIS ファイルの扱い方（作成・修正・削除）

cmd・bat（SJIS）を壊さず、しかも差分を見ながら扱うための手段の比較と決定

> 📅 作成: 2026-09-08 / 更新: 2026-09-12

[^^](../../README.md) ／ [text ツール仕様](p260907-01-text-tools.md)

1. [背景と結論](#1-背景と結論)
2. [手段の一覧と評価](#2-手段の一覧と評価)
3. [操作べつの手順（決定）](#3-操作べつの手順決定)
4. [量・速度・差分の知見](#4-量速度差分の知見)

## 1. 背景と結論

cmd・bat は SJIS＋CRLF、reg は UTF-16LE、html は UTF-8BOM。標準の Read・Grep・Edit・Write はこれらを化かす・漏らす・破壊する。壊さずに、しかも**変更を差分で確認しながら**扱う手段を比べ、操作べつに決めた。

### 結論（cmd・bat の場合）

| 操作 | 手順 | 差分 |
|---|---|---|
| **作成** | 標準 Write で書く → `convert-encoding <path> --to cmd` | ◎ Write が全内容 |
| **修正** | `convert-encoding <path> --to utf8` → 標準 Edit → `convert-encoding <path> --to cmd` | ◎ 標準 Edit |
| **削除** | `Remove-Item`（文字コード無関係） | — |
| **読む** | `text read`（または `convert-encoding --read`） | — |
| **探す** | `text find` | — |

> [!NOTE]
> <strong>要点は「標準ツールで書く・編集して差分を見る → 最後に SJIS 化」。</strong>編集は UTF-8 の状態で標準 Edit / Write に任せ、ハーネスのきれいな差分を得る。SJIS 化は `convert-encoding` の用途名 1 つで決まる。**cmd・bat の作成・修正に `text edit` / `text write` は要らない**。`text` は<strong>読む（read）・探す（find）</strong>が主役。

## 2. 手段の一覧と評価

SJIS ファイルに対して取りうる手段と、その良し悪し。速度と差分表示も観点に入れる。

| 手段 | 主な用途 | 速度 | 差分表示 | メリット | デメリット |
|---|---|---|---|---|---|
| 標準 Edit | 修正 | 速い | UTF-8 時のみ | 手軽・許可 UI | ❌ **不可** SJIS 破壊（U+FFFD）・成功が返る |
| 標準 Write | 作成 | 速い | UTF-8 時のみ | 手軽 | ❌ **単体不可** SJIS を書けない（UTF-8 BOM無し LF 固定） |
| 標準 Write ＋ convert | 作成 | 速い | ◎ Write が全内容 | tmp 不要・対象に直接書ける | 2 手・変換で全体エンコード |
| convert 往復＋標準 Edit | 修正 | 速い | ◎ 標準 Edit | tmp 不要・作成と道具が揃う | 編集中は UTF-8 のまま（中断注意）・全体エンコード 2 回 |
| tmp で UTF-8 作業 | 修正 | 中（多段） | ◎ 標準 Edit | 元は最後まで SJIS（中断に強い） | tmp の作成・後始末 |
| `text edit` | 修正 | 中 | **なし** | 部分置換・元バイト保持・軽い・競合検知 | 差分が見えない・digest 持ち回り・`--all` 無し |
| `text write` | 作成/全面 | 中 | なし | 1 手で組決定 | 中身は `--in`/stdin 主 |
| `text read` | 読む | 中 | — | SJIS/UTF-16 を正しく読む・範囲読み | — |
| `text find` | 探す | 中 | — | SJIS の日本語も当たる | — |
| PowerShell バイト置換 | 修正 | 速い | なし | — | ❌ **禁止** AMSI 検知（`Trojan/FileFix`） |
| `Remove-Item` | 削除 | 速い | — | 標準・文字コード無関係 | 消す前の確認は別途（`text read`） |

> [!CAUTION]
> <strong>差分は SJIS では標準ツールでは見られない。</strong>標準 Edit / Write は SJIS の元バイトを正しく読めないため、SJIS のまま編集しても差分が化ける。<strong>だから「UTF-8 の状態で編集する」</strong>のが差分を得る唯一の道になる。最終バイトは `git diff` でも確認できる。

## 3. 操作べつの手順（決定）

### 作成 — 標準 Write → convert

```
# 対象に直接 UTF-8 で書き、その場で SJIS+CRLF に変換
（標準 Write で foo.cmd を書く）
convert-encoding foo.cmd --to cmd
```

新規は標準 Write が全内容を見せる（＝全部追加の差分）。tmp を挟まず対象に直接書ける。

### 修正 — convert 往復＋標準 Edit（決定＝この方法）

```
convert-encoding foo.cmd --to utf8    # その場で UTF-8 化（改行は変えない。CRLF のまま）
（標準 Edit で foo.cmd を編集 … きれいな差分が出る）
convert-encoding foo.cmd --to cmd     # SJIS+CRLF に戻す
```

> [!CAUTION]
> <strong>編集中は元ファイルが UTF-8 のまま。</strong>途中で中断すると `.cmd` が UTF-8 で残り、日本語入りは正しく動かない。**編集したらすぐ `--to cmd` で戻す**。中断に強くしたいときは tmp コピー版（作業を `tmp/` で行い、元は最後まで SJIS）を使う。

### 削除 — Remove-Item

削除自体は文字コードと無関係。`Remove-Item` を単独コマンド・絶対パスのリテラルで。**消す前に中身を確認するなら `text read`**（標準 Read は SJIS を化かすため）。消してよいのは `tmp/` 配下と自分が作ったものだけ。

### 読む・探す — text

```
text read foo.cmd              # SJIS を化けずに読む（範囲は --lines）
text find 日本語 --path . --recurse --include "*.cmd,*.reg"
```

> [!NOTE]
> <strong>`text edit` / `text write` は補足。</strong>cmd・bat では上の手順で足りる。これらが活きるのは、**数百行以上の非 UTF-8**、重複文字を含む恐れ、差分不要でバイトを厳密に保ちたいとき、reg のように往復編集より直接いじりたいとき。

## 4. 量・速度・差分の知見

### text edit の利点は「行数」では決まらない

効き始める条件は利点ごとに違う。**私たちの cmd（数十行・約 1 KB）では、いずれもほぼ効かない。**

| 利点 | 効き始める条件 | 今の cmd では |
|---|---|---|
| トークン節約 | 全文を読む／書き直すのが無駄になる規模（目安 数百行・数 KB 以上） | 効かない |
| バイト保持 | CP932 の重複文字（550 字）を含むとき。**行数は無関係** | 効かない（普通の漢字・かな） |
| 速度 | 大きいファイルの再エンコードを避けたいとき | 効かない（exe 起動ぶんの差だけ） |

「20/30/50/100 行」で切り替わるわけではなく、<strong>「全部読む・書き直すのが重いほど大きいか」</strong>が本質。`build-html2md-cs.cmd`・`build-text-cs.cmd` とも約 40 行でしきい値のはるか下。

### 差分表示の知見

- <strong>ハーネスのきれいな差分は UTF-8 のファイルでしか成立しない。</strong>SJIS のまま標準 Edit で触ると差分が化ける
- だから「UTF-8 の状態で編集」してから SJIS 化する。最終バイトは `git diff`（バイト差分）で確認できる
- `text edit` はバイト保持に優れるが差分が出ない。差分を見たい今回の方針では、UTF-8 経由の標準 Edit を選ぶ

### 速度の知見

- 標準 Edit / Write が最速（ハーネス内・プロセス起動なし）だが SJIS では使えない
- exe 系（text・convert-encoding）は .NET の起動ぶん数十〜百 ms。小さいファイルなら体感差は小さい
- UTF-8 往復は変換 2 回だが、cmd は小さいので実用上は速い

[^^](../../README.md) ／ [text ツール仕様](p260907-01-text-tools.md)
