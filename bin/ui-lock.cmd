@echo off
rem ui-lock: 画面 ・ マウス ・ キーを使う作業を、全プロジェクトで 1 つずつにする。中身は src\ui-lock\main.ts。
rem
rem bun:ffi で名前付きミューテックスを取るため、bun が要る (node 予備は無い)。
setlocal
where bun >nul 2>&1
if %errorlevel%==0 goto :bun
echo [NG] bun が必要です
exit /b 2

:bun
bun "%~dp0..\src\ui-lock\main.ts" %*
exit /b %errorlevel%
