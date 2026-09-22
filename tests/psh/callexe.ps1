<#
	psh のテスト用。PowerShell から .NET 製の exe を呼んで、その出力を流す。

	PowerShell 自身の出力と、そこから呼ぶ exe の出力が、
	1 回の実行で混ざりうることを確かめるための材料。
	どちらの文字コードで来るかは呼び出しの経路と exe しだい（src/psh/main.ts に実測）。

	共通ルール「標準出力は UTF-8 に揃える」の例外にあたる。
	**呼ばれた側の文字コードを psh が読み分けられるか**が試験の対象なので、
	[Console]::OutputEncoding を UTF-8 にしない。
#>
[CmdletBinding()]
param()

$root = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)

Write-Host 'ここは PowerShell の出力です'
& (Join-Path $root 'dist\convert-encoding-cs.exe') --help
