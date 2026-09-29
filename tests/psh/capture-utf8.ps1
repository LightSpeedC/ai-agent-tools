# psh のテスト用。UTF-8 を出す外部コマンド（node）の出力を PowerShell の中で取り込み、
# 正しく読めたかと、PowerShell のコードページを出す。
# psh は PowerShell を UTF-8（65001）で動かす（計画 p260929-01）。932 で動くと、ここで化ける
$captured = & node -e "process.stdout.write('UTF-8の日本語です\n')"
Write-Output ('コードページ: ' + [Console]::OutputEncoding.CodePage)
if ($captured -ceq 'UTF-8の日本語です') { Write-Output '取り込み: 正しい' } else { Write-Output ('取り込み: 化けた ' + $captured) }
