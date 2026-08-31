@echo off
rem  参照実装の html2md.ps1 を実行する（通常は html2md.exe を使う）
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0html2md.ps1" %*
pause