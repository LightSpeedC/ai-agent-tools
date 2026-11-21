<#
	試験が、外のプログラム (exe ・ cmd ・ ps1) を呼んで、出力を UTF-8 として読むための部品 (課題 i261119-01)。
	run-tests.ps1 ・ run-text-tests.ps1 ・ run-convert-encoding-tests.ps1 が、ドットで読み込んで使う:

		. (Join-Path $PSScriptRoot 'invoke-utf8.ps1')

	`& $Exe @args 2>&1` は、子の出力を窓の出力エンコーディング ([Console]::OutputEncoding) で読む。
	素の Windows PowerShell 5.1 (夜 1 時のタスク) では CP932 なので、UTF-8 で出す日本語が化ける。
	psh は窓の側を UTF-8 にするので通っていた。窓のコードページは変えない (共通ルール)。子の出力だけを UTF-8 として読む。

	Invoke-Utf8Lines <起動するもの> [<引数の配列>] [-MergeStderr]
		・子へ渡す引数は、配列 1 つで渡す (Invoke-Utf8Lines $Exe @('--info', $Path) ・ Invoke-Utf8Lines $Exe $Arguments)。
		  引数を並べて書く形にはしない (-mx のような 1 字の - 始まりの値が、この部品の引数の名前に取り違えられるため)。空の文字列の引数も、そのまま渡す
		・出力を行の配列で返す (標準出力の行。-MergeStderr なら、そのあとに標準エラーの行を足す。出た順には並べない)
		・終了コードを $LASTEXITCODE に入れる
		・.cmd ・ .bat は cmd.exe 経由、.ps1 は今の PowerShell 経由で起動する。ほかは、そのまま起動する
		・標準出力と標準エラーを、両方とも非同期に読む (片方だけ読むと、もう一方のパイプが埋まって子が止まる)
		・標準入力は、呼び出し元から引き継ぐ (パイプで渡した値は、子へ渡らない。'x' | Invoke-Utf8Lines … は使えない)
		・引数の囲みは " だけ。値の中の " ・ 末尾の \ ・ cmd 経由の % ・ ^ ・ & には耐えない (今の試験の引数には含まれない)
#>
function Invoke-Utf8Lines {
	param(
		[Parameter(Mandatory = $true, Position = 0)][string]$FilePath,
		# 子へ渡す引数は、配列を 1 つの値として渡す。1 字の - で始まる値 (-mx など) が、この部品の引数の名前に取り違えられない
		[Parameter(Position = 1)][AllowEmptyString()][string[]]$ArgumentList = @(),
		[switch]$MergeStderr
	)
	$enc = New-Object System.Text.UTF8Encoding($false)
	$quote = { param([string]$s) '"' + $s + '"' }
	$quoted = (@($ArgumentList | Where-Object { $null -ne $_ }) | ForEach-Object { & $quote $_ }) -join ' '
	$psi = New-Object System.Diagnostics.ProcessStartInfo
	if ($FilePath -match '\.(cmd|bat)$') {
		$psi.FileName = $env:ComSpec
		$psi.Arguments = '/c "' + (& $quote $FilePath) + ' ' + $quoted + '"'
	} elseif ($FilePath -match '\.ps1$') {
		$psi.FileName = (Get-Process -Id $PID).Path
		$psi.Arguments = '-NoProfile -ExecutionPolicy Bypass -File ' + (& $quote $FilePath) + ' ' + $quoted
	} else {
		$psi.FileName = $FilePath
		$psi.Arguments = $quoted
	}
	$psi.UseShellExecute = $false
	$psi.CreateNoWindow = $true
	$psi.RedirectStandardOutput = $true
	$psi.RedirectStandardError = $true
	$psi.StandardOutputEncoding = $enc
	$psi.StandardErrorEncoding = $enc
	$p = [System.Diagnostics.Process]::Start($psi)
	$outTask = $p.StandardOutput.ReadToEndAsync()
	$errTask = $p.StandardError.ReadToEndAsync()
	$p.WaitForExit()
	$global:LASTEXITCODE = $p.ExitCode
	$split = { param([string]$t) if ($t.Length -eq 0) { return @() } ; $l = $t -split "\r?\n"; if ($l[$l.Length - 1] -eq '') { $l = @($l | Select-Object -First ($l.Length - 1)) }; return $l }
	$lines = @(& $split $outTask.Result)
	if ($MergeStderr) { $lines += @(& $split $errTask.Result) }
	return $lines
}
