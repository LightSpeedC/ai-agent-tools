@echo off
rem less: UTF-8 セーフなページャー。DOS の more の文字化けを避ける。
rem 中身は src\less\main.ts。node で走らせる（bun は使わない。
rem 計画 notes\10_plan\i260917-01-less.html の「落とし穴（8）」を参照:
rem bun 同士をパイプで繋ぐと Bun ランタイム自体が文字化けを起こす
rem 未解決のバグがあるため）。
rem
rem if ( ) のブロックの中では %errorlevel% が正しく読めないこと。
rem ブロックは解析時点で展開されるため、実行前の値（0）が返る。
rem そのため goto で行き、終了コードはブロックの外で読む。
setlocal
where node >nul 2>&1
if %errorlevel%==0 goto :node
echo [NG] node が必要です
exit /b 2

:node
node "%~dp0src\less\main.ts" %*
exit /b %errorlevel%
