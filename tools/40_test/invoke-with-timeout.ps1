<#
	試験を 1 本、時間の上限付きで走らせる。run-all-tests.ps1 が 1 本ごとに呼ぶ。

	共通ルール「試験には時間の上限を付ける」を守るための部品。

	  ・上限を超えたら、試験のプロセスを子孫ごと止める（taskkill /T /F）。⏱️ を出し、124 を返す
	  ・上限内に終わったら、試験の終了コードをそのまま返す
	  ・試験が起動して残したプロセスは、終わったあとに止める（残ると次の試験と取り違える）。⚠️ で知らせる
	  ・Start-Process -Wait は使わない。子孫の終了まで待つため、試験が残したプロセスがあると止まる。
	    -PassThru で受け、Handle に触れてから WaitForExit(ミリ秒) で待つ（触れないと ExitCode が空になる）

	試験の出力は、そのまま画面に出る（リダイレクトしない。-NoNewWindow で、呼び出し元の出力を引き継ぐ）。

	  .\invoke-with-timeout.ps1 -FilePath bun -ArgumentLine "run-x-tests.ts" -TimeoutSec 300 -Name "x"
#>
[CmdletBinding()]
param(
	[Parameter(Mandatory = $true)][string]$FilePath,
	# 空白を含む引数は、呼び出し側で " で囲む（Start-Process は配列を囲まずに空白でつなぐため、1 本の文字列で受ける）
	[string]$ArgumentLine = '',
	[int]$TimeoutSec = 600,
	[string]$Name = ''
)

# コンソールのコードページは変えない（窓に残り、隣のプロセスを化けさせる）。
# リダイレクトされているときだけ、UTF-8 で書くよう、この出力を差し替える。すでに UTF-8 なら触らない
if ([Console]::IsOutputRedirected -and [Console]::Out.Encoding.WebName -ne 'utf-8') {
	$utf8 = New-Object System.Text.UTF8Encoding($false)
	$w = New-Object System.IO.StreamWriter([Console]::OpenStandardOutput(), $utf8)
	$w.AutoFlush = $true
	[Console]::SetOut($w)
}

$ErrorActionPreference = 'Stop'
$label = if ($Name.Length -gt 0) { $Name } else { $FilePath }

# pid から先の子孫の根（直接の子）を集める。親が終わったあとも、子の ParentProcessId は残る。
# pid が使い回されて別のプロセスを拾わないよう、親が始まったあとに作られたものだけを見る
function Get-ChildRoots([int]$parentId, [datetime]$since) {
	$found = @()
	$children = Get-CimInstance Win32_Process -Filter ('ParentProcessId=' + $parentId) -ErrorAction SilentlyContinue
	foreach ($c in $children) {
		if ($c.CreationDate -ge $since.AddSeconds(-1)) { $found += $c }
	}
	return ,$found
}

function Stop-Tree([int]$processId) {
	# 止める相手がすでに居ないときの失敗は、無視する
	& taskkill /PID $processId /T /F 2>&1 | Out-Null
}

$sw = [System.Diagnostics.Stopwatch]::StartNew()
if ($ArgumentLine.Length -gt 0) {
	$p = Start-Process -FilePath $FilePath -ArgumentList $ArgumentLine -NoNewWindow -PassThru
}
else {
	$p = Start-Process -FilePath $FilePath -NoNewWindow -PassThru
}
$null = $p.Handle
$started = $p.StartTime
$finished = $p.WaitForExit($TimeoutSec * 1000)

if (-not $finished) {
	Stop-Tree $p.Id
	$null = $p.WaitForExit(5000)
	Write-Host ('⏱️ ' + $label + ': ' + $TimeoutSec + ' 秒で時間切れ。子孫ごと止めました') -ForegroundColor Yellow
	exit 124
}

$code = $p.ExitCode
$left = Get-ChildRoots $p.Id $started
if ($left.Count -gt 0) {
	foreach ($c in $left) { Stop-Tree ([int]$c.ProcessId) }
	Write-Host ('⚠️ ' + $label + ': 試験が残したプロセス ' + $left.Count + ' 本を止めました') -ForegroundColor Yellow
}
Write-Host ('  （' + $label + ' ' + [math]::Round($sw.Elapsed.TotalSeconds, 1) + ' 秒）') -ForegroundColor DarkGray
exit $code
