<#
.SYNOPSIS
	check-public の実装をどの処理系で書くかを決めるための性能比較。

.DESCRIPTION
	同じ検査を C#（csc）・Node・Bun・Rust（rustc）・Go・Windows PowerShell 5.1
	の 6 本で書き、次を測る。

	  1. コンパイル時間（コンパイルする処理系のみ）
	  2. 起動を含む実行時間（外側の計測）
	  3. 起動を除く実行時間（各実装が自分で測って出す inner_ms）
	  4. ピークメモリ（実行中にポーリングして拾う）
	  5. ソースの行数（総数と、空行・コメントを除いた実行行数）

	起動の重さは「html2md の検査から毎回呼ぶ」形にしたときそのまま効くため、
	内側と外側を分けて測る。差が起動の分になる。

	公平さについて 2 点。
	  ・Rust だけ標準ライブラリに正規表現が無く、手書きの走査になっている。
	    速度は有利に、行数は不利に出る
	  ・Go はビルドキャッシュが効くため、コンパイル時間は 2 回目以降の値。
	    csc と rustc は毎回まるごとコンパイルする

.PARAMETER Target
	検査対象のフォルダ。既定はこのプロジェクトのルート。

.PARAMETER Runs
	各実装を何回まわすか。既定 5。中央値で比べる。
