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

<#
	NodeTarget を持つものは node でも回す。

	本番のランチャーは bun を優先するため、bun が入っている環境では
	**node で 1 ケースも回らない**。移植版は node でも動くことになっているので、
	そちらでも確かめる（runners/ の当て木を -Target に渡す）。
#>
$Suites = @(
	@{ Name = 'html2md'; Script = 'run-tests.ps1'; NodeTarget = 'runners\html2md-node.cmd' },
	# html2md の作成日 ・ 更新日の検査。警告（▲）は golden の期待値に入らないため別に見る
	@{ Name = 'html2md の日付の検査'; Script = 'run-html2md-date-tests.ts' },
	@{ Name = 'html2md の書き出し'; Script = 'run-html2md-write-tests.ts' },
	@{ Name = 'convert-encoding'; Script = 'run-convert-encoding-tests.ps1'; NodeTarget = 'runners\convert-encoding-node.cmd' },
	@{ Name = 'text'; Script = 'run-text-tests.ps1'; NodeTarget = 'runners\text-node.cmd' },
	# psh のテストだけ ts で書いてある。道具自体が PowerShell を呼ぶため、
	# テストまで ps1 にすると道具が壊れたときにテストも動かせない。
	# ExeTarget は Rust 版（計画 p260929-01）。同じテストを PSH_TARGET で当てる
	@{ Name = 'psh'; Script = 'run-psh-tests.ts'; ExeTarget = 'src\psh-rs\target\release\psh.exe'; ExeEnv = 'PSH_TARGET' },
	# node でも動くかの確認。ランチャーは bun が無ければ node に落ちるため、
	# bun でしか試していないと bun の無い環境で初めて落ちる
	@{ Name = 'node で動くか'; Script = 'run-node-tests.ts' },
	# check ツール。ps1 から移植したので、ps1 版との突き合わせも見る
	@{ Name = 'check ツール'; Script = 'run-check-tools-tests.ts' },
	# 公開前の検査。誤検出の件数まで見る（拾いすぎると道具ごと使われなくなる）
	@{ Name = 'check-public'; Script = 'run-check-public-tests.ts' },
	# UTF-8 セーフなページャー。対話操作（キー入力での画面遷移）は
	# 自動化せず、出力先が端末でないときの素通し経路だけを確かめる
	@{ Name = 'less'; Script = 'run-less-tests.ts' },
	# プロセス一覧（ツリー表示）。bun:ffi 必須で node には代わりが無いため、
	# node で走らせたときは「bun が必要です」で終わることだけ確かめる
	@{ Name = 'psls'; Script = 'run-psls-tests.ts' },
	# HTTP で受けたコマンドを新しい窓で起動する。テスト中に窓が一瞬開いて閉じる
	@{ Name = 'spawn-server'; Script = 'run-spawn-server-tests.ts' },
	# このリポジトリの HTML が共通ルール（戻るリンク ・ 目次 ・ 日付 ・ README からのリンク等）に沿っているか
	@{ Name = 'HTML のルール'; Script = 'check-html-rules.ts' },
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
			Write-Host ('bun か node が必要です: ' + $suite.Script) -ForegroundColor Red
			$failed += $suite.Name
			continue
		}
		# 入っている処理系すべてで回す。片方で通っても、もう片方で落ちうる
		foreach ($runner in $TsRunners) {
			Write-Host ('--- ' + $suite.Name + '（' + $runner + '）') -ForegroundColor DarkGray
			& $runner $path
			if ($LASTEXITCODE -ne 0) { $failed += ($suite.Name + '（' + $runner + '）') }
		}

		# exe 版（Rust）も同じテストで回す。呼び出し元が bun のときと node のときで
		# 動きが変わりうる（bun は窓のコードページを変える）ので、両方から呼ぶ。
		# ビルドしていなければ飛ばすが、黙って成功にはしない
		if ($suite.ContainsKey('ExeTarget')) {
			$exePath = Join-Path (Split-Path -Parent (Split-Path -Parent $PSScriptRoot)) $suite.ExeTarget
			if (Test-Path -LiteralPath $exePath) {
				foreach ($runner in $TsRunners) {
					Write-Host ('--- ' + $suite.Name + '（exe・呼び出し元 ' + $runner + '）') -ForegroundColor DarkGray
					Set-Item -Path ('env:' + $suite.ExeEnv) -Value $exePath
					& $runner $path
					$code = $LASTEXITCODE
					Remove-Item -Path ('env:' + $suite.ExeEnv)
					if ($code -ne 0) { $failed += ($suite.Name + '（exe・' + $runner + '）') }
				}
			} else {
				Write-Host ('--- ' + $suite.Name + '（exe）: ビルドしていないので飛ばしました（' + $suite.ExeTarget + '）') -ForegroundColor Yellow
			}
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
& (Join-Path $Root 'bin\convert-encoding.cmd') $Root --check
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
