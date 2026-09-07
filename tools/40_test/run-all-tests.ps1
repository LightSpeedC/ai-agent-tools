<#
	すべてのテストを順に実行する

	ツールが増えるたびにテストも増えるため、束ねる場所を 1 つ作った。
	個別に実行しないと通らないテストを残さないためのもので、
	それぞれのランチャーは単独でも実行できる。

	1 本でも失敗したら終了コード 1 を返す。
#>
[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'

$Suites = @(
	@{ Name = 'html2md'; Script = 'run-tests.ps1' },
	@{ Name = 'convert-encoding'; Script = 'run-convert-encoding-tests.ps1' },
	@{ Name = 'text'; Script = 'run-text-tests.ps1' }
)

$failed = @()

foreach ($suite in $Suites) {
	$path = Join-Path $PSScriptRoot $suite.Script
	if (-not (Test-Path -LiteralPath $path)) {
		Write-Host ('テストが見つかりません: ' + $suite.Script) -ForegroundColor Red
		$failed += $suite.Name
		continue
	}

	& $path
	if ($LASTEXITCODE -ne 0) { $failed += $suite.Name }
}

Write-Host ''
Write-Host '=== すべてのテスト ===' -ForegroundColor Cyan

if ($failed.Count -eq 0) {
	Write-Host ('  ' + $Suites.Count + ' 本すべて成功') -ForegroundColor Green
	exit 0
} else {
	Write-Host ('  失敗: ' + ($failed -join ' / ')) -ForegroundColor Red
	exit 1
}
