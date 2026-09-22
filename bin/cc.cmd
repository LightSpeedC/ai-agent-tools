@echo off
@if exist etc\c.bat etc\c.bat
set YMD=%date:/=%& set Y=%date:~0,4%& set XMD=%date:~5,5%
set HMSC=%TIME: =0%& call set XHM=%%HMSC:~0,5%%
if not exist N:\ (
	echo [NG] N: ドライブが見つかりません
	exit /b 1
)
cd /d N:\
if not exist "%Y%" md "%Y%"
if exist %Y% cd "%Y%"
if "%~1" == "" (echo [NG] プロジェクト %~1 はありません。& exit /b)
if exist "..\*%~1*" (
	cd ".."
	call :exec_claude "%~1"
) else if exist "*%~1*" (
	call :exec_claude "%~1"
) else (
	md "%YMD%-%~1"
	cd "%YMD%-%~1"
	start "%%d" claude.exe -n "%YMD%-%~1 %XMD% %XHM%"
)
exit /b

:exec_claude
for /d %%d in ("*%~1*") do (
	cd "%%d"
	node -p "process.cwd() + ' で起動します。'"
	start "%%d" claude.exe -c -n "%%d %XMD% %XHM%"
	exit /b
)
