<#
	すべてのテストを順に実行する

	ツールが増えるたびにテストも増えるため、束ねる場所を 1 つ作った。
	個別に実行しないと通らないテストを残さないためのもので、
	それぞれのランチャーは単独でも実行できる。

	1 本でも失敗したら終了コード 1 を返す。

	ps1 のテストは直接、ts のテストは bun（無ければ node）で走らせる。

	最後に convert-encoding --check でリポジトリ全体の文字コードと改行を見る。
	ここが落ちたら、テストが通っていても 1 を返す。

	-Online を付けると、このリポジトリの .md と .html に対する
	check-markdown ・ check-contrast も、最後に回す。
	check-markdown は GitHub の API を使い (認証なしは 60 回/時)、
	check-contrast はブラウザを起動するため、既定では回さない。

	-List は、走らせる試験の名前を出して終わる (中身は実行しない)。
#>
[CmdletBinding()]
param(
	[switch]$Online,
	[switch]$List
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
	# 「HTML に無い文言」の検査。callout の中の表の区切り行 (> |---|---|) を付け足しとみなさない
	@{ Name = 'html2md の文言の検査'; Script = 'run-html2md-extra-tests.ts' },
	@{ Name = 'transcribe'; Script = 'run-transcribe-tests.ts'; TimeoutSec = 300 },
	# 会話ログから公開用の HTML を作る。伏せ字は 2 段目の検査まで見る
	@{ Name = 'history2html'; Script = 'run-history2html-tests.ts' },
	# ビューアをブラウザ 3 種で確かめる（PlayWright 共有環境）。材料を作って渡すだけなので 1 周でよい
	@{ Name = 'history2html のビューア'; Script = 'run-history2html-viewer-tests.ts'; Once = $true; TimeoutSec = 600 },
	@{ Name = 'convert-audio'; Script = 'run-convert-audio-tests.ts' },
	# 複数の場所から書き換えられるリポジトリの同期。裸のリポジトリと clone 2 つで、ロック ・ 衝突 ・ 時間切れまで見る
	@{ Name = 'safe-push'; Script = 'run-safe-push-tests.ts'; TimeoutSec = 300 },
	# 一括実行の時間の上限そのもの。止める相手は、このテストが起動する眠るだけの node
	@{ Name = '試験の時間の上限'; Script = 'run-timeout-tests.ts' },
	@{ Name = 'convert-encoding'; Script = 'run-convert-encoding-tests.ps1'; NodeTarget = 'runners\convert-encoding-node.cmd' },
	@{ Name = 'text'; Script = 'run-text-tests.ps1'; NodeTarget = 'runners\text-node.cmd' },
	# psh のテストだけ ts で書いてある。道具自体が PowerShell を呼ぶため、
	# テストまで ps1 にすると道具が壊れたときにテストも動かせない。
	# ExeTarget は Rust 版（計画 p260929-01）。同じテストを PSH_TARGET で当てる
	@{ Name = 'psh'; Script = 'run-psh-tests.ts'; ExeTarget = 'src\psh-rs\target\release\psh.exe'; ExeEnv = 'PSH_TARGET' },
	# xx（内部ツール。計画 p261027-01）。子プロセスを起こして、終了コード ・ 標準入力 ・ 文字コードを見る。
	# 判定と名前の解決の単体の確かめは src\xx の cargo test
	@{ Name = 'xx'; Script = 'run-xx-tests.ts'; ExeTarget = 'src\xx\target\release\xx.exe'; ExeEnv = 'XX_TARGET' },
	# cc.cmd が起動の前に呼ぶ、~/.claude.json への登録。本物の ~/.claude.json は触らない
	@{ Name = 'cc-register'; Script = 'run-cc-register-tests.ts' },
	# cc.cmd。claude を代役（rustc で作る）に差し替え、環境変数の削除・登録・起動を見る。窓が一瞬開いて閉じる
	@{ Name = 'cc'; Script = 'run-cc-tests.ts' },
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
	# 地の直書き (グラデーション ・ var() の前に色だけの地) の検査と、直す道具 (fix-html-bg.ts) の判定
	@{ Name = 'HTML の地の直書き'; Script = 'run-html-bg-tests.ts' },
	# 型チェック。bun も node も型を見ないため、ここでしか食い違いが出ない
	@{ Name = '型チェック'; Script = 'run-tsc-tests.ps1' },
	# run-all-tests.ps1 自身の -Online (一覧を出すだけで、API もブラウザも使わない)
	@{ Name = 'run-all-tests の -Online'; Script = 'run-all-tests-online-tests.ts' }
)

# -Online のときだけ回す、外の道具を使う検査 (i260910-03、68-A)。
# 引数の {root} はこのリポジトリの root に置き換える
$OnlineSuites = @(
	@{ Name = 'check-markdown'; Command = 'check-markdown'; ArgLine = '"{root}" -r'; TimeoutSec = 300 },
	@{ Name = 'check-contrast'; Command = 'check-contrast'; ArgLine = '-Path "{root}" -Recurse'; TimeoutSec = 600 }
)

