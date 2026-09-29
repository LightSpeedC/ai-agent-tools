<#
	psh のプロセスツリーとメモリ使用量を測る（計画 p260929-01 の第 5 章）。

	数秒止まる ps1（sleep.ps1）を psh に走らせ、止まっている間に、起点のプロセスから
	子孫を Win32_Process でたどる。各プロセスの物理メモリ（WorkingSetSize）を出す。
	終わったあと、たどったプロセスが残っていないかも見る。

	起動の形（Variant）:
	  bun      bun src/psh/psh-main.ts …（処理系を名指し）
	  node     node src/psh/psh-main.ts …（処理系を名指し）
	  cmd      cmd /c bin/psh.cmd …（入口の cmd を通す）
	  sh       sh bin/psh …（入口の sh を通す）
	  exe      psh.exe を直に（Rust 版。ビルドしていなければ飛ばす）

	使い方:
	  run-bench.ps1                 すべての形を 3 回ずつ
	  run-bench.ps1 -Runs 1 -Variant bun,node
#>
[CmdletBinding()]
param(
	[int]$Runs = 3,
	[string[]]$Variant = @('bun', 'node', 'cmd', 'sh', 'exe'),
	# 起動してから測るまでの待ち（ミリ秒）。powershell が起動しきるまで待つ
	[int]$SampleAfterMs = 2500
)

$ErrorActionPreference = 'Stop'

# コンソールのコードページは変えない。リダイレクトされている分だけ UTF-8 で書く
$utf8 = New-Object System.Text.UTF8Encoding($false)
if ([Console]::IsOutputRedirected) {
	$w = New-Object System.IO.StreamWriter([Console]::OpenStandardOutput(), $utf8)
	$w.AutoFlush = $true
	[Console]::SetOut($w)
}

# tools/90_misc/bench-psh/ に置くため、3 階層上がプロジェクトルート
$Root = Split-Path -Parent (Split-Path -Parent (Split-Path -Parent $PSScriptRoot))
$Main = Join-Path $Root 'src\psh\psh-main.ts'
$Sleep = Join-Path $PSScriptRoot 'sleep.ps1'
$Exe = Join-Path $Root 'src\psh-rs\target\release\psh.exe'
$Work = Join-Path $Root 'tmp\bench-psh'
New-Item -ItemType Directory -Force -Path $Work | Out-Null

function Get-CommandPath {
	param([string]$Name)
	$c = Get-Command $Name -ErrorAction SilentlyContinue | Select-Object -First 1
	if ($c) { return $c.Source }
	return $null
}

# 起動する実行ファイルと引数を決める。使えない形は $null
function Get-Launch {
	param([string]$Name)
	switch ($Name) {
		'bun'  { $p = Get-CommandPath 'bun';  if ($p) { return @($p, ('"' + $Main + '" "' + $Sleep + '"')) } }
		'node' { $p = Get-CommandPath 'node'; if ($p) { return @($p, ('"' + $Main + '" "' + $Sleep + '"')) } }
		'cmd'  { return @((Join-Path $env:SystemRoot 'System32\cmd.exe'), ('/c ""' + (Join-Path $Root 'bin\psh.cmd') + '" "' + $Sleep + '""')) }
		'sh'   { $p = Get-CommandPath 'sh';   if ($p) { return @($p, ('"' + ((Join-Path $Root 'bin\psh') -replace '\\', '/') + '" "' + ($Sleep -replace '\\', '/') + '"')) } }
		'exe'  { if (Test-Path -LiteralPath $Exe) { return @($Exe, ('"' + $Sleep + '"')) } }
	}
	return $null
}

