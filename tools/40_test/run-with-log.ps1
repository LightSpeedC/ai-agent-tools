<#
	ps1 を流して、出力を画面とログのファイルの両方へ残す (i261119-01 の 276-A)。

	夜の全件の試験 (run-all-tests.ps1 -IfChanged) の出力は、画面に出るだけで、どこにも残らなかった。
	落ちても、落ちた名前しか分からない。そこで、子の出力 (標準出力 ・ 標準エラー) を読み、
	画面へ出しながら、LogDir に <子の名前>_<日時>.log として書く。

	- 子の終了コードをそのまま返す。ログの末尾に「終了コード: N」を書く
	- 標準出力と標準エラーは、届いた順に 1 行ずつ書く (標準エラーの行頭に [標準エラー] を付ける)。落ちた理由が、どの試験の最中に出たかを読める
	- ログは UTF-8 (BOM 無し)。子の出力の文字コードは、1 行ごとに決める (下の説明)
	- KeepDays を過ぎた古い .log だけを消す (.log ではないファイルは触らない)
	- 子が終わってから GraceSec 秒たっても出力が閉じないとき (孫がパイプを持ったまま残っている) は、読みを打ち切る
	  (打ち切らないと、夜の試験が終わらず、記録も書かれない)
	- ログに書けなくなっても、画面に出して続ける (子を止めない。子の出力を読み続けないと、パイプが埋まって子が止まる)
	- コンソールのコードページは変えない (共通ルール「コンソールのコードページを変更しない」)

	呼び出し元が「子を起動した後か」を見分けるため、起動した直後に $global:RunWithLogStarted を $true にする。
	子が終わったら $global:RunWithLogExitCode に終了コードを入れる。
	起動の前に失敗したとき (置き場が作れない等) は、例外のまま止まる。呼び出し元は、記録なしで流せる。

	使い方:
		run-with-log.ps1 -Script <子の ps1> [-ArgumentLine "<子の引数>"] -LogDir <置き場> [-KeepDays 30] [-GraceSec 5]
#>
[CmdletBinding()]
param(
	[Parameter(Mandatory = $true)][string]$Script,
	[string]$ArgumentLine = '',
	[Parameter(Mandatory = $true)][string]$LogDir,
	[int]$KeepDays = 30,
	[int]$GraceSec = 5
)

$ErrorActionPreference = 'Stop'
$global:RunWithLogStarted = $false
$global:RunWithLogExitCode = $null
$utf8 = New-Object System.Text.UTF8Encoding($false)

# 画面へ出す。リダイレクトされているときは、UTF-8 の書き手に差し替えて出す (窓のコードページは変えない)
$script:Out = $null
if ([Console]::IsOutputRedirected) {
	$w = New-Object System.IO.StreamWriter([Console]::OpenStandardOutput(), $utf8)
	$w.AutoFlush = $true
	$script:Out = $w
}
function Emit([string]$line) {
	# 画面へ出せなくても、読みは続ける
	try {
		if ($null -ne $script:Out) { $script:Out.WriteLine($line) } else { Write-Host $line }
	} catch { }
}

# ここまでの失敗 (置き場が作れない) は、子を起動する前なので、例外のまま止める
New-Item -ItemType Directory -Force -Path $LogDir | Out-Null

# 古い .log を消す。消せなくても、記録は続ける
try {
	$limit = (Get-Date).AddDays(-$KeepDays)
	Get-ChildItem -LiteralPath $LogDir -Filter '*.log' -File | Where-Object { $_.LastWriteTime -lt $limit } | ForEach-Object {
		Remove-Item -LiteralPath $_.FullName -Force
	}
} catch {
	Emit ('古いログを消せません (続けます): ' + $_.Exception.Message)
}

$base = [System.IO.Path]::GetFileNameWithoutExtension($Script)
$logPath = Join-Path $LogDir ($base + '_' + (Get-Date).ToString('yyyy-MM-dd_HHmmss') + '.log')

$script:LogOk = $true
function Append([string]$line) {
	if (-not $script:LogOk) { return }
	try {
		[System.IO.File]::AppendAllText($logPath, $line + "`r`n", $utf8)
	} catch {
		$script:LogOk = $false
		Emit ('ログに書けません (画面だけに出して続けます): ' + $_.Exception.Message)
	}
}

$psi = New-Object System.Diagnostics.ProcessStartInfo
$psi.FileName = (Get-Process -Id $PID).Path
$psi.Arguments = '-NoProfile -ExecutionPolicy Bypass -File "' + $Script + '"' + $(if ($ArgumentLine -ne '') { ' ' + $ArgumentLine } else { '' })
$psi.UseShellExecute = $false
$psi.RedirectStandardOutput = $true
$psi.RedirectStandardError = $true
$psi.CreateNoWindow = $true

