# transcribe 計画（whisper で音声を聞き取る）

音声ファイルを whisper.cpp で聞き取り、ファイルごとの書き起こしと JSON を出す共有コマンド `transcribe` を足す（i261012-01）。

> 📅 作成: 2026-10-12 / 更新: 2026-10-12

[^^](../../README.md)

## 目次

1. [背景](#1-背景)
2. [置き場と実装方式](#2-置き場と実装方式)
3. [コマンドの仕様](#3-コマンドの仕様)
4. [決めること](#4-決めること)
5. [進め方とテスト](#5-進め方とテスト)

## 1. 背景

2026-10-12 に `20261004-kamishibai-animation` から依頼（ai-chat-lite #1437、[課題 i261012-01](../40_issues/issues.html)）。音声の書き起こしを、各プロジェクトが個別に whisper を呼ぶのではなく、共有ツールから名前で呼べるようにする。

- 本体は whisper.cpp v1.9.4（BLAS x64 版）の `whisper-cli`
- モデルは `ggml-large-v3-turbo-q5_0.bin`（547MB）
- 依頼元は、自分の確認用スクリプトを `transcribe` を呼ぶ形に直す予定

## 2. 置き場と実装方式

| もの | 置き場 | Git |
|---|---|---|
| whisper-cli と DLL | `_vendor/whisper/bin/` | 管理外（先頭 `_`） |
| モデル | `_vendor/whisper/model/` | 管理外 |
| 本体 | `src/transcribe/transcribe-main.ts` | 管理 |
| 入口 | `bin/transcribe` ・ `bin/transcribe.cmd` | 管理 |
| テスト | `tools/40_test/run-transcribe-tests.ts` | 管理 |

- **TypeScript で書き、入口はほかのツールと同じく bun を優先し、無ければ node**
- **whisper-cli とモデルは Git に入れない**。`_vendor/whisper/` が無い PC ・ クラウドでは、置き場を示すエラーで止める
- 取り込みは、依頼元がプロジェクトの外の一時フォルダに置いたものを**移動**する（元に残さない、が依頼の条件）

### 別の PC での入手方法

`_vendor/` は Git に入らないため、ほかの PC では次から入手して同じ置き場に展開する（2026-10-12 に GitHub API ・ 配布ページで確認）。**入手は ai-agent-tools 側で行う**（2026-10-12、利用者の判断）。使う側の資料（TOOLS-USAGE）には入手方法を書かず、依頼してもらう。

| もの | 入手先 | 展開先 |
|---|---|---|
| whisper-cli（BLAS x64 版） | whisper.cpp の GitHub Releases。**v1.9.4 のタグ自体には配布物が無く、同じ日に出た b5130 に付いている**。`whisper-blas-bin-x64.zip`（約 21MB） | `_vendor/whisper/bin/` |
| モデル | Hugging Face の `ggerganov/whisper.cpp` の `ggml-large-v3-turbo-q5_0.bin`（ページの表示は 574MB。依頼の 547MB は MiB での値と見られる） | `_vendor/whisper/model/` |

```text
https://github.com/ggml-org/whisper.cpp/releases/download/b5130/whisper-blas-bin-x64.zip
https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-large-v3-turbo-q5_0.bin
```

- **zip の中のフォルダ構成と、依頼元が置いた `bin/Release/` との対応は、取り込みのときに確かめる**。transcribe は `_vendor/whisper/` の下から `whisper-cli.exe` を探す形にし、zip の構成の違いに左右されないようにする
- 新しい版（2026-10-12 時点で v1.9.5 ＝ b5454）もある。版を上げるときは、配布物がビルド番号のタグ側に付く点に注意する
- **取り込んだ一式の構成（2026-10-12）**: `_vendor/whisper/bin/Release/whisper-cli.exe` ・ `_vendor/whisper/model/` ・ `_vendor/whisper/dl/whisper-blas-bin-x64.zip`（入手した zip そのもの。大きさが b5130 の配布物とバイト数まで一致した）

## 3. コマンドの仕様

```text
transcribe <音声…> [--lang ja] [--model <パス>] [--out <フォルダ>]
```

1. **音声は変換せずに、そのまま whisper-cli に渡す**（決めたこと 1-C）
2. **全ファイルを 1 回の whisper-cli の起動でまとめて渡す**（モデルの読み込みを 1 回にする）。`-f <音声> -of <出力名>` を組で並べる
3. ファイルごとに書き起こし（`.txt`）と JSON（`.json`）を出す。名前は元の音声の拡張子を除いたもの

- `--model` の既定は `_vendor/whisper/model/ggml-large-v3-turbo-q5_0.bin`
- 終了コード: 0 成功 ／ 1 書き起こしの失敗 ／ 2 引数の誤り ・ whisper-cli かモデルが無い
- whisper-cli の進捗は標準エラーへ流し、標準出力には出したファイルの一覧だけを出す

> [!NOTE]
> <strong>実測（2026-10-12、b5130）。</strong>whisper-cli は内蔵の miniaudio で音声を読み、16kHz 以外（24kHz ・ ステレオ）の WAV もそのまま受けた。`-f` と `-of` を組で 2 つ並べると、1 回の起動でファイルごとに `.txt` ・ `.json` が出た。**無音を渡すと「ご視聴ありがとうございました」と書き起こす**（whisper が無音から文を作る、よく知られた現象）。mp3 等を受けるかは未確認。

## 4. 決めること

<strong>決めたこと（2026-10-12、利用者の判断）。</strong>1-C ・ 2-A ・ 3-A。4 は許可。いったん 1-B を選んだが、whisper-cli が 16kHz 以外も読むと実測で分かり、1-C に選び直した。

#### 1. WAV への変換の方法

- **1-C（採用）**: 変換せず、そのまま whisper-cli に渡す。実測で変換が要らないと分かった。作るものと頼る道具が最も少ない。恒久
- **1-A**: TypeScript で自前に変換する（WAV の読み込み ・ モノラル化 ・ 16kHz への再標本化）。推す理由: 依頼の入力は WAV で、外部の道具（ffmpeg）を足さずに済む。WAV 以外はエラーにする。恒久
- **1-B**: ffmpeg に任せる。mp3 等も受けられるが、ffmpeg を各 PC に入れる必要がある。恒久

#### 2. `--out` を省いたときの出し先

- **2-A（推奨）**: 音声と同じフォルダ。推す理由: 複数のフォルダの音声を渡しても、どれの結果か迷わない
- **2-B**: カレントフォルダ

#### 3. `--lang` を省いたときの言語

- **3-A（推奨）**: `ja`。推す理由: 依頼の書き方が `[--lang ja]` で、使う側はほぼ日本語
- **3-B**: `auto`（whisper の自動判定）

#### 4. プロジェクトの外の一時フォルダへの操作の許可

依頼元が置いた whisper 一式を `_vendor/whisper/` へ移すことと、参考実装の ts を読み、読み終えたら消すこと。**どちらもプロジェクトの外なので、許可を得てから行う**（共通ルール「プロジェクトフォルダ外へのアクセス」）。

## 5. 進め方とテスト

1. 許可を得て、参考実装を読み、whisper 一式を `_vendor/whisper/` へ移す。`whisper-cli --help` で、まとめて渡す方法と出力の指定を実測する
2. テストを先に書く（下記）。落ちるのを見てから実装する
3. 実装し、全件のテストを通す
4. TOOLS-USAGE に使い方を書く。README の一覧に足す
5. 依頼元へ使い方を返信する。報告元の確認が取れたら課題を済にする

### テスト

- **whisper を要らないもの**（どこでも回る）: 引数の解釈、whisper-cli に渡す引数の組み立て、出し先と出力名、whisper-cli ・ モデル ・ 音声が無いときの終了コード 2 と案内
- **whisper を要るもの**: 合成した無音の WAV 2 本（16kHz モノラル ・ 24kHz ステレオ）を 1 回で書き起こし、`.txt` と `.json` がファイルごとに出ること。**無音は文を作ってしまうので、中身は見ずに、ファイルが出たことだけを見る**。`_vendor/whisper/` が無ければ ⬜ 未実施として飛ばし、件数を報告に出す

[^^](../../README.md)
