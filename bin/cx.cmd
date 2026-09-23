@rem if exist etc\c.bat etc\c.bat
@set Y=%date:~0,4%
@set YMD=%date:/=%
@if not exist N:\ (
	echo [NG] N: ƒhƒ‰ƒCƒu‚ªŒ©‚Â‚©‚è‚Ü‚¹‚ñ
	exit /b 1
)
cd /d N:\
@if not exist "%Y%" md "%Y%"
@if exist %Y% cd "%Y%"
@if "%~1" == "" exit /b
@if exist "..\*%~1*" (
	cls
	cd "..\*%~1*"
	start "codex" codex-trusted resume --last
) else if exist "*%~1*" (
	cls
	cd "*%~1*"
	start "codex" codex-trusted resume --last
) else (
	cls
	md "%YMD%-%~1"
	cd "%YMD%-%~1"
	start "codex" codex-trusted
)
