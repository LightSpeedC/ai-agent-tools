# 測定用（計画 p260929-01）。psh から起動された PowerShell が、どのコードページで動いているかと、
# SJIS を出す cmd の出力を取り込んだときに化けるかを見る。
# bun から起動した場合と node から起動した場合で比べる
$cmd = Join-Path $PSScriptRoot 'sjis-echo.cmd'
Write-Output ('OutputEncoding: ' + [Console]::OutputEncoding.CodePage)
Write-Output ('InputEncoding: ' + [Console]::InputEncoding.CodePage)
$captured = & cmd /c $cmd
Write-Output ('取り込み: ' + $captured)
Write-Output ('取り込みは正しいか: ' + ($captured -ceq 'SJISの日本語です'))
