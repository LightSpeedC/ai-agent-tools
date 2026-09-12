<#
.SYNOPSIS
	check-contrast ・ check-markdown のオプション解釈を確かめる。

.DESCRIPTION
	この 2 つだけ PowerShell 流の -Path 形式で、ほかの 4 つ
	（html2md ・ text ・ convert-encoding ・ psh）は -- 形式だった。
	呼ぶ側が道具ごとに書き分けることになるため -- へ寄せる。

	**旧形式も受ける。**共通ルールと他プロジェクトの呼び出しが -Path で
	書かれているため、いきなり止めると壊れる。

	ブラウザと GitHub の API は使わない。空のフォルダを渡して、
	オプションが解釈できたかだけを見る。
#>
[CmdletBinding()]
param()

# 標準出力を UTF-8 にする。既定は CP932 で、Bash から呼ぶと日本語が化ける
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

$ErrorActionPreference = 'Stop'

$Root = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$Work = Join-Path $Root 'tmp\check-tools-tests'

$pass = 0
$fail = 0

function Ok([string]$Name) {
	$script:pass++
	Write-Host ('  [OK] ' + $Name)
}

function Ng([string]$Name, [string]$Detail) {
	$script:fail++
	Write-Host ('  [NG] ' + $Name + '  ' + $Detail) -ForegroundColor Red
}

function AssertCode([string]$Name, [int]$Expected, [int]$Actual) {
	if ($Expected -eq $Actual) { Ok $Name } else { Ng $Name ('期待 ' + $Expected + ' / 実際 ' + $Actual) }
}

function AssertMatch([string]$Name, [string]$Pattern, [string]$Text) {
	if ($Text -match $Pattern) { Ok $Name } else { Ng $Name ('"' + $Pattern + '" が出ない: ' + $Text.Substring(0, [Math]::Min(120, $Text.Length))) }
}

# 対象を渡す先。空のフォルダなら 0 件で正常終了する
if (Test-Path -LiteralPath $Work) { Remove-Item -LiteralPath $Work -Recurse -Force }
New-Item -ItemType Directory -Path $Work -Force | Out-Null

<#
	道具を呼んで、終了コードと出力を返す。

	Stop のままだと、相手が標準エラーへ書いた時点で
	NativeCommandError として例外になる。**誤りを出す道具を試せない**ので、
	この呼び出しの間だけ Continue にする
#>
function RunTool([string]$Tool, [string[]]$ToolArgs) {
	$script = Join-Path $Root ($Tool + '.ps1')
	$prev = $ErrorActionPreference
	$ErrorActionPreference = 'Continue'
	try {
		$out = & powershell -NoProfile -ExecutionPolicy Bypass -File $script @ToolArgs 2>&1 | Out-String
	}
	finally { $ErrorActionPreference = $prev }
	return [pscustomobject]@{ Code = $LASTEXITCODE; Out = $out }
}

Write-Host ''
Write-Host '=== check ツールのオプション ===' -ForegroundColor Cyan
Write-Host ''

foreach ($tool in @('check-contrast', 'check-markdown')) {
	<#
		1. -- 形式で対象を渡せる

		終了コードだけでは足りない。解釈できないと既定の「.」に落ちて
		**プロジェクト全体を検査し、それでも 0 で終わる**。
		対象の件数まで見て、渡した先が効いていることを確かめる
	#>
	$r = RunTool $tool @('--path', $Work)
	AssertCode ($tool + ' --path は 0 で終わる') 0 $r.Code
	AssertMatch ($tool + ' --path で対象が絞られる') '対象の \.\w+ がありません' $r.Out

	# 2. 旧形式も受ける（共通ルールと他プロジェクトが -Path で書いている）
	$r = RunTool $tool @('-Path', $Work)
	AssertMatch ($tool + ' -Path も受ける') '対象の \.\w+ がありません' $r.Out

	# 3. --recurse を付けても通る
	$r = RunTool $tool @('--path', $Work, '--recurse')
	AssertMatch ($tool + ' --recurse を受ける') '対象の \.\w+ がありません' $r.Out

	# 4. --help は使い方を出して 0（ほかの 4 つに揃える）
	$r = RunTool $tool @('--help')
	AssertCode ($tool + ' --help は 0 で終わる') 0 $r.Code
	AssertMatch ($tool + ' --help は使い方を出す') '--path' $r.Out

	# 5. 知らないオプションは 2 で止める。黙って既定値で走らない
	$r = RunTool $tool @('--nonsense')
	AssertCode ($tool + ' 知らないオプションは 2') 2 $r.Code

	<#
		6. 短縮形と位置引数（Linux 風）

		-p ・ -r ・ -h の 1 文字と、オプション名を付けずに置いた対象。
		どちらも --path と同じに解釈する
	#>
	$r = RunTool $tool @('-p', $Work)
	AssertMatch ($tool + ' -p は --path と同じ') '対象の \.\w+ がありません' $r.Out

	$r = RunTool $tool @($Work)
	AssertMatch ($tool + ' 対象は名前なしでも渡せる') '対象の \.\w+ がありません' $r.Out

	$r = RunTool $tool @('-p', $Work, '-r')
	AssertMatch ($tool + ' -r は --recurse と同じ') '対象の \.\w+ がありません' $r.Out

	$r = RunTool $tool @('-h')
	AssertCode ($tool + ' -h は 0 で終わる') 0 $r.Code
}

Remove-Item -LiteralPath $Work -Recurse -Force -ErrorAction SilentlyContinue

Write-Host ''
if ($fail -eq 0) {
	Write-Host ('=== ' + $pass + ' 件すべて成功 ===') -ForegroundColor Green
	exit 0
}
Write-Host ('=== ' + $fail + ' 件失敗（成功 ' + $pass + ' 件）===') -ForegroundColor Red
exit 1