# 起点から子孫をたどる。深さ付きで、起点を含めて返す
function Get-Tree {
	param([int]$RootPid)
	$all = @(Get-CimInstance Win32_Process | Select-Object ProcessId, ParentProcessId, Name, WorkingSetSize, CreationDate)
	$out = New-Object System.Collections.ArrayList
	$queue = New-Object System.Collections.Queue
	$top = $all | Where-Object { $_.ProcessId -eq $RootPid } | Select-Object -First 1
	if (-not $top) { return ,@() }
	$queue.Enqueue(@($top, 0))
	while ($queue.Count -gt 0) {
		$item = $queue.Dequeue()
		$p = $item[0]; $d = $item[1]
		[void]$out.Add([pscustomobject]@{ Depth = $d; Pid = $p.ProcessId; Name = $p.Name; WsMB = [math]::Round($p.WorkingSetSize / 1MB, 1) })
		# pid の使い回しに引っかからないよう、親より後に作られた子だけを見る
		foreach ($c in ($all | Where-Object { $_.ParentProcessId -eq $p.ProcessId -and $_.CreationDate -ge $p.CreationDate })) {
			$queue.Enqueue(@($c, ($d + 1)))
		}
	}
	return ,$out.ToArray()
}

$summary = New-Object System.Collections.ArrayList

foreach ($v in $Variant) {
	$launch = Get-Launch $v
	if ($null -eq $launch) {
		Write-Host ('--- {0}: 使えないので飛ばしました' -f $v)
		continue
	}
	for ($i = 1; $i -le $Runs; $i++) {
		$outFile = Join-Path $Work ('{0}-{1}.out' -f $v, $i)
		$errFile = Join-Path $Work ('{0}-{1}.err' -f $v, $i)
		$proc = Start-Process -FilePath $launch[0] -ArgumentList $launch[1] -PassThru -NoNewWindow `
			-RedirectStandardOutput $outFile -RedirectStandardError $errFile
		# ハンドルを先に握る。握らないと、終わったあとに ExitCode が空になる
		$null = $proc.Handle
		Start-Sleep -Milliseconds $SampleAfterMs
		$tree = Get-Tree $proc.Id
		$proc.WaitForExit()
		Start-Sleep -Milliseconds 300
		$left = @($tree | Where-Object { Get-Process -Id $_.Pid -ErrorAction SilentlyContinue })

		$outText = [System.IO.File]::ReadAllText($outFile, $utf8).Trim()
		$total = ($tree | Measure-Object -Property WsMB -Sum).Sum
		$pshOwn = ($tree | Where-Object { $_.Name -notmatch '^(powershell|pwsh|conhost)\.exe$' } | Measure-Object -Property WsMB -Sum).Sum
		$depth = ($tree | Measure-Object -Property Depth -Maximum).Maximum

		Write-Host ''
		Write-Host ('--- {0} #{1}  終了 {2}  出力「{3}」' -f $v, $i, $proc.ExitCode, $outText)
		foreach ($t in $tree) {
			Write-Host ('  {0}{1,-16} {2,7:N1} MB' -f ('  ' * $t.Depth), $t.Name, $t.WsMB)
		}
		Write-Host ('  段数 {0} ／ 合計 {1:N1} MB ／ psh 側（powershell ・ conhost 以外）{2:N1} MB ／ 残ったプロセス {3}' -f ($depth + 1), $total, $pshOwn, $left.Count)
		[void]$summary.Add([pscustomobject]@{
			Variant = $v; Run = $i; Exit = $proc.ExitCode; Levels = $depth + 1; Procs = $tree.Count
			TotalMB = $total; PshMB = $pshOwn; Left = $left.Count
			Chain = (($tree | ForEach-Object { $_.Name }) -join ' > ')
		})
	}
}

Write-Host ''
Write-Host '=== まとめ（形ごとの平均。最小〜最大） ==='
foreach ($g in ($summary | Group-Object Variant)) {
	$tm = $g.Group | Measure-Object TotalMB -Average -Minimum -Maximum
	$pm = $g.Group | Measure-Object PshMB -Average -Minimum -Maximum
	Write-Host ('  {0,-5} 段数 {1} ／ プロセス {2} ／ 合計 {3:N1} MB（{4:N1}〜{5:N1}） ／ psh 側 {6:N1} MB（{7:N1}〜{8:N1}） ／ 残り {9}' -f `
		$g.Name, $g.Group[0].Levels, $g.Group[0].Procs, $tm.Average, $tm.Minimum, $tm.Maximum, `
		$pm.Average, $pm.Minimum, $pm.Maximum, ($g.Group | Measure-Object Left -Sum).Sum)
	Write-Host ('        ' + $g.Group[0].Chain)
}
