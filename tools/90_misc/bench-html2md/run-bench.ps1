<#
.SYNOPSIS
	本丸（HTML → Markdown の変換）で処理系を比べる。

.DESCRIPTION
	同じ資料を同じ場所へ変換し、次を測る。

	  ・起動を含む実行時間（外側の計測・中央値）
	  ・起動を除く実行時間（port 版が自分で測って出す inner_ms）
	  ・ピークメモリ（実行中にポーリングして拾う）
	  ・ソースの行数

	比べるのは 2 系統。

	  本物  … html2md-cs.exe（C#）と src/html2md/main.ts（移植版）
	          どちらも変換・検査・SVG 切り出しまで行う。振る舞いが一致
	          しているので、そのまま突き合わせて読める
	  port  … 移植の検討用に書いた簡易版（port.js / .mjs / .ts）
	          変換だけを行う。.js / .mjs / .ts の読み込みコストを見るためのもの

	参照実装だった html2md-ps.ps1 は削除済みのため、比較から外してある。

.PARAMETER Runs
	各実装を何回まわすか。既定 11。中央値で比べる。
#>
param(
	[int]$Runs = 11
)

# 標準出力を UTF-8 にする。既定は CP932 で、Bash から呼ぶと日本語が化ける
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

$ErrorActionPreference = 'Stop'

$here = $PSScriptRoot
# tools/90_misc/bench-html2md/ に置くため、3 階層上がプロジェクトルート
$root = Split-Path -Parent (Split-Path -Parent (Split-Path -Parent $here))
$workRoot = Join-Path $root 'tmp\bench-html2md'

function Get-Median([double[]]$Values) {
	if (-not $Values -or $Values.Count -eq 0) { return 0 }
	$s = @($Values | Sort-Object)
	return $s[[int]([math]::Floor($s.Count / 2))]
}

<#
	実行しない行（空行とコメントだけの行）を除いた行数も出す。
	複数ファイルに分かれている実装は、フォルダごと合計する
#>
function Get-Lines([string[]]$Files, [string]$CommentMark) {
	$total = 0
	$code = 0
	foreach ($f in $Files) {
		$all = [System.IO.File]::ReadAllLines($f)
		$total += $all.Count
		foreach ($l in $all) {
			$t = $l.Trim()
			if (-not $t) { continue }
			if ($t.StartsWith($CommentMark)) { continue }
			$code++
		}
	}
	return [pscustomobject]@{ Total = $total; Code = $code }
}

<#
	ピークメモリを測る。

	終了したプロセスの PeakWorkingSet64 は 0 を返すため、実行中に
	ポーリングして拾う。出力はファイルへ逃がす。親のパイプを読まずに
	待つと、バッファが埋まったところで相手が止まる
#>
function Measure-Peak([string]$FilePath, [string[]]$ArgumentList) {
	$outFile = Join-Path $workRoot 'peek-out.txt'
	$errFile = Join-Path $workRoot 'peek-err.txt'
	$sp = @{
		FilePath               = $FilePath
		PassThru               = $true
		NoNewWindow            = $true
		RedirectStandardOutput = $outFile
		RedirectStandardError  = $errFile
	}
	if ($ArgumentList.Count -gt 0) { $sp.ArgumentList = $ArgumentList }

	$peak = 0
	$p = Start-Process @sp
	while (-not $p.HasExited) {
		try {
			$p.Refresh()
			$v = $p.PeakWorkingSet64
			if ($v -gt $peak) { $peak = $v }
		}
		catch { }
	}
	Remove-Item -LiteralPath $outFile -Force -ErrorAction SilentlyContinue
	Remove-Item -LiteralPath $errFile -Force -ErrorAction SilentlyContinue
	return [math]::Round($peak / 1MB, 1)
}

# 実装ごとに別の作業フォルダを用意する。同じ場所へ書くと互いに上書きしてしまう
function New-Work([string]$Name) {
	$w = Join-Path $workRoot $Name
	if (Test-Path -LiteralPath $w) { Remove-Item -LiteralPath $w -Recurse -Force }
	New-Item -ItemType Directory -Path (Join-Path $w 'notes') -Force | Out-Null
	Copy-Item (Join-Path $root 'README.html') $w
	Copy-Item -Recurse (Join-Path $root 'notes\10_plan') (Join-Path $w 'notes')
	Copy-Item -Recurse (Join-Path $root 'notes\90_rules') (Join-Path $w 'notes')
	Get-ChildItem -LiteralPath $w -Recurse -Filter *.md | Remove-Item -Force
	return $w
}

