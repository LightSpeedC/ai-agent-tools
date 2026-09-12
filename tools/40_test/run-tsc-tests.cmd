@echo off
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0run-tsc-tests.ps1"
pause
