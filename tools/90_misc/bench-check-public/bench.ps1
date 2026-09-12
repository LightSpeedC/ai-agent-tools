<#
.SYNOPSIS
	check-public の検査を PowerShell で書いた見積もり用の実装。

.DESCRIPTION
	条件は bench.cs ・ bench.js と同じ（同じフォルダ・同じ拡張子・同じ 4 つの
	正規表現）。Windows PowerShell 5.1 で動く書き方にしてある。

.PARAMETER Path
	対象のフォルダ。
#>
param(
	[Parameter(Mandatory = $true)][string]$Path
)

$ErrorActionPreference = 'Stop'

$exts = @('.cs', '.ps1', '.md', '.html', '.cmd', '.txt', '.json', '.js')
$skipDirs = '\\(\.git|tmp|etc|node_modules)($|\\)'

$patterns = @(
	# 1. メールアドレス
	[regex]'[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}',
	# 2. C:\Users\ の直後がプレースホルダでないもの
	[regex]'[Cc]:\\Users\\(?!<|%|\$)[A-Za-z0-9._-]+',
	# 3. 認証情報に値が続くもの
	[regex]'(?i)(password|passwd|secret|api_key|token)\s*[:=]\s*[^\s"''<$%{]{4,}',
	# 5. 日本語・英数字の並びに混ざったキリル・ハングル
	[regex]'[\u0400-\u04FF\uAC00-\uD7AF]'
)

$sw = [System.Diagnostics.Stopwatch]::StartNew()

$files = 0
$lines = 0
$hits = 0

foreach ($f in [System.IO.Directory]::GetFiles($Path, '*', [System.IO.SearchOption]::AllDirectories)) {
	if ($f -match $skipDirs) { continue }
	if ($exts -notcontains ([System.IO.Path]::GetExtension($f)).ToLowerInvariant()) { continue }
	$files++
	foreach ($line in [System.IO.File]::ReadAllLines($f, [System.Text.Encoding]::UTF8)) {
		$lines++
		foreach ($p in $patterns) {
			if ($p.IsMatch($line)) { $hits++ }
		}
	}
}

$sw.Stop()
Write-Host ('files={0} lines={1} hits={2} inner_ms={3}' -f $files, $lines, $hits, $sw.ElapsedMilliseconds)
