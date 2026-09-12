<#
	すべてのテストを順に実行する

	ツールが増えるたびにテストも増えるため、束ねる場所を 1 つ作った。
	個別に実行しないと通らないテストを残さないためのもので、
	それぞれのランチャーは単独でも実行できる。

	1 本でも失敗したら終了コード 1 を返す。

	ps1 のテストは直接、ts のテストは bun（無ければ node）で走らせる。

	最後に convert-encoding --check でリポジトリ全体の文字コードと改行を見る。
	ここが落ちたら、テストが通っていても 1 を返す。
#>
[CmdletBinding()]
param()

# 標準出力を UTF-8 にする。既定は CP932 で、Bash から呼ぶと日本語が化ける
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

$ErrorActionPreference = 'Stop'

$Suites = @(
	@{ Name = 'html2md'; Script = 'run-tests.ps1' },
	@{ Name = 'convert-encoding'; Script = 'run-convert-encoding-tests.ps1' },
	@{ Name = 'text'; Script = 'run-text-tests.ps1' },
	# psh のテストだけ ts で書いてある。道具自体が PowerShell を呼ぶため、
	# テストまで ps1 にすると道具が壊れたときにテストも動かせない
	@{ Name = 'psh'; Script = 'run-psh-tests.ts' },
	# node でも動くかの確認。ランチャーは bun が無ければ node に落ちるため、
	# bun でしか試していないと bun の無い環境で初めて落ちる
	@{ Name = 'node で動くか'; Script = 'run-node-tests.ts' },
	# check ツールのオプション解釈。この 2 つだけ ps1 で、-- へ寄せた
	@{ Name = 'check ツール'; Script = 'run-check-tools-tests.ps1' },
	# 型チェック。bun も node も型を見ないため、ここでしか食い違いが出ない
	@{ Name = '型チェック'; Script = 'run-tsc-tests.ps1' }
)

<#
	ts のテストを走らせる処理系。

	**入っているものすべてで回す。**ランチャーは bun が無ければ node に
	落ちるため、片方でしか試していないと、もう片方の環境で初めて落ちる。
	node は TypeScript を型注釈の除去だけで走らせる（strip-only）ので、
	bun では通る書き方が node では通らないことがある。
#>
$TsRunners = @()
if (Get-Command bun -ErrorAction SilentlyContinue) { $TsRunners += 'bun' }
if (Get-Command node -ErrorAction SilentlyContinue) { $TsRunners += 'node' }

$failed = @()

foreach ($suite in $Suites) {
	$path = Join-Path $PSScriptRoot $suite.Script
	if (-not (Test-Path -LiteralPath $path)) {
		Write-Host ('テストが見つかりません: ' + $suite.Script) -ForegroundColor Red
		$failed += $suite.Name
		continue
	}

	if ($suite.Script -like '*.ts') {
		if ($TsRunners.Count -eq 0) {
			Write-Host ('bun か node が要ります: ' + $suite.Script) -ForegroundColor Red
			$failed += $suite.Name
			continue
		}
		# 入っている処理系すべてで回す。片方で通っても、もう片方で落ちうる
		foreach ($runner in $TsRunners) {
			Write-Host ('--- ' + $suite.Name + '（' + $runner + '）') -ForegroundColor DarkGray
			& $runner $path
			if ($LASTEXITCODE -ne 0) { $failed += ($suite.Name + '（' + $runner + '）') }
		}
		continue
	}

	& $path
	if ($LASTEXITCODE -ne 0) { $failed += $suite.Name }
}

# このリポジトリ自身が文字コードと改行の規約を守っているかを見る。
# 編集の道具によっては BOM や改行が落ちるため、テストと同じ場所で検査する
Write-Host ''
Write-Host '=== 文字コードと改行の検査 ===' -ForegroundColor Cyan
$Root = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
& (Join-Path $Root 'convert-encoding-cs.exe') $Root --check
if ($LASTEXITCODE -ne 0) { $failed += '文字コードと改行' }

Write-Host ''
Write-Host '=== すべてのテスト ===' -ForegroundColor Cyan

if ($failed.Count -eq 0) {
	Write-Host ('  ' + $Suites.Count + ' 本すべて成功 ＋ 文字コードと改行は規約どおり') -ForegroundColor Green
	exit 0
} else {
	Write-Host ('  失敗: ' + ($failed -join ' / ')) -ForegroundColor Red
	exit 1
}
