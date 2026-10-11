@echo off
rem transcribe: 音声を whisper.cpp で書き起こす。
rem 中身は src\transcribe\transcribe-main.ts。bun を優先し、無ければ node で走らせる。
rem whisper-cli とモデルは _vendor\whisper\ に置く（Git の管理外）。
rem
rem if ( ) のブロックの中で %errorlevel% を書かないこと。
rem ブロックを解析した時点で展開されるため、実行前の値（0）が返る。
rem 分岐は goto で行い、終了コードはブロックの外で読む。
setlocal
where bun >nul 2>&1
if %errorlevel%==0 goto :bun
where node >nul 2>&1
if %errorlevel%==0 goto :node
echo [NG] bun か node が必要です
exit /b 2

:bun
bun "%~dp0..\src\transcribe\transcribe-main.ts" %*
exit /b %errorlevel%

:node
node "%~dp0..\src\transcribe\transcribe-main.ts" %*
exit /b %errorlevel%
