<#
	psh のテスト用。PowerShell から .NET 製の exe を呼んで、その出力を流す。

	PowerShell 自身の出力と、そこから呼ぶ exe の出力が、
	1 回の実行で混ざりうることを確かめるための材料。
	どちらの文字コードで来るかは呼び出しの経路と exe しだい（src/psh/psh-main.ts に実測）。

	共通ルール「標準出力は UTF-8 に揃える」の例外にあたる。
	**呼ばれた側の文字コードを psh が読み分けられるか**が試験の対象なので、
	[Console]::OutputEncoding を UTF-8 にしない。
#>
[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)

# 呼ぶ exe は callexe.cs を Windows 標準の csc でビルドしたもの。無ければ作る
$exe = Join-Path $root 'tmp\psh-callexe.exe'
if (-not (Test-Path -LiteralPath $exe)) {
	$csc = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
	New-Item -ItemType Directory -Force (Split-Path -Parent $exe) | Out-Null
	& $csc /nologo /utf8output /codepage:65001 /out:"$exe" (Join-Path $PSScriptRoot 'callexe.cs') | Out-Null
	if ($LASTEXITCODE -ne 0) { Write-Host ('csc でビルドできません: ' + $csc); exit 1 }
}

Write-Host 'ここは PowerShell の出力です'
& $exe
