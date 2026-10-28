@echo off
rem CC_ROOT は試験用の置き場の差し替え。ふだんは W:\
if not defined CC_ROOT set "CC_ROOT=W:\"
set YMD=%date:/=%& set Y=%date:~0,4%& set XMD=%date:~5,5%
set HMSC=%TIME: =0%& call set XHM=%%HMSC:~0,5%%
if not exist "%CC_ROOT%" (
	echo [NG] %CC_ROOT% が見つかりません
	exit /b 1
)
cd /d "%CC_ROOT%"
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
	call :launch "%YMD%-%~1" "" "%YMD%-%~1 %XMD% %XHM%"
)
exit /b

:exec_claude
for /d %%d in ("*%~1*") do (
	cd "%%d"
	node -p "process.cwd() + ' で起動します。'"
	call :launch "%%d" "-c" "%%d %XMD% %XHM%"
	exit /b
)

rem claude を起こす。%1=窓の題 %2=追加の引数（続きから開くなら -c） %3=セッション名
rem 起こす前に、(1) 今のフォルダを ~/.claude.json に登録する（初回の信頼の確認を出さない。失敗しても起動する）
rem (2) CLAUDE で始まる環境変数を、CLAUDE_CODE_USE_POWERSHELL_TOOL 以外すべて消す。
rem Claude Code の中から cc を呼んでも、親のセッションの値を子に渡さないため。
rem 消すのは setlocal の中だけ。cc を動かした窓の環境変数は変わらない
:launch
node "%~dp0..\src\cc-register\main.ts" "%CD%"
setlocal
for /f "delims==" %%a in ('set CLAUDE 2^>nul') do if /i not "%%a"=="CLAUDE_CODE_USE_POWERSHELL_TOOL" set "%%a="
start %1 claude.exe %~2 -n %3
endlocal
exit /b
@rem 失敗? --advisor opus --subagents haiku
