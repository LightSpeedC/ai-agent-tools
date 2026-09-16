@echo off
rem less: UTF-8 セーフなページャー。DOS の more の文字化けを避ける。
rem 中身は src\less\main.ts。bun を優先し、無ければ node で走らせる。
rem
rem if ( ) のブロックの中では %errorlevel% が正しく読めないこと。
rem ブロックは解析時点で展開されるため、実行前の値（0）が返る。
rem そのため goto で行き、終了コードはブロックの外で読む。
setlocal
where bun >nul 2>&1
if %errorlevel%==0 goto :bun
where node >nul 2>&1
if %errorlevel%==0 goto :node
echo [NG] bun か node が要ります
exit /b 2

:bun
bun "%~dp0src\less\main.ts" %*
exit /b %errorlevel%

:node
node "%~dp0src\less\main.ts" %*
exit /b %errorlevel%
