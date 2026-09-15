@rem if exist etc\c.bat etc\c.bat
@set Y=%date:~0,4%
@set YMD=%date:/=%
cd /d N:\
@if not exist "%Y%" md "%Y%"
@if exist %Y% cd "%Y%"
@if "%~1" == "" exit /b
@if exist "..\*%~1*" (
	cls
	cd "..\*%~1*"
	call codex resume --last
) else if exist "*%~1*" (
	cls
	cd "*%~1*"
	call codex resume --last
) else (
	cls
	md "%YMD%-%~1"
	cd "%YMD%-%~1"
	call codex
)
