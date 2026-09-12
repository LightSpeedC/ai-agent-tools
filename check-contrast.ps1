<#
.SYNOPSIS
	HTML の文字色と背景色のコントラストを、ブラウザで実測して確かめる。

.DESCRIPTION
	CSS を読み返しても「白背景に白文字」は見つからない。変数が未定義で background だけが
	無効化され、color だけが生き残る事故は、宣言を眺めても気づけないため。

	このスクリプトはブラウザで実際にレンダリングし、テキストを持つ全要素について
	前景色と実効背景色からコントラスト比を計算する。透明な背景は親を遡り、
	グラデーションは色停止点の平均色を使う。

	判定は「読めない」箇所の検出に絞る。WCAG AA（4.5:1）で判定すると、文字が
	1文字も乗っていないグラデーションの端まで拾い、誤検出で本当の問題が埋もれる。

	ブラウザは Playwright 共有環境のものを使う（既定パスは -PlaywrightRoot 参照）。

.PARAMETER Path
	対象のフォルダまたはファイル。省略時はカレントディレクトリ。

.PARAMETER Recurse
	サブフォルダも対象にする。

.PARAMETER Exclude
	除外するパスの正規表現。既定は tmp / etc / node_modules / .git / contrast
	（contrast はこのツール自身の自己診断用フィクスチャの置き場で、意図して
	コントラスト不良を作ってあるため）。

.PARAMETER Min
	これを下回るコントラスト比を報告する。既定 1.5。

.PARAMETER PlaywrightRoot
	Playwright 共有環境のルート。既定値は param ブロックを参照。

.EXAMPLE
	check-contrast -Path . -Recurse

.EXAMPLE
	check-contrast -Path .\README.html
#>

param(
	[string]$Path = '.',
	[switch]$Recurse,
	[string]$Exclude = '\\(tmp|etc|node_modules|\.git|contrast)\\',
	[double]$Min = 1.5,
	[string]$PlaywrightRoot = 'N:\PlayWright'
)

# 標準出力を UTF-8 にする。既定は CP932 で、Bash から呼ぶと日本語が化ける
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

$ErrorActionPreference = 'Stop'

Write-Host '=== HTML のコントラスト実測（ブラウザで描画して計測） ===' -ForegroundColor Cyan

# ---- 前提の確認 ----
$cjs = Join-Path $PSScriptRoot 'contrast\check-contrast.cjs'
if (-not (Test-Path -LiteralPath $cjs)) {
	Write-Host "検査スクリプトが見つかりません: $cjs" -ForegroundColor Red
	exit 2
}

if (-not (Test-Path -LiteralPath (Join-Path $PlaywrightRoot 'node_modules\playwright'))) {
	Write-Host "Playwright の共有環境が見つかりません: $PlaywrightRoot" -ForegroundColor Red
	Write-Host '-PlaywrightRoot で場所を指定してください。'
	exit 2
}

# ---- 対象を集める ----
if (-not (Test-Path -LiteralPath $Path)) {
	Write-Host "パスが見つかりません: $Path" -ForegroundColor Red
	exit 2
}

$item = Get-Item -LiteralPath $Path
if ($item.PSIsContainer) {
	$files = @(Get-ChildItem -LiteralPath $item.FullName -Filter '*.html' -File -Recurse:$Recurse |
		Where-Object { $_.FullName -notmatch $Exclude } | Sort-Object FullName)
} else {
	$files = @($item)
}

if ($files.Count -eq 0) {
	Write-Host '対象の .html がありません' -ForegroundColor Yellow
	exit 0
}

# リダイレクトページは転送先を二重に検査してしまうので外す
$targets = @()
$redirects = 0
foreach ($f in $files) {
	$html = [System.IO.File]::ReadAllText($f.FullName)
	if ($html -match 'http-equiv\s*=\s*["'']?refresh' -or $html -match 'location\.replace\s*\(') {
		$redirects++
	} else {
		$targets += $f
	}
}

if ($targets.Count -eq 0) {
	Write-Host '対象がすべてリダイレクトページでした' -ForegroundColor Yellow
	exit 0
}

