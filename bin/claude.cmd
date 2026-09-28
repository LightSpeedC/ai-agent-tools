@echo %~dp0claude %*
@if not "%CD:~0,2%" == "W:" (echo %CD% ⇒ エラー。カレントディレクトリが違います。ここで実行せずW:で実行してね。& exit /b 1)
@cls & claude.exe %*
