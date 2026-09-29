# psh のテスト用。16 進で渡したバイト列を、そのまま標準出力に書く。
# 文字コードの読み分け（UTF-8 ・ CP932 ・ 行ごとの混在）を、決めたバイト列で確かめるために使う。
# PowerShell の文字列の出力を通さないので、コードページの影響を受けない
param([string]$Hex)
$bytes = [byte[]]@($Hex -split ' ' | Where-Object { $_ -ne '' } | ForEach-Object { [Convert]::ToByte($_, 16) })
$out = [Console]::OpenStandardOutput()
$out.Write($bytes, 0, $bytes.Length)
$out.Flush()