Write-Host ("  対象: {0} ファイル（しきい値 {1}:1）" -f $targets.Count, $Min)
if ($redirects -gt 0) {
	Write-Host ("  リダイレクトページ {0} 件は除外しました" -f $redirects) -ForegroundColor DarkGray
}
Write-Host ''

# ---- 計測する ----
$tmpDir = Join-Path $PSScriptRoot 'tmp'
if (-not (Test-Path -LiteralPath $tmpDir)) { New-Item -ItemType Directory -Path $tmpDir | Out-Null }
$inputPath = Join-Path $tmpDir 'contrast-input.json'
$errPath = Join-Path $tmpDir 'contrast-stderr.txt'

$payload = [ordered]@{
	files          = @($targets | ForEach-Object { $_.FullName })
	min            = $Min
	playwrightRoot = $PlaywrightRoot.Replace('\', '/')
}
[System.IO.File]::WriteAllText($inputPath, ($payload | ConvertTo-Json -Compress -Depth 4), (New-Object System.Text.UTF8Encoding($false)))

$prev = $ErrorActionPreference
$ErrorActionPreference = 'Continue'
$raw = & node $cjs $inputPath 2>$errPath
$code = $LASTEXITCODE
$ErrorActionPreference = $prev

if ($code -ne 0 -or -not $raw) {
	Write-Host '計測に失敗しました' -ForegroundColor Red
	if (Test-Path -LiteralPath $errPath) { Get-Content -LiteralPath $errPath | ForEach-Object { Write-Host "  $_" } }
	exit 2
}

$results = ($raw -join '') | ConvertFrom-Json

# ---- 報告する ----
$root = if ($item.PSIsContainer) { $item.FullName } else { Split-Path $item.FullName }
$ngTotal = 0
$ngFiles = 0
$errFiles = 0

foreach ($r in $results) {
	$rel = $r.file.Substring($root.Length).TrimStart('\')

	if ($r.PSObject.Properties.Name -contains 'error') {
		Write-Host ("  {0,-38} 検証できません: {1}" -f $rel, $r.error) -ForegroundColor Red
		$errFiles++
		continue
	}

	$issues = @($r.issues)
	if ($issues.Count -eq 0) {
		Write-Host ("  {0,-38} OK" -f $rel) -ForegroundColor DarkGray
		continue
	}

	$ngFiles++
	$ngTotal += $issues.Count
	Write-Host ("  {0,-38} {1} 箇所" -f $rel, $issues.Count) -ForegroundColor Yellow
	foreach ($i in $issues) {
		$sel = if ($i.cls) { "{0}.{1}" -f $i.tag, ($i.cls -split '\s+' -join '.') } else { $i.tag }
		Write-Host ("      {0,5}:1  {1}" -f $i.ratio, $sel)
		Write-Host ("             文字色 {0} / 背景 {1}" -f $i.color, $i.background) -ForegroundColor DarkGray
		Write-Host ("             ""{0}""" -f $i.text) -ForegroundColor DarkGray
	}
}

Write-Host ''

if ($errFiles -gt 0) {
	Write-Host ("=== {0} ファイルを検証できませんでした ===" -f $errFiles) -ForegroundColor Red
	exit 2
}

if ($ngTotal -eq 0) {
	Write-Host '=== 問題なし。読めない配色はありません ===' -ForegroundColor Green
	exit 0
}

Write-Host ("=== {0} ファイルに {1} 箇所の問題があります ===" -f $ngFiles, $ngTotal) -ForegroundColor Yellow
Write-Host ''
Write-Host '文字色と背景色がほぼ同じになっています。次のいずれかが原因のことが多いです。'
Write-Host '  1. 色の var() が未定義で background だけ無効化され、color だけ残った'
Write-Host '     → var(--accent, #12224d) のようにフォールバックを書く'
Write-Host '  2. 配色セレクタが広すぎて、想定外の要素に片方だけ当たった'
Write-Host '     → .toc a ではなく .toc ul a のように要素構造で絞る'
Write-Host '  3. 濃い背景の親から color を継承したまま、淡い背景の中に置かれた'
Write-Host '     → その要素に color と background を対で指定する'
exit 1
