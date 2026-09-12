<#
.SYNOPSIS
	Markdown が GitHub 上で正しく表示されるかを、実物のレンダラで確かめる。

.DESCRIPTION
	ローカルで正しく見える Markdown でも、GitHub では壊れることがある。
	代表が日本語の強調で、CommonMark は ** の前後の文字で開閉を判定するため、
	「〜」（〜）で囲む書き方だと ** が記号のまま表示される。

	このスクリプトは GitHub の Markdown API に md を投げ、返ってきた HTML に
	** が残っていないかを見る。推測ではなく実物で判定する。

	認証なしで 60 回/時のレート制限があるため、既定で 300ms 待って投げる。

.PARAMETER Path
	対象のフォルダまたはファイル。省略時はカレントディレクトリ。

.PARAMETER Recurse
	サブフォルダも対象にする。

.PARAMETER Exclude
	除外するパスの正規表現。既定は tmp / etc / node_modules / .git。

.PARAMETER Token
	GitHub のトークン。指定するとレート制限が 5000 回/時に緩む。省略可。

.PARAMETER DelayMs
	1 ファイルごとの待ち時間（ミリ秒）。既定 300。

.EXAMPLE
	check-markdown -Path . -Recurse

.EXAMPLE
	check-markdown -Path .\README.md
#>

<#
	オプションは -- 形式で受ける。ほかの道具（html2md ・ text ・
	convert-encoding ・ psh）に揃えるため。

	**PowerShell 流の -Path 形式も受ける。**共通ルールと他プロジェクトの
	呼び出しがその形で書かれているため、いきなり止めると壊れる。

	CmdletBinding は付けない。付けると知らない名前が来た時点で
	PowerShell がはじき、$args に入らないため自前で解釈できない。
#>
param()

$Path = '.'
$Recurse = $false
$Exclude = '\\(tmp|etc|node_modules|\.git)\\'
$Token = ''
$DelayMs = 300

function Show-Usage([bool]$ToStdout) {
	$lines = @(
		'Markdown が GitHub のレンダラで意図どおりに表示されるかを実測します。',
		'',
		'  check-markdown [--path <対象>] [--recurse] [--token <値>]',
		'                 [--exclude <正規表現>] [--delay-ms <ミリ秒>]',
		'',
		'  -p, --path <対象>         フォルダかファイル。既定はカレント',
		'  -r, --recurse             サブフォルダも見る',
		'  -t, --token <値>          GitHub のトークン。渡すと 5000 回/時になる',
		'  -e, --exclude <正規表現>  除外するパス',
		'      --delay-ms <ミリ秒>   1 ファイルごとの待ち。既定 300',
		'  -h, --help                この使い方を出す',
		'',
		'対象はオプション名を付けずに置いてもかまいません（check-markdown . -r）。',
		'古い -Path 形式も受けます。'
	)
	foreach ($l in $lines) {
		if ($ToStdout) { Write-Output $l } else { [Console]::Error.WriteLine($l) }
	}
}

# 引数の誤りは 2 で止める。黙って既定値で走らない
$ExitBadArgs = 2

$i = 0
while ($i -lt $args.Count) {
	$a = [string]$args[$i]
	$needsValue = $true
	<#
		switch -Regex は break を書かないと、マッチした分をすべて実行する。
		break が無いと --path が下の '^-' にも当たり、知らないオプション扱いになる
	#>
	switch -Regex ($a) {
		'^(-p|--path|-Path)$' { $Path = [string]$args[$i + 1]; break }
		'^(-e|--exclude|-Exclude)$' { $Exclude = [string]$args[$i + 1]; break }
		'^(-t|--token|-Token)$' { $Token = [string]$args[$i + 1]; break }
		'^(--delay-ms|-DelayMs)$' { $DelayMs = [int]$args[$i + 1]; break }
		'^(-r|--recurse|-Recurse)$' { $Recurse = $true; $needsValue = $false; break }
		'^(-h|--help)$' { Show-Usage $true; exit 0 }
		'^-' {
			[Console]::Error.WriteLine('[NG] 知らないオプションです: ' + $a)
			Show-Usage $false
			exit $ExitBadArgs
		}
		# ハイフンで始まらないものは対象として受ける（Linux 風の位置引数）
		default { $Path = $a; $needsValue = $false }
	}
	if ($needsValue) {
		if ($i + 1 -ge $args.Count) {
			[Console]::Error.WriteLine('[NG] ' + $a + ' に値がありません。')
			exit $ExitBadArgs
		}
		$i += 2
	}
	else { $i++ }
}

# 標準出力を UTF-8 にする。既定は CP932 で、Bash から呼ぶと日本語が化ける
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

$ErrorActionPreference = 'Stop'

