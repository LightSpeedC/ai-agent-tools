# 使い方:
#   codex-trusted                         # 現在のフォルダを信頼して Codex を起動
#   codex-trusted W:\example              # 指定したフォルダを信頼して Codex を起動
#   codex-trusted -NoStart                # 現在のフォルダの信頼設定だけを確認・追加
#   .\bin\codex-trusted.ps1 -Target W:\example -NoStart

param(
	[string]$Target = (Get-Location).Path,
	[switch]$NoStart,
	[Parameter(ValueFromRemainingArguments = $true)]
	[string[]]$CodexArgs
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

$ErrorActionPreference = "Stop"

function Get-CanonicalProjectPaths {
	param([string]$InputPath)

	$resolved = (Resolve-Path -LiteralPath $InputPath).Path.Replace("/", "\").TrimEnd("\")
	if ($resolved -match "^(?i)c:\\work\\(.+)$") {
		$relative = $matches[1]
	} elseif ($resolved -match "^(?i)w:\\(.+)$") {
		$relative = $matches[1]
	} else {
		throw "対象は C:\work または W: 配下にしてください。"
	}

	$relative = $relative.Replace("/", "\").ToLowerInvariant()
	# 保存するキーは、入力のドライブ文字・区切り文字にかかわらずこの形式に固定する。
	return @("c:\work\$relative", "w:\$relative")
}

function Get-ProjectHeaders {
	param([string]$ConfigText)

	return [regex]::Matches($ConfigText, "(?m)^\[projects\.'([^']+)'\]") |
		ForEach-Object { $_.Groups[1].Value.ToLowerInvariant() }
}

$paths = Get-CanonicalProjectPaths -InputPath $Target
$configDirectory = Join-Path $env:USERPROFILE ".codex"
$configPath = Join-Path $configDirectory "config.toml"

if (-not (Test-Path -LiteralPath $configDirectory)) {
	New-Item -ItemType Directory -Path $configDirectory | Out-Null
}

$configText = if (Test-Path -LiteralPath $configPath) {
	[System.IO.File]::ReadAllText($configPath)
} else {
	""
}

$existing = Get-ProjectHeaders -ConfigText $configText
$missing = @($paths | Where-Object { $_ -notin $existing })

if ($missing.Count -gt 0) {
	$entries = $missing | ForEach-Object {
		"[projects.'{0}']`r`ntrust_level = ""trusted""" -f $_
	}
	$separator = if ([string]::IsNullOrWhiteSpace($configText)) { "" } else { "`r`n`r`n" }
	$updated = $configText.TrimEnd("`r", "`n") + $separator + ($entries -join "`r`n`r`n") + "`r`n"
	$backupPath = "$configPath.backup-" + (Get-Date -Format "yyyyMMdd-HHmmss")
	Copy-Item -LiteralPath $configPath -Destination $backupPath -ErrorAction SilentlyContinue
	[System.IO.File]::WriteAllText($configPath, $updated, [System.Text.UTF8Encoding]::new($false))
	Write-Output "信頼設定を追加しました。"
} else {
	Write-Output "信頼設定は既にあります。"
}

if ($NoStart) {
	exit 0
}

& codex --cd $paths[0] @CodexArgs
exit $LASTEXITCODE
