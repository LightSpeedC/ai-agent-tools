@echo off
setlocal

rem ---------------------------------------------------------------
rem  xx（src\xx）をビルドして、bin\xx.exe へ写す（計画 p261027-01）
rem
rem  出力は src\xx\target\release\xx.exe。それを bin\xx.exe へ写す。
rem  exe は git に含めない（.gitignore の *.exe）。
rem ---------------------------------------------------------------

where cargo >nul 2>&1
if errorlevel 1 goto :nocargo

cargo build --release --manifest-path "%~dp0..\..\src\xx\Cargo.toml"
if errorlevel 1 goto :failed

copy /y "%~dp0..\..\src\xx\target\release\xx.exe" "%~dp0..\..\bin\xx.exe" >nul
if errorlevel 1 goto :copyfailed

echo.
echo [OK] bin\xx.exe を作成しました
for %%f in ("%~dp0..\..\bin\xx.exe") do echo      サイズ: %%~zf バイト
exit /b 0

:nocargo
echo [NG] cargo が見つかりません。Rust を入れてください
exit /b 2

:failed
echo.
echo [NG] ビルドに失敗しました
exit /b 1

:copyfailed
echo.
echo [NG] bin\xx.exe へ写せません。動いている xx があれば、終わってからやり直してください
exit /b 1
