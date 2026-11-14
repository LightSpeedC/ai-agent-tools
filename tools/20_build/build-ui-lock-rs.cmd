@echo off
setlocal

rem ---------------------------------------------------------------
rem  ui-lock の Rust 版（src\ui-lock-rs）をビルドする（課題 i261114-01）
rem
rem  出力は src\ui-lock-rs\target\release\ui-lock.exe。bin\ui-lock.cmd ・ bin\ui-lock は
rem  これがあれば使い、無ければ TypeScript 版（bun → node）に落ちる（決定 256-A）。
rem  exe は git に含めない。
rem ---------------------------------------------------------------

where cargo >nul 2>&1
if errorlevel 1 goto :nocargo

cargo build --release --manifest-path "%~dp0..\..\src\ui-lock-rs\Cargo.toml"
if errorlevel 1 goto :failed

echo.
echo [OK] src\ui-lock-rs\target\release\ui-lock.exe を作成しました
for %%f in ("%~dp0..\..\src\ui-lock-rs\target\release\ui-lock.exe") do echo      サイズ: %%~zf バイト
exit /b 0

:nocargo
echo [NG] cargo が見つかりません。Rust を入れてください
exit /b 2

:failed
echo.
echo [NG] ビルドに失敗しました
exit /b 1
