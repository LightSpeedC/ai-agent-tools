@echo off
rem 使い方:
rem   ag-trusted                                          現在のフォルダを信頼して agy を起動
rem   ag-trusted --dangerously-skip-permissions -c        agy の引数をそのまま渡す
rem 設定ファイルが無い・壊れているときは、書かずに終了コード 3 で止まる。計画: i261101-02
node "%~dp0..\src\ag-trusted\main.ts" %*