#>
param(
	[string]$Target,
	[int]$Runs = 5
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

$here = $PSScriptRoot
# tools/90_misc/bench-check-public/ に置くため、3 階層上がプロジェクトルート
$root = Split-Path -Parent (Split-Path -Parent (Split-Path -Parent $here))
if (-not $Target) { $Target = $root }
$outDir = Join-Path $root 'tmp\bench-check-public'
if (-not (Test-Path -LiteralPath $outDir)) { New-Item -ItemType Directory -Path $outDir -Force | Out-Null }

function Get-Median([double[]]$Values) {
	if (-not $Values -or $Values.Count -eq 0) { return 0 }
	$s = @($Values | Sort-Object)
	return $s[[int]([math]::Floor($s.Count / 2))]
}

# 実行しない行（空行とコメントだけの行）を除いた行数も出す。
# 総行数だけだとコメントの量で差がつき、書く量の比較にならない
function Get-Lines([string]$File, [string]$CommentMark) {
	$all = [System.IO.File]::ReadAllLines($File)
	$code = 0
	foreach ($l in $all) {
		$t = $l.Trim()
		if (-not $t) { continue }
		if ($t.StartsWith($CommentMark)) { continue }
		$code++
	}
	return [pscustomobject]@{ Total = $all.Count; Code = $code }
}

function Measure-Compile([scriptblock]$Build, [string]$Artifact) {
	$ms = @()
	for ($i = 0; $i -lt $Runs; $i++) {
		if (Test-Path -LiteralPath $Artifact) { Remove-Item -LiteralPath $Artifact -Force }
		$t = Measure-Command { & $Build | Out-Null }
		if (-not (Test-Path -LiteralPath $Artifact)) { throw ('コンパイルに失敗しました: ' + $Artifact) }
		$ms += $t.TotalMilliseconds
	}
	return (Get-Median $ms)
}

<#
	ピークメモリを測る。

	終了したプロセスの PeakWorkingSet64 は 0 を返すため、実行中に
	ポーリングして拾う。出力はファイルへ逃がす。親のパイプを読まずに
	待つと、バッファが埋まったところで相手が止まる
#>
function Measure-Peak([string]$FilePath, [string[]]$ArgumentList) {
	$outFile = Join-Path $outDir 'peek-out.txt'
	$errFile = Join-Path $outDir 'peek-err.txt'
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

function Measure-Impl([string]$Name, [scriptblock]$Run, [string]$SourceFile, [string]$CommentMark, [double]$CompileMs, [string]$Artifact = '', [string]$MemFile = '', [string[]]$MemArgs = @()) {
	$outer = @()
	$inner = @()
	$last = ''
	for ($i = 0; $i -lt $Runs; $i++) {
		$o = $null
		$t = Measure-Command { $o = & $Run }
		$outer += $t.TotalMilliseconds
		$last = ($o | Out-String).Trim()
		if ($last -match 'inner_ms=(\d+)') { $inner += [double]$Matches[1] }
	}

	# メモリは時間と別に測る。Start-Process の分が時間計測に乗らないようにする
	$peak = if ($MemFile) { Measure-Peak $MemFile $MemArgs } else { $null }

	$l = Get-Lines $SourceFile $CommentMark
	$outerMed = Get-Median $outer
	$innerMed = Get-Median $inner
	$srcKb = [math]::Round((Get-Item $SourceFile).Length / 1KB, 1)
	$artKb = if ($Artifact -and (Test-Path -LiteralPath $Artifact)) {
		[math]::Round((Get-Item $Artifact).Length / 1KB, 0)
	}
	else { $null }
	return [pscustomobject]@{
		名前         = $Name
		コンパイルms = [math]::Round($CompileMs, 0)
		起動込みms   = [math]::Round($outerMed, 0)
		検査のみms   = [math]::Round($innerMed, 0)
		起動ms       = [math]::Round($outerMed - $innerMed, 0)
		メモリMB     = $peak
		総行数       = $l.Total
		実行行数     = $l.Code
		ソースKB     = $srcKb
		実行物KB     = $artKb
		出力         = $last
	}
}

Write-Host '=== check-public の処理系比較 ==='
Write-Host ('  対象: {0}' -f $Target.Replace($env:USERPROFILE, '~'))
Write-Host ('  回数: {0}（中央値で比べる）' -f $Runs)
Write-Host ''

$results = @()

# --- C#（csc） ---
$csc = $null
foreach ($d in @("$env:ProgramFiles\Microsoft Visual Studio", "${env:ProgramFiles(x86)}\Microsoft Visual Studio")) {
	if (-not (Test-Path -LiteralPath $d)) { continue }
	$found = Get-ChildItem -LiteralPath $d -Recurse -Filter 'csc.exe' -ErrorAction SilentlyContinue |
		Where-Object { $_.FullName -match '\\Roslyn\\csc\.exe$' } | Select-Object -First 1
	if ($found) { $csc = $found.FullName; break }
}
if (-not $csc) { $csc = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe' }
if (-not (Test-Path -LiteralPath $csc)) { throw ('csc.exe が見つかりません: ' + $csc) }

$csExe = Join-Path $outDir 'bench-cs.exe'
$csMs = Measure-Compile { & $csc /nologo /target:exe /platform:anycpu /optimize+ /utf8output /out:"$csExe" (Join-Path $here 'bench.cs') } $csExe
$results += Measure-Impl 'C#（csc）' { & $csExe $Target } (Join-Path $here 'bench.cs') '//' $csMs $csExe $csExe @($Target)

# --- Rust（rustc） ---
$rsExe = Join-Path $outDir 'bench-rs.exe'
$rsMs = Measure-Compile { & rustc -O -o "$rsExe" (Join-Path $here 'bench.rs') } $rsExe
$results += Measure-Impl 'Rust（rustc）' { & $rsExe $Target } (Join-Path $here 'bench.rs') '//' $rsMs $rsExe $rsExe @($Target)

# --- Go ---
$goExe = Join-Path $outDir 'bench-go.exe'
$goMs = Measure-Compile { Push-Location $here; try { & go build -o "$goExe" . } finally { Pop-Location } } $goExe
$results += Measure-Impl 'Go' { & $goExe $Target } (Join-Path $here 'bench.go') '//' $goMs $goExe $goExe @($Target)

# --- Node ---
$results += Measure-Impl 'Node' { & node (Join-Path $here 'bench.js') $Target } (Join-Path $here 'bench.js') '//' 0 '' 'node' @((Join-Path $here 'bench.js'), $Target)

# --- Bun（Node と同じソース） ---
$results += Measure-Impl 'Bun' { & bun run (Join-Path $here 'bench.js') $Target } (Join-Path $here 'bench.js') '//' 0 '' 'bun' @('run', (Join-Path $here 'bench.js'), $Target)

# --- Windows PowerShell 5.1 ---
$results += Measure-Impl 'PowerShell 5.1' {
	& powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $here 'bench.ps1') -Path $Target
} (Join-Path $here 'bench.ps1') '#' 0 '' 'powershell' @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', (Join-Path $here 'bench.ps1'), '-Path', $Target)

$results | Sort-Object 起動込みms | Format-Table 名前, コンパイルms, 起動込みms, 検査のみms, 起動ms, メモリMB, 総行数, 実行行数, ソースKB, 実行物KB -AutoSize

Write-Host '--- 各実装の出力（同じ件数になっていることの確認） ---'
foreach ($r in $results) { Write-Host ('  {0,-16} {1}' -f $r.名前, $r.出力) }

Write-Host ''
Write-Host '注: Bun は Node と同じソースを走らせている（行数は同じ）。'
Write-Host '    Rust だけ標準ライブラリに正規表現が無く、手書きの走査。速度は有利・行数は不利に出る。'
Write-Host '    Go のコンパイル時間はビルドキャッシュが効いた値。csc と rustc は毎回まるごとコンパイルする。'
Write-Host '    メモリは実行中にポーリングして拾ったピーク作業セット（1 回の計測）。'
