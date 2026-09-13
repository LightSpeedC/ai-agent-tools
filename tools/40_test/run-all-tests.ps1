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

<#
	NodeTarget を持つものは node でも回す。

	本番のランチャーは bun を優先するため、bun が入っている環境では
	**node で 1 ケースも回らない**。移植版は node でも動くことになっているので、
	そちらでも確かめる（runners/ の当て木を -Target に渡す）。
#>
$Suites = @(
	@{ Name = 'html2md'; Script = 'run-tests.ps1'; NodeTarget = 'runners\html2md-node.cmd' },
	@{ Name = 'convert-encoding'; Script = 'run-convert-encoding-tests.ps1'; NodeTarget = 'runners\convert-encoding-node.cmd' },
	@{ Name = 'text'; Script = 'run-text-tests.ps1'; NodeTarget = 'runners\text-node.cmd' },
	# psh のテストだけ ts で書いてある。道具自体が PowerShell を呼ぶため、
	# テストまで ps1 にすると道具が壊れたときにテストも動かせない
	@{ Name = 'psh'; Script = 'run-psh-tests.ts' },
	# node でも動くかの確認。ランチャーは bun が無ければ node に落ちるため、
	# bun でしか試していないと bun の無い環境で初めて落ちる
	@{ Name = 'node で動くか'; Script = 'run-node-tests.ts' },
	# check ツール。ps1 から移植したので、ps1 版との突き合わせも見る
	@{ Name = 'check ツール'; Script = 'run-check-tools-tests.ts' },
	# 公開前の検査。誤検出の件数まで見る（拾いすぎると道具ごと使われなくなる）
	@{ Name = 'check-public'; Script = 'run-check-public-tests.ts' },
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

<#
	bun が入っているか。

	**node は必ずある前提**（このプロジェクトの大前提）。
	bun が無ければランチャーは node に落ちるため、既定の 1 周がそのまま
	node になる。**そのとき 2 周目を回すと、同じものを 2 回見ることになる。**
#>
$HasBun = [bool](Get-Command bun -ErrorAction SilentlyContinue)
$FirstRunner = if ($HasBun) { 'bun' } else { 'node' }

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

	# 既定で回す。ランチャーが bun を優先するので、bun があれば bun
	Write-Host ('--- ' + $suite.Name + '（' + $FirstRunner + '）') -ForegroundColor DarkGray
	& $path
	if ($LASTEXITCODE -ne 0) { $failed += ($suite.Name + '（' + $FirstRunner + '）') }

	# node でも回す。bun が無ければ上が既に node なので、そのときは回さない
	if ($HasBun -and $suite.ContainsKey('NodeTarget')) {
		$target = Join-Path $PSScriptRoot $suite.NodeTarget
		if (Test-Path -LiteralPath $target) {
			Write-Host ('--- ' + $suite.Name + '（node）') -ForegroundColor DarkGray
			& $path -Target $target
			if ($LASTEXITCODE -ne 0) { $failed += ($suite.Name + '（node）') }
		}
		else {
			Write-Host ('node 用の当て木がありません: ' + $target) -ForegroundColor Red
			$failed += ($suite.Name + '（node）')
		}
	}
}

# このリポジトリ自身が文字コードと改行の規約を守っているかを見る。
# 編集の道具によっては BOM や改行が落ちるため、テストと同じ場所で検査する
Write-Host ''
Write-Host '=== 文字コードと改行の検査 ===' -ForegroundColor Cyan
$Root = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
# 移植版を呼ぶ。C# 版は突き合わせ用で、ビルドしていない環境もある
& (Join-Path $Root 'convert-encoding.cmd') $Root --check
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