function Measure-Impl([string]$Name, [string]$Work, [string]$FilePath, [string[]]$ArgumentList, [string[]]$Sources, [string]$CommentMark) {
	$outer = @()
	$inner = @()
	for ($i = 0; $i -lt $Runs; $i++) {
		$o = $null
		$t = Measure-Command { $o = & $FilePath @ArgumentList 2>&1 }
		$outer += $t.TotalMilliseconds
		$last = ($o | Out-String)
		if ($last -match 'inner_ms=(\d+)') { $inner += [double]$Matches[1] }
	}

	# メモリは時間と別に測る。Start-Process の分が時間計測に乗らないようにする
	$peak = Measure-Peak $FilePath $ArgumentList

	$l = Get-Lines $Sources $CommentMark
	$mdCount = @(Get-ChildItem -LiteralPath $Work -Recurse -Filter *.md).Count
	$outerMed = Get-Median $outer
	$innerMed = Get-Median $inner
	return [pscustomobject]@{
		名前       = $Name
		起動込みms = [math]::Round($outerMed, 0)
		変換のみms = if ($innerMed -gt 0) { [math]::Round($innerMed, 0) } else { $null }
		メモリMB   = $peak
		総行数     = $l.Total
		実行行数   = $l.Code
		生成md     = $mdCount
	}
}

Write-Host '=== 本丸（html2md）の処理系比較 ==='
Write-Host ('  対象: README.html と notes/10_plan ・ notes/90_rules')
Write-Host ('  回数: {0}（中央値で比べる。メモリは 1 回）' -f $Runs)
Write-Host ''

if (-not (Test-Path -LiteralPath $workRoot)) { New-Item -ItemType Directory -Path $workRoot -Force | Out-Null }

$csSources = @(Get-ChildItem -LiteralPath (Join-Path $root 'src\Html2MdCs') -Filter *.cs | ForEach-Object { $_.FullName })
$tsSources = @(Get-ChildItem -LiteralPath (Join-Path $root 'src\html2md') -Filter *.ts | ForEach-Object { $_.FullName })
$mainTs = Join-Path $root 'src\html2md\main.ts'

$results = @()

# --- 本物どうし（変換・検査・SVG 切り出しまで行う） ---
$w = New-Work 'cs'
$results += Measure-Impl 'C#   exe（本物）' $w (Join-Path $root 'html2md-cs.exe') @('--root', $w, '--dir', 'notes') $csSources '//'

$w = New-Work 'node-main'
$results += Measure-Impl 'node .ts（本物）' $w 'node' @($mainTs, '--root', $w, '--dir', 'notes') $tsSources '//'

$w = New-Work 'bun-main'
$results += Measure-Impl 'bun  .ts（本物）' $w 'bun' @($mainTs, '--root', $w, '--dir', 'notes') $tsSources '//'

# --- 検討用の簡易版（変換のみ） ---
foreach ($v in @(
	@('node .js （port）', 'node-js', 'node', 'port.js'),
	@('node .mjs（port）', 'node-mjs', 'node', 'port.mjs'),
	@('node .ts （port）', 'node-ts', 'node', 'port.ts'),
	@('bun  .js （port）', 'bun-js', 'bun', 'port.js'),
	@('bun  .mjs（port）', 'bun-mjs', 'bun', 'port.mjs'),
	@('bun  .ts （port）', 'bun-ts', 'bun', 'port.ts')
)) {
	$w = New-Work $v[1]
	$src = Join-Path $here $v[3]
	$results += Measure-Impl $v[0] $w $v[2] @($src, $w) @($src) '//'
}

$results | Format-Table 名前, 起動込みms, 変換のみms, メモリMB, 総行数, 実行行数, 生成md -AutoSize

Write-Host '注: 本物（上の 3 行）はどちらも変換・検査・SVG 切り出しまで行う。そのまま突き合わせて読める。'
Write-Host '    port 版は変換だけを行う簡易版。.js / .mjs / .ts の読み込みコストを見るためのもの。'
Write-Host '    行数は本物がフォルダ内の全ファイルの合計、port 版は 1 本の値。'
Write-Host '    メモリは実行中にポーリングして拾ったピーク作業セット。'
