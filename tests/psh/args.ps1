# psh のテスト用。引数の結び付きと終了コードを確かめる（計画 p260929-01）。
# psh は最初の 1 行を実行してから ps1 を呼ぶため、-File と同じに結び付くかを見る
param([string]$Name, [switch]$Flag, [int]$Code = 0, [switch]$Throw)
Write-Output ('Name=[' + $Name + '] Flag=' + $Flag + ' 残り=[' + ($args -join '|') + ']')
if ($Throw) { throw '失敗させた' }
if ($Code -ne 0) { exit $Code }