if ($List) {
	foreach ($suite in $Suites) { Write-Host $suite.Name }
	if ($Online) {
		foreach ($suite in $OnlineSuites) { Write-Host ($suite.Name + ' (-Online)') }
	}
	exit 0
}

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

<#
	1 本ごとの時間の上限（秒）。共通ルール「試験には時間の上限を付ける」。
	超えたら、子孫ごと止めて ⏱️ 時間切れとして次へ進む（invoke-with-timeout.ps1）。
	上限は、ふつうにかかる時間の数倍にする。重い試験は、Suites の TimeoutSec で個別に決める。

	実測 (2026-10-25。1 本の最長): ビューア 90 秒 ・ transcribe 80 秒 ・ safe-push 58 秒 ・ そのほか 25 秒以下。
	既定 120 秒 (最長の約 5 倍)。ビューア 600 秒 ・ transcribe 300 秒 ・ safe-push 300 秒 (どれも 4 〜 7 倍)
#>
$DefaultTimeoutSec = 120
$Invoke = Join-Path $PSScriptRoot 'invoke-with-timeout.ps1'
# 今動いている PowerShell で、ps1 の試験も動かす（上限を付けるには、別のプロセスにする必要がある）
$PsExe = (Get-Process -Id $PID).Path

# 空白を含む値は " で囲む（Start-Process は引数を囲まずにつなぐため）
function Quote([string]$s) {
	if ($s -match '\s') { return '"' + $s + '"' }
	return $s
}

# 1 本を上限付きで走らせ、失敗なら一覧に足す。時間切れ（124）は ⏱️ を付ける
function Invoke-Suite($suite, [string]$file, [string]$argLine, [string]$label) {
	$limit = if ($suite.ContainsKey('TimeoutSec')) { $suite.TimeoutSec } else { $DefaultTimeoutSec }
	& $Invoke -FilePath $file -ArgumentLine $argLine -TimeoutSec $limit -Name $label
	$code = $LASTEXITCODE
	if ($code -eq 124) { $script:failed += ('⏱️ ' + $label) }
	elseif ($code -ne 0) { $script:failed += $label }
}

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
		# 入っている処理系すべてで回す。片方で通っても、もう片方で落ちうる。
		# Once は、処理系に左右されない外の道具（ブラウザ等）を呼ぶだけのもの。1 周目だけ回す
		$runners = if ($suite.ContainsKey('Once')) { @($TsRunners[0]) } else { $TsRunners }
		foreach ($runner in $runners) {
			Write-Host ('--- ' + $suite.Name + '（' + $runner + '）') -ForegroundColor DarkGray
			Invoke-Suite $suite $runner (Quote $path) ($suite.Name + '（' + $runner + '）')
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
					Invoke-Suite $suite $runner (Quote $path) ($suite.Name + '（exe・' + $runner + '）')
					Remove-Item -Path ('env:' + $suite.ExeEnv)
				}
			} else {
				Write-Host ('--- ' + $suite.Name + '（exe）: ビルドしていないので飛ばしました（' + $suite.ExeTarget + '）') -ForegroundColor Yellow
			}
		}
		continue
	}

	# 既定で回す。ランチャーが bun を優先するので、bun があれば bun
	Write-Host ('--- ' + $suite.Name + '（' + $FirstRunner + '）') -ForegroundColor DarkGray
	Invoke-Suite $suite $PsExe ('-NoProfile -ExecutionPolicy Bypass -File ' + (Quote $path)) ($suite.Name + '（' + $FirstRunner + '）')

	# node でも回す。bun が無ければ上が既に node なので、そのときは回さない
	if ($HasBun -and $suite.ContainsKey('NodeTarget')) {
		$target = Join-Path $PSScriptRoot $suite.NodeTarget
		if (Test-Path -LiteralPath $target) {
			Write-Host ('--- ' + $suite.Name + '（node）') -ForegroundColor DarkGray
			Invoke-Suite $suite $PsExe ('-NoProfile -ExecutionPolicy Bypass -File ' + (Quote $path) + ' -Target ' + (Quote $target)) ($suite.Name + '（node）')
		}
		else {
			Write-Host ('node 用の当て木がありません: ' + $target) -ForegroundColor Red
			$failed += ($suite.Name + '（node）')
		}
	}
}

# -Online: 外の道具 (GitHub の API ・ ブラウザ) を使う検査。root は空白を含まない前提で " で囲む
if ($Online) {
	$onlineRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
	foreach ($suite in $OnlineSuites) {
		$cmd = Get-Command $suite.Command -ErrorAction SilentlyContinue
		if ($null -eq $cmd) {
			Write-Host ('見つかりません: ' + $suite.Command) -ForegroundColor Red
			$failed += $suite.Name
			continue
		}
		Write-Host ('--- ' + $suite.Name + ' (-Online)') -ForegroundColor DarkGray
		Invoke-Suite $suite $cmd.Source ($suite.ArgLine.Replace('{root}', $onlineRoot)) ($suite.Name + ' (-Online)')
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
