@echo off
rem 使い方:
rem   codex-trusted                        # 現在のフォルダを信頼して Codex を起動
rem   codex-trusted N:\example             # 指定したフォルダを信頼して Codex を起動
rem   codex-trusted -NoStart               # 現在のフォルダの信頼設定だけを確認・追加
rem   bin\codex-trusted.cmd N:\example -NoStart
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0codex-trusted.ps1" %*
pause
