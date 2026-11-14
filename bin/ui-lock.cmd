@echo off
rem ui-lock: 画面 ・ マウス ・ キーを使う作業を、全プロジェクトで 1 つずつにする。
rem
rem Rust 版（src\ui-lock-rs\target\release\ui-lock.exe）があればそれを使う（決定 256-A）。
rem 無ければ TypeScript 版（src\ui-lock\main.ts）を bun、bun も無ければ node で動かす。
rem exe は tools\20_build\build-ui-lock-rs.cmd で作る。git には含めない。
setlocal
if exist "%~dp0..\src\ui-lock-rs\target\release\ui-lock.exe" goto :exe
where bun >nul 2>&1
if %errorlevel%==0 goto :bun
where node >nul 2>&1
if %errorlevel%==0 goto :node
echo [NG] ui-lock.exe ・ bun ・ node のどれも見つかりません
exit /b 2

:exe
"%~dp0..\src\ui-lock-rs\target\release\ui-lock.exe" %*
exit /b %errorlevel%

:bun
bun "%~dp0..\src\ui-lock\main.ts" %*
exit /b %errorlevel%

:node
node "%~dp0..\src\ui-lock\main.ts" %*
exit /b %errorlevel%
