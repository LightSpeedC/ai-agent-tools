<#
	html2md のテスト

	tests/cases/ 配下の HTML を exe と ps1 の両方で変換し、次を確かめる。

	  1. exe が異常終了しないこと
	  2. ps1 が異常終了しないこと
	  3. exe と ps1 の出力が完全に一致すること
	  4. ケースごとに決めた「出ているべき文字列」がすべて出ていること

	3 が要になる。参照実装の ps1 と本実装の exe が食い違ったら、
	どちらかに入れ忘れた修正がある。

	何度実行しても同じ結果になるよう、変換は tmp/ に複製してから行う。
	tests/cases/ の HTML は書き換えない。
#>
[CmdletBinding()]
param(
	# 対象のケース名（省略時はすべて）
	[string]$Case
)

$ErrorActionPreference = 'Stop'

# tools/40_test/ に置くため、2 階層上がプロジェクトルート
$Root = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$CasesDir = Join-Path $Root 'tests\cases'
$WorkRoot = Join-Path $Root 'tmp\test-run'
$Exe = Join-Path $Root 'html2md.exe'
$Ps1 = Join-Path $Root 'html2md.ps1'

# ケースごとに「変換後の Markdown に出ているべき文字列」を並べる。
# ここに書いたものが 1 つでも欠けたら失敗にする。
$Expect = @{
	'tags' = @(
		'T01 p の中身',
		'T02 div の中身',          # p で囲んでいない div の地の文
		'T06 blockquote の中身',   # 同上（blockquote）
		'T08 nav の中身',
		'T09 footer の中身',
		'T34 テキスト',            # ブロックと混在した地の文（前）
		'T36 末尾テキスト',        # 同上（後ろ）
		'| T16 th |',              # 表のヘッダ
		'| T17 td |'               # 表のデータ行
	)
	'div' = @(
		'ケース1: テキストだけの div',
		'ケース2: クラス付きでテキストだけの div',
		'ケース4: テキスト',
		'ケース5: p で囲んでいない callout',   # callout の地の文
		'> [!NOTE]'
	)
	'chapters' = @(
		'第1部 基礎編'
	)
	'link' = @(
		'外部CSSのテスト',
		'本文'
	)
	'log-test' = @(
		# 閉じていない div。最後の 1 行まで出ること
		'2026-08-30 12:44:58.448',
		'2026-08-30 13:00:02.321',
		'2026-08-30 13:01:12.100'
	)
}

function Write-Result([string]$Mark, [string]$Text) {
	Write-Host ('  {0} {1}' -f $Mark, $Text)
}

Write-Host ''
Write-Host '=== html2md のテスト ===' -ForegroundColor Cyan

if (-not (Test-Path -LiteralPath $Exe)) {
	Write-Host ('html2md.exe がありません。build.cmd を実行してください: ' + $Exe) -ForegroundColor Red
	exit 2
}

$cases = @(Get-ChildItem -LiteralPath $CasesDir -Directory | Sort-Object Name)
if ($Case) { $cases = @($cases | Where-Object { $_.Name -eq $Case }) }
if ($cases.Count -eq 0) {
	Write-Host 'テストケースがありません' -ForegroundColor Yellow
	exit 2
}

Write-Host ('  ケース: {0} 件' -f $cases.Count)
Write-Host ''

$failed = 0

foreach ($c in $cases) {
	Write-Host ('[{0}]' -f $c.Name)

	# 毎回まっさらな作業フォルダに複製する（前回の結果を持ち越さない）
	$work = Join-Path $WorkRoot $c.Name
	if (Test-Path -LiteralPath $work) { Remove-Item -LiteralPath $work -Recurse -Force }
	New-Item -ItemType Directory -Path $work -Force | Out-Null
	Copy-Item -Path (Join-Path $c.FullName '*') -Destination $work -Recurse -Force

	$ok = $true

	# --- exe で変換 ---
	& cmd /c "`"$Exe`" --root `"$work`" --dir docs --dir notes > `"$work\exe.log`" 2>&1"
	$exeCode = $LASTEXITCODE
	if ($exeCode -gt 1) {
		Write-Result '[NG]' ('exe が異常終了しました（終了コード {0}）' -f $exeCode)
		$ok = $false
	}
	$exeOut = @{}
	foreach ($f in @(Get-ChildItem -LiteralPath $work -Recurse -File -Filter '*.md')) {
		$exeOut[$f.FullName.Substring($work.Length)] = [System.IO.File]::ReadAllText($f.FullName, [System.Text.Encoding]::UTF8)
	}
	if ($exeOut.Count -eq 0) {
		Write-Result '[NG]' 'exe が Markdown を 1 つも生成しませんでした'
		$ok = $false
	}

	# --- 出ているべき文字列 ---
	$all = ($exeOut.Values -join "`n")
	if ($Expect.ContainsKey($c.Name)) {
		foreach ($e in $Expect[$c.Name]) {
			if (-not $all.Contains($e)) {
				Write-Result '[NG]' ('出力に含まれていません: ' + $e)
				$ok = $false
			}
		}
	}

	# --- ps1 で変換して突き合わせる ---
	$ps1Err = $null
	try {
		& $Ps1 -Root $work *> (Join-Path $work 'ps1.log')
	}
	catch {
		$ps1Err = $_.Exception.Message
	}
	if ($ps1Err) {
		Write-Result '[NG]' ('ps1 が例外で止まりました: ' + $ps1Err)
		$ok = $false
	}
	else {
		foreach ($k in $exeOut.Keys) {
			$path = $work + $k
			if (-not (Test-Path -LiteralPath $path)) { continue }
			$ps1Text = [System.IO.File]::ReadAllText($path, [System.Text.Encoding]::UTF8)
			# ps1 は README.html と docs/ しか見ないため、notes/ 配下は比較しない
			if ($k -like '\notes\*') { continue }
			if ($ps1Text -cne $exeOut[$k]) {
				$d = Compare-Object ($exeOut[$k] -split "`r?`n") ($ps1Text -split "`r?`n")
				Write-Result '[NG]' ('exe と ps1 の出力が違います{0}（差分 {1} 行）' -f $k, $d.Count)
				$d | Select-Object -First 6 | ForEach-Object {
					$side = if ($_.SideIndicator -eq '<=') { 'exe' } else { 'ps1' }
					Write-Host ('        {0}: {1}' -f $side, $_.InputObject)
				}
				$ok = $false
			}
		}
	}

	if ($ok) {
		Write-Result '[OK]' ('{0} ファイルを変換、exe と ps1 が一致' -f $exeOut.Count)
	}
	else {
		$failed++
	}
}

Write-Host ''
if ($failed -eq 0) {
	Write-Host ('=== {0} ケースすべて成功 ===' -f $cases.Count) -ForegroundColor Green
	exit 0
}
Write-Host ('=== {0} / {1} ケースが失敗 ===' -f $failed, $cases.Count) -ForegroundColor Red
exit 1
