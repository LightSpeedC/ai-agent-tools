@echo off
setlocal

rem ---------------------------------------------------------------
rem  psh の Rust 版（src\psh-rs）をビルドする（計画 p260929-01）
rem
rem  出力は src\psh-rs\target\release\psh.exe。bin\psh.cmd ・ bin\psh は
rem  これがあれば使い、無ければ TypeScript 版（bun → node）に落ちる。
rem  exe は git に含めない（i260830-16）。
rem ---------------------------------------------------------------

where cargo >nul 2>&1
if errorlevel 1 goto :nocargo

cargo build --release --manifest-path "%~dp0..\..\src\psh-rs\Cargo.toml"
if errorlevel 1 goto :failed

echo.
echo [OK] src\psh-rs\target\release\psh.exe を作成しました
for %%f in ("%~dp0..\..\src\psh-rs\target\release\psh.exe") do echo      サイズ: %%~zf バイト
exit /b 0

:nocargo
echo [NG] cargo が見つかりません。Rust を入れてください
exit /b 2

:failed
echo.
echo [NG] ビルドに失敗しました
exit /b 1