<#
	子の出力は、バイトで読み、1 行ごとに文字コードを決める。
	子の Write-Host は窓のコードページ (日本語の Windows では CP932) で出て、
	孫 (bun の試験など) は同じパイプへ UTF-8 で書く。1 本の流れに 2 つが混ざる。
	UTF-8 として厳密に読めればそれを、読めなければ OEM コードページで読む。
#>
$strictUtf8 = New-Object System.Text.UTF8Encoding($false, $true)
# 窓のコードページ ([Console]::OutputEncoding) は、bun が書き換えることがあるので当てにしない。システムの OEM コードページを使う
$consoleEnc = [System.Text.Encoding]::GetEncoding([System.Globalization.CultureInfo]::CurrentCulture.TextInfo.OEMCodePage)
function Decode([byte[]]$bytes) {
	try { return $strictUtf8.GetString($bytes) } catch { return $consoleEnc.GetString($bytes) }
}

# バイトの塊を行に分けて、1 行ずつ $onLine へ渡す。$acc には、改行まで届いていない端数を持つ
function Split-Lines([byte[]]$buf, [int]$n, [System.IO.MemoryStream]$acc, [scriptblock]$onLine) {
	$pos = 0
	while ($pos -lt $n) {
		$idx = [Array]::IndexOf($buf, [byte]10, $pos, $n - $pos)
		if ($idx -lt 0) { $acc.Write($buf, $pos, $n - $pos); break }
		$acc.Write($buf, $pos, $idx - $pos)
		$bytes = $acc.ToArray()
		$acc.SetLength(0)
		if ($bytes.Length -gt 0 -and $bytes[$bytes.Length - 1] -eq 13) {
			$trimmed = New-Object byte[] ($bytes.Length - 1)
			[Array]::Copy($bytes, $trimmed, $trimmed.Length)
			$bytes = $trimmed
		}
		& $onLine (Decode $bytes)
		$pos = $idx + 1
	}
}

$onStdout = { param($line) Append $line; Emit $line }
$onStderr = { param($line) if ($line -ne '') { Append ('[標準エラー] ' + $line); Emit $line } }

Append ('# 開始 ' + (Get-Date).ToString('yyyy-MM-dd HH:mm:ss') + ' ' + $base + ' ' + $ArgumentLine)
$p = [System.Diagnostics.Process]::Start($psi)
$global:RunWithLogStarted = $true

# 標準出力と標準エラーを、非同期に読む。届いた順に 1 行ずつ書く
$streams = @(
	@{ S = $p.StandardOutput.BaseStream; Buf = (New-Object byte[] 8192); Acc = (New-Object System.IO.MemoryStream); Task = $null; Done = $false; OnLine = $onStdout },
	@{ S = $p.StandardError.BaseStream; Buf = (New-Object byte[] 8192); Acc = (New-Object System.IO.MemoryStream); Task = $null; Done = $false; OnLine = $onStderr }
)
$exitedAt = $null
while ($true) {
	$active = @($streams | Where-Object { -not $_.Done })
	if ($active.Count -eq 0) { break }
	foreach ($s in $active) {
		if ($null -eq $s.Task) { $s.Task = $s.S.ReadAsync($s.Buf, 0, $s.Buf.Length) }
	}
	$tasks = [System.Threading.Tasks.Task[]]@($active | ForEach-Object { $_.Task })
	[void][System.Threading.Tasks.Task]::WaitAny($tasks, 1000)
	foreach ($s in $active) {
		if (-not $s.Task.IsCompleted) { continue }
		$n = 0
		try { $n = $s.Task.Result } catch { $n = 0 }
		$s.Task = $null
		if ($n -gt 0) { Split-Lines $s.Buf $n $s.Acc $s.OnLine }
		else { $s.Done = $true }
	}
	# 子が終わったのに、出力が閉じない (孫がパイプを持ったまま) とき、GraceSec 秒で読みを打ち切る
	if ($p.HasExited) {
		if ($null -eq $exitedAt) { $exitedAt = Get-Date }
		elseif (((Get-Date) - $exitedAt).TotalSeconds -ge $GraceSec) {
			Append ('# 子の終了から ' + $GraceSec + ' 秒たっても出力が閉じません (孫のプロセスがパイプを持ったまま残っている)。読みを打ち切ります')
			Emit ('出力の読みを打ち切りました (孫のプロセスが残っている)')
			break
		}
	}
}
# 改行まで届かなかった端数を出す
foreach ($s in $streams) {
	if ($s.Acc.Length -gt 0) { & $s.OnLine (Decode $s.Acc.ToArray()) }
}
if (-not $p.HasExited) { $p.WaitForExit() }
$code = $p.ExitCode
$global:RunWithLogExitCode = $code
Append ('# 終了コード: ' + $code + ' (' + (Get-Date).ToString('yyyy-MM-dd HH:mm:ss') + ')')
exit $code
