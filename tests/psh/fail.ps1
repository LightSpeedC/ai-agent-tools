<#
	psh のテスト用。標準エラーへ日本語を出し、3 で終わる。

	終了コードが呼び出し側へ素通しされることと、
	標準エラーの日本語も化けないことを確かめるための材料。

	共通ルール「標準出力は UTF-8 に揃える」の例外にあたる。
	**CP932 で出ること自体が試験の対象**なので、
	[Console]::OutputEncoding を UTF-8 にしない。
#>
[CmdletBinding()]
param()

[Console]::Error.WriteLine('失敗しました')
exit 3
