@echo off
rem check-public: 公開前に、外に出してはいけないものが混ざっていないかを見る。
rem 中身は src\check-public\main.ts。bun を優先し、無ければ node で走らせる。
rem
rem if ( ) のブロックの中で %errorlevel% を見ないこと。
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
bun "%~dp0..\src\check-public\main.ts" %*
exit /b %errorlevel%

:node
node "%~dp0..\src\check-public\main.ts" %*
exit /b %errorlevel%
