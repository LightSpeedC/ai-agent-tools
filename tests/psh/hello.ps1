<#
	psh のテスト用。日本語と引数を出して終わる。

	PowerShell の標準出力は日本語 Windows では CP932 になる。
	この出力が呼び出し側で UTF-8 として読めることを確かめるための材料。

	共通ルール「標準出力は UTF-8 に揃える」の例外にあたる。
	**CP932 で出ること自体が試験の対象**なので、
	[Console]::OutputEncoding を UTF-8 にしない。
	手を入れられない ps1 を psh が読めることを、ここで保証している。
#>
[CmdletBinding()]
param(
	[string]$First = '(なし)',
	[string]$Second = '(なし)'
)

Write-Host '日本語の出力です'
Write-Host ('第 1 引数: ' + $First)
Write-Host ('第 2 引数: ' + $Second)
