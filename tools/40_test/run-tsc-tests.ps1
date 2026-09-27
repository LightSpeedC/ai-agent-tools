<#
.SYNOPSIS
	TypeScript の型チェック（tsc --noEmit）。

.DESCRIPTION
	bun も node も TypeScript を「型注釈を取り除いて走らせる」だけで、
	型は一切検査しない。**型の食い違いは実行時まで表に出ない。**
	ここで別に検査する。

	設定は root の tsconfig.json。対象は src/ 配下と tools/40_test/ の ts。

	tsc は root の node_modules に入れる（typescript と @types/node の 2 つ）。
	無ければ npm install を促して 2 で止まる。**黙って成功しない。**

	入れるのは npm。**node は必ずある前提**（このプロジェクトの大前提）で、
	bun は入っていないことがある。

.PARAMETER Install
	node_modules が無いときに npm install まで行う。
#>
[CmdletBinding()]
param(
	[switch]$Install
)

# コンソールのコードページは変えない（窓に残り、隣のプロセスを化けさせる）。
# リダイレクトされている分だけ、UTF-8 で読み書きするよう個別に差し替える
$utf8 = New-Object System.Text.UTF8Encoding($false)
if ([Console]::IsOutputRedirected) {
	$w = New-Object System.IO.StreamWriter([Console]::OpenStandardOutput(), $utf8)
	$w.AutoFlush = $true
	[Console]::SetOut($w)
}
if ([Console]::IsErrorRedirected) {
	$w = New-Object System.IO.StreamWriter([Console]::OpenStandardError(), $utf8)
	$w.AutoFlush = $true
	[Console]::SetError($w)
}
if ([Console]::IsInputRedirected) {
	[Console]::SetIn((New-Object System.IO.StreamReader([Console]::OpenStandardInput(), $utf8)))
}

$ErrorActionPreference = 'Stop'

$Root = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)

<#
	tsc の置き場は入れた道具で変わる。
	bun は .bin\tsc.exe を、npm は .bin\tsc.cmd を作る。
	どちらでも動くように両方を見る
#>
function Find-Tsc {
	foreach ($name in @('tsc.exe', 'tsc.cmd')) {
		$p = Join-Path $Root ('node_modules\.bin\' + $name)
		if (Test-Path -LiteralPath $p) { return $p }
	}
	return $null
}

$Tsc = Find-Tsc

Write-Host ''
Write-Host '=== 型チェック（tsc --noEmit） ===' -ForegroundColor Cyan
Write-Host ''

if ($null -eq $Tsc) {
	if ($Install) {
		Write-Host '  tsc がありません。npm install で入れます'
		Push-Location $Root
		try { & npm install } finally { Pop-Location }
		$Tsc = Find-Tsc
	}
	else {
		Write-Host '  tsc がありません。root で npm install を実行してください' -ForegroundColor Red
		exit 2
	}
}

if ($null -eq $Tsc) {
	Write-Host '  tsc を用意できませんでした' -ForegroundColor Red
	exit 2
}

# 対象は tsconfig.json の include で決まる。ここでは渡さない
# （ファイルを渡すと tsconfig.json が読まれなくなる）
& $Tsc --noEmit --pretty false
$code = $LASTEXITCODE

Write-Host ''
if ($code -eq 0) {
	Write-Host '=== 型の食い違いはありません ===' -ForegroundColor Green
	exit 0
}

Write-Host '=== 型チェックに失敗しました ===' -ForegroundColor Red
exit 1
