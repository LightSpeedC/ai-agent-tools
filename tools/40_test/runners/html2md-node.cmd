@echo off
rem テストで node 側も回すための当て木。
rem 本番のランチャー（root の html2md.cmd）は bun を優先するため、
rem bun が入っている環境では node で 1 ケースも回らない。
rem テストの -Target にこれを渡すと node で回る。
node "%~dp0..\..\..\src\html2md\main.ts" %*
exit /b %errorlevel%
