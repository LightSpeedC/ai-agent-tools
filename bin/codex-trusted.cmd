@echo off
rem 使い方:
rem   codex-trusted                        # 現在のフォルダを信頼して Codex を起動
rem   codex-trusted resume                 # セッションを選んで再開
rem   codex-trusted resume --last          # 前回のセッションを再開
rem   codex-trusted exec --help            # Codex の引数をそのまま渡す
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0codex-trusted.ps1" %*
pause