Write-Host '=== Markdown の表示チェック（GitHub のレンダラ） ===' -ForegroundColor Cyan

# ---- 対象を集める ----
if (-not (Test-Path -LiteralPath $Path)) {
	Write-Host "パスが見つかりません: $Path" -ForegroundColor Red
	exit 2
}

$item = Get-Item -LiteralPath $Path
if ($item.PSIsContainer) {
	$files = @(Get-ChildItem -LiteralPath $item.FullName -Filter '*.md' -File -Recurse:$Recurse |
		Where-Object { $_.FullName -notmatch $Exclude } | Sort-Object FullName)
} else {
	$files = @($item)
}

if ($files.Count -eq 0) {
	Write-Host '対象の .md がありません' -ForegroundColor Yellow
	exit 0
}

Write-Host ("  対象: {0} ファイル" -f $files.Count)
Write-Host ''

# ---- API に投げる ----
$headers = @{ 'User-Agent' = 'check-markdown'; 'Accept' = 'application/vnd.github+json' }
if ($Token) { $headers['Authorization'] = "Bearer $Token" }

$root = if ($item.PSIsContainer) { $item.FullName } else { Split-Path $item.FullName }
$ngTotal = 0
$ngFiles = 0
$errFiles = 0

foreach ($f in $files) {
	$md = [System.IO.File]::ReadAllText($f.FullName)
	$body = @{ text = $md; mode = 'gfm' } | ConvertTo-Json -Compress

	try {
		# 日本語を壊さないよう UTF-8 のバイト列で送る
		$html = Invoke-RestMethod -Uri 'https://api.github.com/markdown' -Method Post `
			-Body ([System.Text.Encoding]::UTF8.GetBytes($body)) `
			-ContentType 'application/json' -Headers $headers -TimeoutSec 60
	}
	catch {
		Write-Host ("  {0,-34} 検証できません: {1}" -f $f.Name, $_.Exception.Message) -ForegroundColor Red
		$errFiles++
		continue
	}

	# コードブロックとコードスパンは対象外。GitHub は class を付けるので属性も許す
	$body2 = [regex]::Replace($html, '(?s)<pre[^>]*>.*?</pre>', '')
	$body2 = [regex]::Replace($body2, '(?s)<code[^>]*>.*?</code>', '')
	# 残りのタグも落とす。img の alt や a の title に ** があっても画面には出ない
	$body2 = [regex]::Replace($body2, '<[^>]+>', ' ')

	$hits = @([regex]::Matches($body2, '.{0,45}\*\*.{0,45}'))
	$rel = $f.FullName.Substring($root.Length).TrimStart('\')

	if ($hits.Count -eq 0) {
		Write-Host ("  {0,-34} OK" -f $rel) -ForegroundColor DarkGray
	} else {
		$ngFiles++
		$ngTotal += $hits.Count
		Write-Host ("  {0,-34} {1} 箇所" -f $rel, $hits.Count) -ForegroundColor Yellow
		foreach ($h in $hits) {
			$line = ($h.Value -replace '<[^>]+>', '') -replace '\s+', ' '
			Write-Host ("      {0}" -f $line.Trim())
		}
	}

	Start-Sleep -Milliseconds $DelayMs
}

Write-Host ''

# 検証できなかったファイルがあるなら「問題なし」とは言えない
if ($errFiles -gt 0) {
	Write-Host ("=== {0} ファイルを検証できませんでした ===" -f $errFiles) -ForegroundColor Red
	Write-Host 'レート制限（認証なしで 60 回/時）に達した可能性があります。'
	Write-Host '時間をおくか、-Token を渡して再実行してください。'
	if ($ngTotal -gt 0) {
		Write-Host ("あわせて {0} ファイルに {1} 箇所の問題が見つかっています。" -f $ngFiles, $ngTotal) -ForegroundColor Yellow
	}
	exit 2
}

if ($ngTotal -eq 0) {
	Write-Host '=== 問題なし。すべて正しく表示されます ===' -ForegroundColor Green
	exit 0
}

Write-Host ("=== {0} ファイルに {1} 箇所の問題があります ===" -f $ngFiles, $ngTotal) -ForegroundColor Yellow
Write-Host ''
Write-Host '日本語の強調が原因のことが多いです。CommonMark は ** の前後の文字で開閉を決めます。'
Write-Host '  開き: 直後が句読点なら、直前は空白か句読点でないと開かない（例: は**「〜」**です）'
Write-Host '  閉じ: 直前が句読点なら、直後は空白か句読点でないと閉じない（例: **〜です。**次に）'
Write-Host '該当箇所は <strong>〜</strong> に置き換えてください。GitHub は md 中の HTML を解釈します。'
exit 1
