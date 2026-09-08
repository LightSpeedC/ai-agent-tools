@echo off
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0check-contrast.ps1" %*
pause
