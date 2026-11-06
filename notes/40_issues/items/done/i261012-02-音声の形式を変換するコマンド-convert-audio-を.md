---
schema: 1
id: i261012-02
title: 音声の形式を変換するコマンド convert-audio を足す
group: 他プロジェクトからの要求
created: 2026-10-12
---

2026-10-12 に `20261004-kamishibai-animation` から依頼（ai-chat-lite #1439）。

- 本体: ffmpeg（Windows 用の配布物）。置き場は `_vendor/ffmpeg/`（Git の管理外）。入手もこちらで行う
- 形: `convert-audio <音声…> --to mp3 [--bitrate <kbps>] [--rate <Hz>] [--mono] [--out <フォルダ>]`
- 用途: 依頼元の事前生成の WAV（108 本、33MB）を mp3 にして配信の容量を減らす
- transcribe（i261012-01）の 16kHz への変換も、これを使う形にできるなら合わせて検討する
- できたら使い方を返信する

決めること: 受けるか。受けるなら、transcribe の計画の「WAV への変換の方法」（自前か ffmpeg か）と合わせて決める。ffmpeg の入手元と版。

<strong>決めたこと（2026-10-12、利用者の判断）。</strong>受ける。ffmpeg は ai-agent-tools 側で入手して取り込む。transcribe は ffmpeg を使わない（whisper-cli が自分で 16kHz に直す）。計画は [convert-audio 計画](../10_plan/i261012-02-convert-audio-ffmpeg.md)。形式は mp3 ・ ogg ・ m4a ・ flac ・ wav、ビットレートの既定は 64kbps、既にある出力は `--force` が無ければ上書きしない。

- [済] ffmpeg 9.0.2 essentials を入手し、SHA-256 を照合して `_vendor/ffmpeg/` に展開した
- [済] `src/convert-audio/` と入口 `bin/convert-audio` ・ `bin/convert-audio.cmd`。テスト `tools/40_test/run-convert-audio-tests.ts`（24 件）を先に書き、落ちるのを見てから実装した
- [済] TOOLS-USAGE に使い方を書いた（入手方法は計画書だけに置く）
- [済] 報告元から不具合 1（ai-chat-lite #1445）: 既にあるフォルダを `..` を含む相対パスで `--out` に渡すと EEXIST で落ちる。**bun だけの挙動**（node と絶対パスでは起きない）。絶対パスにしてから作るよう直した。transcribe にも同じ書き方があり、一緒に直した。両方にテストを足し、bun で落ちるのを見てから直した
- [済] 報告元から不具合 2（#1445）: 絶対パスで 108 本を一度に渡すと `The command line is too long.` で落ちる。cmd の入口を通るため、cmd の 1 行の上限（8191 文字）に当たったと見られる（未確認）。transcribe も同じ。**決めたこと（2026-10-12、利用者の判断）**: 一覧ファイル（`--list`）とフォルダ（`--dir` ＋ `--ext`）の両方を足す。5-A ・ 6-A ・ 7-A。両方のツールに付け、テストを足した（❌Red → ✅Green）。報告元が `--list` で 108 本を 1 回で変換できたことを確かめた（#1449）
- [済] 報告元から要望（#1449）: 成功時も ffmpeg の進捗ログが 1 本ごとに標準エラーへ出て、108 本で約 1500 行になる。失敗時だけ出す形にできないか。**決めたこと（2026-10-12、利用者の判断）**: 既定では出さない。エラーは詳しく出す。`--verbose` を付けると、1 本ずつ出す。2026-10-14 に transcribe も同じ形にそろえると決めた（10-A）。**両方とも実装した**。テストを先に書き ❌Red（convert-audio 4 件 ・ transcribe 3 件）→ ✅Green（41 件 ・ 28 件）
- [済] 報告元の確認（#1513）: 108 本を `--list` で変換し、終了コード 0、標準エラー 0 行、標準出力は出したファイルの一覧 108 行だけだった
