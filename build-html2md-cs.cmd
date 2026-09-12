@echo off
setlocal enabledelayedexpansion
cd /d "%~dp0"

rem ---------------------------------------------------------------
rem  html2md-cs.exe をビルドする
rem
rem  Roslyn 版の csc.exe があればそれを使い、無ければ Windows 標準の
rem  .NET Framework 4.8 の csc.exe を使う。標準搭載版は C# 5 相当なので、
rem  ソースは C# 5 の範囲で書いている。
rem ---------------------------------------------------------------

set "CSC="

rem Visual Studio 同梱の Roslyn を探す
for %%d in ("%ProgramFiles%\Microsoft Visual Studio" "%ProgramFiles(x86)%\Microsoft Visual Studio") do (
	if exist "%%~d" (
		for /f "delims=" %%p in ('dir /b /s "%%~d\csc.exe" 2^>nul ^| findstr /i "\\Roslyn\\csc.exe"') do (
			if not defined CSC set "CSC=%%p"
		)
	)
)

rem 無ければ Windows 標準搭載のものを使う
if not defined CSC set "CSC=%WINDIR%\Microsoft.NET\Framework64\v4.0.30319\csc.exe"

if not exist "%CSC%" (
	echo [NG] csc.exe が見つかりません: %CSC%
	exit /b 2
)

echo コンパイラ: %CSC%
echo.

"%CSC%" /nologo /target:exe /platform:anycpu /optimize+ /warnaserror- /utf8output ^
	/out:"%~dp0html2md-cs.exe" "%~dp0src\Html2MdCs\*.cs"

if errorlevel 1 (
	echo.
	echo [NG] ビルドに失敗しました
	exit /b 1
)

echo.
echo [OK] html2md-cs.exe を作成しました
for %%f in ("%~dp0html2md-cs.exe") do echo      サイズ: %%~zf バイト
exit /b 0
