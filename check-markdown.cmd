@echo off
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0check-markdown.ps1" %*
pause
