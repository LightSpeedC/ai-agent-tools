@echo %~dp0claude %*
@if not "%CD:~0,7%" == "C:\work" (echo %CD% ⇒ エラー。カレントディレクトリが違います。ここで実行せずC:\workで実行してね。& exit /b 1)
@cls & claude.exe %*
