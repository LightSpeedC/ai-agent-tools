@echo off
rem cx の入口。フォルダを決め、そのフォルダに codex の履歴があれば resume で、無ければ resume なしで、新しい窓で起動する。
rem 窓の環境変数とカレントは変えない (起動と環境の整理は、共通部が子プロセスで行う)。計画: i261101-02
cls
node "%~dp0..\src\agent-launch\main.ts" cx %*
