@echo off
rem psls: プロセス一覧をツリー表示する。中身は src\process-list\psls-main.ts。
rem
rem bun:ffi で Windows のプロセス情報を直接取得するため、bun が要る
rem （node には bun:ffi の代わりが無いため、node 予備は無い）。
setlocal
where bun >nul 2>&1
if %errorlevel%==0 goto :bun
echo [NG] bun が必要です
exit /b 2

:bun
bun "%~dp0src\process-list\psls-main.ts" %*
exit /b %errorlevel%
