# convert-audio 計画（ffmpeg で音声の形式を変える）

WAV 等の音声を ffmpeg で mp3 等に変える共有コマンド `convert-audio` を足す（i261012-02）。

> 📅 作成: 2026-10-12 / 更新: 2026-10-12

[^^](../../README.md)

## 目次

1. [背景](#1-背景)
2. [置き場と入手](#2-置き場と入手)
3. [コマンドの仕様](#3-コマンドの仕様)
4. [決めること](#4-決めること)
5. [進め方とテスト](#5-進め方とテスト)

## 1. 背景

2026-10-12 に `20261004-kamishibai-animation` から依頼（ai-chat-lite #1439、[課題 i261012-02](../40_issues/issues.html)）。事前生成の WAV（108 本、33MB）を mp3 にして、配信の容量を減らしたい。

transcribe（[i261012-01](i261012-01-transcribe-whisper-listen.md)）の 16kHz への変換に使う案もあったが、whisper-cli が自分で直すと実測で分かったため、**transcribe からは使わない**。

## 2. 置き場と入手

| もの | 置き場 | Git |
|---|---|---|
| ffmpeg.exe | `_vendor/ffmpeg/` の下 | 管理外（先頭 `_`） |
| 入手した zip と `.sha256` | `_vendor/ffmpeg/dl/` | 管理外 |
| 本体 | `src/convert-audio/convert-audio-main.ts` | 管理 |
| 入口 | `bin/convert-audio` ・ `bin/convert-audio.cmd` | 管理 |
| テスト | `tools/40_test/run-convert-audio-tests.ts` | 管理 |

### 入手方法

**入手は ai-agent-tools 側で行う**（2026-10-12、利用者の判断）。使う側の資料（TOOLS-USAGE）には書かない。

- 入手先: gyan.dev の release essentials ビルド。2026-10-12 時点で 9.0.2（2026-09-19）、zip は 109MB
- essentials に mp3 のエンコーダ（libmp3lame）が入っている。64bit ・ 静的リンク。ライセンスは GPLv3
- **入手したら `.sha256` と照合してから展開する**。合わなければ展開しない
- zip の中は版の名前のフォルダ（`ffmpeg-9.0.2-essentials_build/bin/ffmpeg.exe` 等、未確認）。convert-audio は `_vendor/ffmpeg/` の下から `ffmpeg.exe` を探す。transcribe と同じ形

```text
https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip
https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip.sha256
```

> [!IMPORTANT]
> <strong>この URL は常に最新版を指す。</strong>入手した日によって版が変わる。入手した版は、展開したフォルダの名前と `ffmpeg -version` で控える。

## 3. コマンドの仕様

```text
convert-audio <音声…> --to mp3 [--bitrate <kbps>] [--rate <Hz>] [--mono] [--out <フォルダ>]
```

- `--to` は必須。受ける形は決めること 1
- `--bitrate`: mp3 の固定ビットレート（kbps）。既定は決めること 2
- `--rate`: 出力のサンプリング周波数。省くと元のまま
- `--mono`: モノラルにする。省くと元のまま
- `--out`: 出し先。省くと音声と同じフォルダ（transcribe と揃える）。名前は拡張子だけを変える
- **出力が既にあれば上書きしない**（決めること 3）。入力と出力が同じファイルになる指定は誤りにする
- 標準出力には出したファイルの一覧だけを出す。ffmpeg の進捗は標準エラーへ
- 終了コード: 0 成功 ／ 1 変換の失敗 ／ 2 引数の誤り、ffmpeg ・ 音声が無い
- ffmpeg は 1 ファイルにつき 1 回起動する（transcribe と違い、まとめて渡す利点が小さい）

## 4. 決めること

#### 1. `--to` で受ける形

- **1-A（推奨）**: `mp3` と `wav` だけ。推す理由: 依頼は mp3 で、wav は元に戻す ・ 周波数を変えるのに要る。ほかは要るときに足す
- **1-B**: `mp3` ・ `wav` ・ `ogg` ・ `m4a` ・ `flac`。essentials で書けるものを広く受ける

#### 2. `--bitrate` を省いたときの値

- **2-A（推奨）**: 64kbps。推す理由: 依頼の音声は読み上げの声で、声なら 64kbps でも聞き取りに差が出にくく、容量の削減が目的に合う
- **2-B**: 128kbps。音楽にも通る一般的な値

#### 3. 出力が既にあるとき

- **3-A（推奨）**: 止める。`--force` で上書きする。推す理由: 元の WAV から作り直す前提でも、誤って別の出力を消さない
- **3-B**: 常に上書きする。作り直すのが手軽

## 5. 進め方とテスト

1. 決めることの承認を得る
2. ffmpeg を入手し、`.sha256` と照合して `_vendor/ffmpeg/` に展開する。版を控える
3. テストを先に書く。落ちるのを見てから実装する
4. 実装し、全件のテストを通す
5. TOOLS-USAGE に使い方を書く（入手方法は書かない）。README の一覧に足す
6. 依頼元へ使い方を返信する。報告元の確認が取れたら課題を済にする

### テスト

- **ffmpeg を要らないもの**: 引数の解釈、ffmpeg に渡す引数の組み立て、出力名、上書きしないこと、ffmpeg ・ 音声が無いときの終了コード 2 と案内
- **ffmpeg を要るもの**: 合成した WAV（24kHz ステレオ）を mp3 にし、`ffmpeg` で読み直して、ビットレート ・ 周波数 ・ チャンネル数が指定どおりであること。`_vendor/ffmpeg/` が無ければ ⬜ 未実施として飛ばし、件数を報告に出す

[^^](../../README.md)
