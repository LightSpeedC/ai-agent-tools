@echo off
rem cc ・ cx ・ ag の、新しい窓の中で動く番人。エージェントを起動し、終わるたびに R (再起動) か Q (終了) を尋ねる。
rem 入力は環境変数 (共通部が渡す): KEEPER_EXE (起こすコマンド) ・ KEEPER_FIRST (最初の引数) ・ KEEPER_AGAIN (再起動の引数)。
rem エージェントに渡さないよう、起こす行の中で消す。行の中の %変数% は、先に展開されてから、そのあとの set が消す。
rem setlocal の中で消し、終わったら endlocal で戻すので、2 回目以降の再起動にも値が残る。
rem 答えが読めないとき (choice が 255 を返す) は、再起動せずに終わる (無限に回らない)。
rem エージェントは call で呼ぶ。codex-trusted ・ ag-trusted は cmd なので、call が無いと、終わっても戻ってこない。
rem 常駐も node ・ bun の番人も作らない (90-A)。計画: i261101-02
setlocal
set "KP_EXE=%KEEPER_EXE%"
set "KP_ARGS=%KEEPER_FIRST%"
set "KP_AGAIN=%KEEPER_AGAIN%"
set "KP_NOASK=%KEEPER_NOASK%"
set "KEEPER_EXE="
set "KEEPER_FIRST="
set "KEEPER_AGAIN="
set "KEEPER_NOASK="
:run
setlocal
set "KP_EXE=" & set "KP_ARGS=" & set "KP_AGAIN=" & set "KP_NOASK=" & call %KP_EXE% %KP_ARGS%
endlocal
echo.
echo 終了しました (終了コード %errorlevel%)。
rem KEEPER_NOASK (試験だけが渡す。非表示の窓では choice が答えを待ち続けて残るため) があれば、尋ねずに終わる
if defined KP_NOASK goto :end
:ask
choice /c RQ /n /m "R で再起動 / Q で終了: "
if errorlevel 2 goto :end
set "KP_ARGS=%KP_AGAIN%"
goto :run
:end
endlocal
