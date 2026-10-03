<#
	psh のテスト用。標準入力を最後まで読み、読めた中身を [ ] で囲んで出す。
	パイプで渡した入力が ps1 まで届くかを見る（i260927-03）。
#>
$s = [Console]::In.ReadToEnd()
Write-Output ('[' + $s.TrimEnd() + ']')
