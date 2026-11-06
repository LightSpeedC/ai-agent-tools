---
schema: 1
id: i260912-06
title: PowerShell ツールが使えない。exe の標準出力が CP932 で Bash から化ける
group: 運用・方針の決定事項
created: 2026-09-12
---

2026-09-12 に発覚。PowerShell ツールがセッションで無効になり、Bash から exe を呼んだところ<strong>日本語が化けた。</strong>バイト列で確かめた結果は次のとおり。

| 出力元 | 先頭バイト | 文字コード |
|---|---|---|
| `html2md`（`Console.WriteLine`） | `81 A8` ＝「→」 | **CP932** |
| `convert-encoding --check`（`WriteStdout`） | `E8 A6 8F` ＝「規」 | **UTF-8** |
| `node` ・ `bun` | `E5 A4 89` ＝「変」 | **UTF-8** |

**原因は .NET Framework。**`Console.OutputEncoding` の既定がコンソールの出力コードページで、日本語 Windows では 932 になる。**Node と Bun はコードページを見ず、常に UTF-8 で書く。**

> [!IMPORTANT]
> **`convert-encoding` は同じコマンドの中で混在している。**`--read` ・ `--dump` ・ フォルダの `--info` ・ `--check` は `WriteStdout` で UTF-8、それ以外（変換結果の行・`--help` ・ 1 ファイルの `--info`）は `Console.WriteLine` で CP932。**どちらで出るかが引数で変わる。**

いままで気づかなかったのは、Windows PowerShell 5.1 が外部コマンドの出力を CP932 として読むため**ずれが打ち消し合っていた**から。Bash は UTF-8 前提なので露見した。

### そもそも Bash から呼ぶことになった理由

<strong>Claude Code 2.1.269 の Windows 版から、PowerShell ツールが使えなくなった。</strong>再開したセッションでも、新しく始めたセッションでも同じ。設定は変えていない。

| 確かめたこと | 結果 |
|---|---|
| ツールの有無 | 一覧にも、遅延ロードにも、名前での検索にも無い |
| MCP 由来か | 違う。接続は Microsoft 365 だけ |
| 設定を変えたか | 変えていない。ツールを止める記述は無い |
| リリースノート | <strong>削除の記載は無い。</strong>2.1.269 は逆に「PowerShell tool commands sent to the background」を**修正**している |
| 環境の記述 | <strong>いまも「Shell: PowerShell (primary)」と言っている。</strong>実際のツール一覧と食い違う |

不具合として報告済み。**戻るまでは Bash から呼ぶしかない。**

### ✅ **済** 当て木を作った（psh）

Bash から PowerShell を呼ぶと 2 つ困る。**出力が化けること**と、`-Command` に文字列を渡すと**クォートが二重に解釈されること**（エラーにならず、静かに違う内容で動く）。`tools/50_run/psh.ts` がその両方を引き受ける。

```shell
tools/50_run/psh <path.ps1> [引数...]
tools/50_run/psh --command "<式>"
```

| やること | やり方 |
|---|---|
| クォート事故を防ぐ | 子プロセスを**配列で起動する**（シェルを挟まない）。ps1 は `-File` で渡し、解釈を 1 段に留める |
| 文字化けを直す | 受け取ったバイト列を**まず UTF-8 として厳密に読み、読めなければ CP932 として読み直す** |
| 契約を保つ | 終了コードを素通し。標準出力と標準エラーを混ぜない |

> [!IMPORTANT]
> <strong>決め打ちの変換ではうまくいかない。</strong>PowerShell 自身の出力（`Write-Host` 等）は UTF-8、そこから呼んだ .NET 製 exe は CP932 で、<strong>1 回の実行で両方が混ざる。</strong>最初 CP932 固定で書いて、PowerShell 側の日本語をすべて壊した。判定して読み分ける形に直した。

テストは `tools/40_test/run-psh-tests.ts` に 13 件。**ここだけ ts で書いている**——道具自体が PowerShell を呼ぶので、テストまで ps1 にすると道具が壊れたときにテストも動かせない。混在の再現（PowerShell から exe を呼ぶ）も回帰に入れた。

### 決めること

- [済] **exe 側を UTF-8 に揃えるかどうか**——<strong>揃えずに移植した。</strong>捨てる予定のコードに手を入れるより、移すほうが早く根本解決する
- [済] **Bun へ移して根本から消した。**`convert-encoding` ・ `text` ・ `html2md` の 3 本とも TypeScript になり、**Bash から直接呼んでも化けない**（実測）。進め方と結果は [bun への移植](../10_plan/p260912-02-bun移植.md)
- [済] <strong>psh を消す時期は取り下げ。</strong>ずっと残す（利用者の判断）

✅ **済** **この課題を閉じる。**「決めること」3件がすべて済んだため。前の2件は Bun への移植で根本解決し、残っていたのは「psh を消す時期」だけだった。**PowerShell ツールが戻れば要らなくなる、という条件付きの未決事項**だったが、2026-09-16 に利用者が「ずっと残す」と判断したことで、条件を待つ必要が無くなった。
