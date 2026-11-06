---
schema: 1
id: i261012-01
title: 音声の書き起こしコマンド transcribe を足す
group: 他プロジェクトからの要求
created: 2026-10-12
---

2026-10-12 に `20261004-kamishibai-animation` から依頼（ai-chat-lite #1437）。

- 本体: whisper.cpp v1.9.4（BLAS x64 版）と、モデル `ggml-large-v3-turbo-q5_0.bin`（547MB）
- 置き場: `_vendor/whisper/`（Git の管理外）。依頼元がプロジェクトの外の一時フォルダに置いた中身を移して取り込む
- 形: `transcribe <音声…> [--lang ja] [--model <パス>] [--out <フォルダ>]`
- WAV を 16kHz モノラルに直してから whisper-cli に渡す。複数のファイルは 1 回の起動でまとめて渡す（モデルの読み込みを 1 回にする）
- 結果は、ファイルごとの書き起こしと JSON
- 参考実装は依頼元の一時フォルダにある ts。できたら使い方を返信する

決めること: 受けるか。受けるなら、計画（`notes/10_plan/`）を立てて承認を得てから実装する。プロジェクトの外の一時フォルダの読み取り ・ 移動に許可が要る。

<strong>決めたこと（2026-10-12、利用者の判断）。</strong>受ける。計画は [transcribe 計画](../10_plan/i261012-01-transcribe-whisper-listen.md)。音声は変換せずに渡す（whisper-cli が 16kHz 以外も読むと実測で分かったため）。

- [済] whisper の一式を `_vendor/whisper/` へ移した。参考実装は読んで消した
- [済] `src/transcribe/` と入口 `bin/transcribe` ・ `bin/transcribe.cmd`。テスト `tools/40_test/run-transcribe-tests.ts`（19 件）を先に書き、落ちるのを見てから実装した
- [済] TOOLS-USAGE に使い方と、別の PC での入手方法を書いた
- [済] 報告元の確認（2026-10-12、ai-chat-lite #1442）。依頼元の確認用スクリプトを transcribe を呼ぶ形に直し、27 本で動いた。書き起こしは以前の自前変換と同じ結果
