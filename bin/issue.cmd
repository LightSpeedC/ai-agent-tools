@echo off
rem issue: 課題管理ツール。課題を 1 件 1 ファイルで持ち、検査する (いまは check まで)。
rem 中身は src\issue\main.ts。bun を優先し、無ければ node で走らせる。
rem
rem if ( ) のブロックの中で %errorlevel% を見ないこと。
rem ブロックを解析した時点で展開されるため、実行前の値 (0) が返る。
rem 分岐は goto で行い、終了コードはブロックの外で読む。
rem
rem 終了コードに 2 を使わない。Stop フックが 2 を「続ける」と読むため。
setlocal
where bun >nul 2>&1
if %errorlevel%==0 goto :bun
where node >nul 2>&1
if %errorlevel%==0 goto :node
echo [NG] bun か node が必要です
exit /b 1

:bun
bun "%~dp0..\src\issue\main.ts" %*
exit /b %errorlevel%

:node
node "%~dp0..\src\issue\main.ts" %*
exit /b %errorlevel%
