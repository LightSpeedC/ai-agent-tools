@echo off
rem cc の入口。フォルダを決め、そのフォルダに claude の履歴があれば -c で、無ければ -c なしで、新しい窓で起動する。
rem 窓の環境変数とカレントは変えない (起動と環境の整理は、共通部が子プロセスで行う)。計画: i261101-02
node "%~dp0..\src\agent-launch\main.ts" cc %*
@rem 失敗? --advisor opus --subagents haiku
