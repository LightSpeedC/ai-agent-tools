<#
	convert-encoding のテスト

	仕様書（notes/10_plan/p260906-01-convert-encoding.html）の 6 章に挙げた
	ケースを実行する。正しさはバイト列で確かめられるので、
	変換後の先頭バイト・改行の数・終了コードを見る。

	何度実行しても同じ結果になるよう、入力は毎回 tmp/ に作り直す。

	注意: 仕様書 6 章のケース 3・4 は「--to utf8 で LF のみ」を期待しているが、
	2 章の規則「改行を書かなければ、改行は変えない」と食い違う。
	ケース 5d・5f が規則側を裏付けているため、規則に従った期待値にしてある。
#>
[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'

# tools/40_test/ に置くため、2 階層上がプロジェクトルート
$Root = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$Exe = Join-Path $Root 'convert-encoding.exe'
$Work = Join-Path $Root 'tmp\convert-encoding-test'

$script:Pass = 0
$script:Fail = 0

# ---------------------------------------------------------------
# 補助
# ---------------------------------------------------------------

$EncUtf8 = New-Object System.Text.UTF8Encoding($false)
$EncUtf8Bom = New-Object System.Text.UTF8Encoding($true)
$EncSjis = [System.Text.Encoding]::GetEncoding(932)
$EncUtf16Le = New-Object System.Text.UnicodeEncoding($false, $true)

# テキストをファイルに書く。改行は呼び出し側で組み立てておく
function New-TextFile {
	param(
		[string]$Path,
		[string]$Text,
		[System.Text.Encoding]$Encoding
	)
	Set-Content -LiteralPath $Path -Value $Text -Encoding $Encoding -NoNewline
}

# バイト列をそのままファイルに書く。判定できない並びを作るのに使う
function New-RawFile {
	param(
		[string]$Path,
		[byte[]]$Bytes
	)
	if ($PSVersionTable.PSVersion.Major -ge 6) {
		Set-Content -LiteralPath $Path -Value $Bytes -AsByteStream
	} else {
		Set-Content -LiteralPath $Path -Value $Bytes -Encoding Byte
	}
}

function Get-Bytes {
	param([string]$Path)
	return [System.IO.File]::ReadAllBytes($Path)
}

# 先頭が指定のバイト列で始まるか
function Test-Prefix {
	param([byte[]]$Bytes, [byte[]]$Prefix)
	if ($Bytes.Length -lt $Prefix.Length) { return $false }
	for ($i = 0; $i -lt $Prefix.Length; $i++) {
		if ($Bytes[$i] -ne $Prefix[$i]) { return $false }
	}
	return $true
}

# 改行の数を数える。バイト列のまま数えるので文字コードに依らない…
# わけではないため、UTF-16 は対象にしない
function Measure-Eol {
	param([byte[]]$Bytes)
	$crlf = 0; $lf = 0; $cr = 0
	for ($i = 0; $i -lt $Bytes.Length; $i++) {
		if ($Bytes[$i] -eq 0x0D) {
			if ($i + 1 -lt $Bytes.Length -and $Bytes[$i + 1] -eq 0x0A) { $crlf++; $i++ }
			else { $cr++ }
		} elseif ($Bytes[$i] -eq 0x0A) {
			$lf++
		}
	}
	return [pscustomobject]@{ CrLf = $crlf; Lf = $lf; Cr = $cr }
}

# exe を実行して終了コードを返す。出力は捨てる
function Invoke-Exe {
	param([string[]]$Arguments)
	& $Exe @Arguments *> $null
	return $LASTEXITCODE
}

function Write-Ok {
	param([string]$Name, [string]$Detail)
	$script:Pass++
	Write-Host ('  [OK] ' + $Name + '  ' + $Detail) -ForegroundColor Green
}

function Write-Ng {
	param([string]$Name, [string]$Detail)
	$script:Fail++
	Write-Host ('  [NG] ' + $Name + '  ' + $Detail) -ForegroundColor Red
}

function Assert-Equal {
	param([string]$Name, $Expected, $Actual)
	if ($Expected -eq $Actual) {
		Write-Ok $Name ('= ' + $Expected)
	} else {
		Write-Ng $Name ('期待 ' + $Expected + ' / 実際 ' + $Actual)
	}
}

function Assert-True {
	param([string]$Name, [bool]$Value, [string]$Detail)
	if ($Value) { Write-Ok $Name $Detail } else { Write-Ng $Name $Detail }
}

# ケースごとの作業ファイルを作る
function New-Case {
	param([string]$Name)
	return (Join-Path $Work $Name)
}

# ---------------------------------------------------------------
# 準備
# ---------------------------------------------------------------

Write-Host ''
Write-Host '=== convert-encoding のテスト ===' -ForegroundColor Cyan

if (-not (Test-Path -LiteralPath $Exe)) {
	Write-Host ('convert-encoding.exe がありません。build-convert-encoding.cmd を実行してください') -ForegroundColor Red
	exit 2
}

if (Test-Path -LiteralPath $Work) { Remove-Item -LiteralPath $Work -Recurse -Force }
New-Item -ItemType Directory -Force -Path $Work | Out-Null

$Bom8 = [byte[]](0xEF, 0xBB, 0xBF)
$Bom16Le = [byte[]](0xFF, 0xFE)

# 日本語を含む本文。SJIS でも表現できる文字だけを使う
$Body = "1 行目" + "`n" + "2 行目" + "`n" + "3 行目"

# ---------------------------------------------------------------
Write-Host ''
Write-Host '[基本の変換]' -ForegroundColor Cyan

# 1. UTF-8 BOM なし + LF  --to ps1  →  BOM が付き、CRLF になる
$p = New-Case 'c01.txt'
New-TextFile $p $Body $EncUtf8
Assert-Equal '1 終了コード' 0 (Invoke-Exe @($p, '--to', 'ps1'))
$b = Get-Bytes $p
Assert-True '1 BOM が付く' (Test-Prefix $b $Bom8) '先頭 EF BB BF'
$e = Measure-Eol $b
Assert-True '1 CRLF だけになる' ($e.CrLf -eq 2 -and $e.Lf -eq 0 -and $e.Cr -eq 0) ('CRLF=' + $e.CrLf)

# 2. UTF-8 BOM なし + LF  --to cmd  →  BOM 無し、CP932、CRLF
$p = New-Case 'c02.txt'
New-TextFile $p $Body $EncUtf8
Assert-Equal '2 終了コード' 0 (Invoke-Exe @($p, '--to', 'cmd'))
$b = Get-Bytes $p
Assert-True '2 BOM が付かない' (-not (Test-Prefix $b $Bom8)) '先頭が BOM でない'
$e = Measure-Eol $b
Assert-True '2 CRLF だけになる' ($e.CrLf -eq 2 -and $e.Lf -eq 0) ('CRLF=' + $e.CrLf)
Assert-Equal '2 CP932 で読み戻せる' $Body ($EncSjis.GetString($b) -replace "`r`n", "`n")

# 3. SJIS + CRLF  --to utf8  →  BOM が消える。改行は入力のまま（規則に従う）
$p = New-Case 'c03.txt'
New-TextFile $p ($Body -replace "`n", "`r`n") $EncSjis
Assert-Equal '3 終了コード' 0 (Invoke-Exe @($p, '--to', 'utf8'))
$b = Get-Bytes $p
Assert-True '3 BOM が付かない' (-not (Test-Prefix $b $Bom8)) '先頭が BOM でない'
$e = Measure-Eol $b
Assert-True '3 改行は入力のまま' ($e.CrLf -eq 2 -and $e.Lf -eq 0) ('CRLF=' + $e.CrLf)

# 4. UTF-8 BOM 付き + CRLF  --to utf8  →  BOM が消える。改行は入力のまま
$p = New-Case 'c04.txt'
New-TextFile $p ($Body -replace "`n", "`r`n") $EncUtf8Bom
Assert-Equal '4 終了コード' 0 (Invoke-Exe @($p, '--to', 'utf8'))
$b = Get-Bytes $p
Assert-True '4 BOM が消える' (-not (Test-Prefix $b $Bom8)) '先頭が BOM でない'
$e = Measure-Eol $b
Assert-True '4 改行は入力のまま' ($e.CrLf -eq 2 -and $e.Lf -eq 0) ('CRLF=' + $e.CrLf)

# 5. UTF-16 LE  --to utf8  →  UTF-8 になり、内容が保たれる
$p = New-Case 'c05.txt'
New-TextFile $p $Body $EncUtf16Le
Assert-Equal '5 終了コード' 0 (Invoke-Exe @($p, '--to', 'utf8'))
$b = Get-Bytes $p
Assert-Equal '5 内容が保たれる' $Body ($EncUtf8.GetString($b))

# 5b. UTF-8 + LF  --to reg  →  UTF-16 LE の BOM が付き、CRLF になる
$p = New-Case 'c05b.reg'
New-TextFile $p $Body $EncUtf8
Assert-Equal '5b 終了コード' 0 (Invoke-Exe @($p, '--to', 'reg'))
$b = Get-Bytes $p
Assert-True '5b UTF-16 LE の BOM が付く' (Test-Prefix $b $Bom16Le) '先頭 FF FE'
Assert-Equal '5b 内容が保たれる' ($Body -replace "`n", "`r`n") ($EncUtf16Le.GetString($b, 2, $b.Length - 2))

# 5c. UTF-16 LE の .reg を --to reg  →  変更なし
$p = New-Case 'c05c.reg'
New-TextFile $p ($Body -replace "`n", "`r`n") $EncUtf16Le
$before = Get-Bytes $p
Assert-Equal '5c 終了コード' 0 (Invoke-Exe @($p, '--to', 'reg'))
$after = Get-Bytes $p
Assert-Equal '5c バイト数が変わらない' $before.Length $after.Length

# ---------------------------------------------------------------
Write-Host ''
Write-Host '[指定の解釈]' -ForegroundColor Cyan

# 5d. --to sjis  →  文字コードだけ変わる。改行は入力のまま
$p = New-Case 'c05d.txt'
New-TextFile $p $Body $EncUtf8
Assert-Equal '5d 終了コード' 0 (Invoke-Exe @($p, '--to', 'sjis'))
$e = Measure-Eol (Get-Bytes $p)
Assert-True '5d 改行は LF のまま' ($e.Lf -eq 2 -and $e.CrLf -eq 0) ('LF=' + $e.Lf)

# 5e. --to sjis/crlf  →  文字コードと改行の両方が変わる
$p = New-Case 'c05e.txt'
New-TextFile $p $Body $EncUtf8
Assert-Equal '5e 終了コード' 0 (Invoke-Exe @($p, '--to', 'sjis/crlf'))
$b = Get-Bytes $p
$e = Measure-Eol $b
Assert-True '5e CRLF になる' ($e.CrLf -eq 2 -and $e.Lf -eq 0) ('CRLF=' + $e.CrLf)
Assert-Equal '5e CP932 で読み戻せる' $Body ($EncSjis.GetString($b) -replace "`r`n", "`n")

# 5f. --to /crlf  →  改行だけ変わる。文字コードは入力のまま
$p = New-Case 'c05f.txt'
New-TextFile $p $Body $EncUtf8Bom
Assert-Equal '5f 終了コード' 0 (Invoke-Exe @($p, '--to', '/crlf'))
$b = Get-Bytes $p
Assert-True '5f BOM が残る' (Test-Prefix $b $Bom8) '先頭 EF BB BF'
$e = Measure-Eol $b
Assert-True '5f CRLF になる' ($e.CrLf -eq 2 -and $e.Lf -eq 0) ('CRLF=' + $e.CrLf)

# 5g. --to ps1  →  utf8bom + CRLF
$p = New-Case 'c05g.txt'
New-TextFile $p $Body $EncUtf8
Assert-Equal '5g 終了コード' 0 (Invoke-Exe @($p, '--to', 'ps1'))
$b = Get-Bytes $p
$e = Measure-Eol $b
Assert-True '5g BOM + CRLF' ((Test-Prefix $b $Bom8) -and $e.CrLf -eq 2 -and $e.Lf -eq 0) ('CRLF=' + $e.CrLf)

# 5h. --to ps1/lf  →  utf8bom + LF（改行を上書き）
$p = New-Case 'c05h.txt'
New-TextFile $p ($Body -replace "`n", "`r`n") $EncUtf8
Assert-Equal '5h 終了コード' 0 (Invoke-Exe @($p, '--to', 'ps1/lf'))
$b = Get-Bytes $p
$e = Measure-Eol $b
Assert-True '5h BOM + LF' ((Test-Prefix $b $Bom8) -and $e.Lf -eq 2 -and $e.CrLf -eq 0) ('LF=' + $e.Lf)

# 5i. 改行が混在した入力に --to sjis  →  混在したまま
$p = New-Case 'c05i.txt'
New-TextFile $p ("1 行目" + "`r`n" + "2 行目" + "`n" + "3 行目") $EncUtf8
Assert-Equal '5i 終了コード' 0 (Invoke-Exe @($p, '--to', 'sjis'))
$e = Measure-Eol (Get-Bytes $p)
Assert-True '5i 混在したまま' ($e.CrLf -eq 1 -and $e.Lf -eq 1) ('CRLF=' + $e.CrLf + ' LF=' + $e.Lf)

# ---------------------------------------------------------------
Write-Host ''
Write-Host '[改行]' -ForegroundColor Cyan

# 6. LF のみ  --to ps1  →  すべて CRLF。CR 単独が 0
$p = New-Case 'c06.txt'
New-TextFile $p $Body $EncUtf8
[void](Invoke-Exe @($p, '--to', 'ps1'))
$e = Measure-Eol (Get-Bytes $p)
Assert-True '6 すべて CRLF' ($e.CrLf -eq 2 -and $e.Lf -eq 0 -and $e.Cr -eq 0) ('CRLF=' + $e.CrLf)

# 7. CRLF のみ  --to ps1  →  変化しない（CRCRLF にならない）
$p = New-Case 'c07.txt'
New-TextFile $p ($Body -replace "`n", "`r`n") $EncUtf8Bom
[void](Invoke-Exe @($p, '--to', 'ps1'))
$e = Measure-Eol (Get-Bytes $p)
Assert-True '7 CRCRLF にならない' ($e.CrLf -eq 2 -and $e.Cr -eq 0) ('CRLF=' + $e.CrLf + ' CR=' + $e.Cr)

# 8. LF と CRLF の混在  --to ps1  →  すべて CRLF に揃う
$p = New-Case 'c08.txt'
New-TextFile $p ("1 行目" + "`r`n" + "2 行目" + "`n" + "3 行目") $EncUtf8
[void](Invoke-Exe @($p, '--to', 'ps1'))
$e = Measure-Eol (Get-Bytes $p)
Assert-True '8 すべて CRLF に揃う' ($e.CrLf -eq 2 -and $e.Lf -eq 0) ('CRLF=' + $e.CrLf)

# 9. CR 単独  --to ps1  →  CRLF になる
$p = New-Case 'c09.txt'
New-TextFile $p ("1 行目" + "`r" + "2 行目" + "`r" + "3 行目") $EncUtf8
[void](Invoke-Exe @($p, '--to', 'ps1'))
$e = Measure-Eol (Get-Bytes $p)
Assert-True '9 CR 単独が CRLF になる' ($e.CrLf -eq 2 -and $e.Cr -eq 0) ('CRLF=' + $e.CrLf + ' CR=' + $e.Cr)

# 10. 連続する空行  --to ps1  →  行数が変わらない
$p = New-Case 'c10.txt'
New-TextFile $p ("A" + "`n" + "`n" + "`n" + "B") $EncUtf8
[void](Invoke-Exe @($p, '--to', 'ps1'))
$e = Measure-Eol (Get-Bytes $p)
Assert-Equal '10 行数が変わらない' 3 $e.CrLf

# ---------------------------------------------------------------
Write-Host ''
Write-Host '[冪等性と境界]' -ForegroundColor Cyan

# 11. 同じ変換を 2 回  →  2 回目は書き込まない。更新日時が変わらない
$p = New-Case 'c11.txt'
New-TextFile $p $Body $EncUtf8
[void](Invoke-Exe @($p, '--to', 'ps1'))
$t1 = (Get-Item -LiteralPath $p).LastWriteTimeUtc
Start-Sleep -Milliseconds 1100
Assert-Equal '11 2 回目の終了コード' 0 (Invoke-Exe @($p, '--to', 'ps1'))
$t2 = (Get-Item -LiteralPath $p).LastWriteTimeUtc
Assert-True '11 更新日時が変わらない' ($t1 -eq $t2) ('' + $t1.ToString('HH:mm:ss.fff'))

# 12. 空のファイル  →  エラーにしない。BOM だけ付く
$p = New-Case 'c12.txt'
New-TextFile $p '' $EncUtf8
Assert-Equal '12 終了コード' 0 (Invoke-Exe @($p, '--to', 'ps1'))
$b = Get-Bytes $p
Assert-True '12 BOM だけになる' ($b.Length -eq 3 -and (Test-Prefix $b $Bom8)) ('' + $b.Length + ' バイト')

# 13. 末尾に改行が無いファイル  →  改行を足さない
$p = New-Case 'c13.txt'
New-TextFile $p 'A' $EncUtf8
[void](Invoke-Exe @($p, '--to', 'ps1'))
$e = Measure-Eol (Get-Bytes $p)
Assert-True '13 改行を足さない' ($e.CrLf -eq 0 -and $e.Lf -eq 0) '改行 0'

# 14. 純 ASCII のファイル  →  UTF-8 と判定される
$p = New-Case 'c14.txt'
New-TextFile $p "abc`ndef" $EncUtf8
$out = & $Exe $p --info
Assert-True '14 UTF8 と判定される' ($out -match 'UTF8\s') $out

# 15. 1 バイトのファイル  →  落ちない
$p = New-Case 'c15.txt'
New-RawFile $p ([byte[]](0x41))
Assert-Equal '15 落ちない' 0 (Invoke-Exe @($p, '--to', 'ps1'))

# ---------------------------------------------------------------
Write-Host ''
Write-Host '[失われる文字]' -ForegroundColor Cyan

# 16. 絵文字を含む UTF-8 を --to cmd  →  終了コード 4。書き換えない
$p = New-Case 'c16.txt'
New-TextFile $p ("困った" + [char]::ConvertFromUtf32(0x1F600) + "です") $EncUtf8
$before = Get-Bytes $p
Assert-Equal '16 終了コード' 4 (Invoke-Exe @($p, '--to', 'cmd'))
$after = Get-Bytes $p
Assert-True '16 書き換えない' ((Measure-Object -InputObject $before.Length).Count -eq 1 -and $before.Length -eq $after.Length) ('' + $after.Length + ' バイト')

# 17. 同上に --force  →  ? に置き換えて変換する
$p = New-Case 'c17.txt'
New-TextFile $p ("困った" + [char]::ConvertFromUtf32(0x1F600) + "です") $EncUtf8
Assert-Equal '17 終了コード' 0 (Invoke-Exe @($p, '--to', 'cmd', '--force'))
$s = $EncSjis.GetString((Get-Bytes $p))
Assert-True '17 ? に置き換わる' ($s.Contains('?')) $s

# 18. SJIS にある文字だけの UTF-8 を --to cmd  →  成功する（誤検知しない）
$p = New-Case 'c18.txt'
New-TextFile $p $Body $EncUtf8
Assert-Equal '18 誤検知しない' 0 (Invoke-Exe @($p, '--to', 'cmd'))

# ---------------------------------------------------------------
Write-Host ''
Write-Host '[判定]' -ForegroundColor Cyan

# 19. SJIS のファイルを --info  →  SJIS と表示される
$p = New-Case 'c19.txt'
New-TextFile $p $Body $EncSjis
$out = & $Exe $p --info
Assert-True '19 SJIS と表示される' ($out -match 'SJIS') $out

# 20. 判定できないバイト列  →  終了コード 3。書き込まない
#     0x80 単独は UTF-8 でも SJIS でも成立しない
$p = New-Case 'c20.txt'
New-RawFile $p ([byte[]](0x41, 0x80, 0x42))
$before = Get-Bytes $p
Assert-Equal '20 終了コード' 3 (Invoke-Exe @($p, '--to', 'ps1'))
$after = Get-Bytes $p
Assert-Equal '20 書き込まない' $before.Length $after.Length

# 21. 誤判定するファイルに --from を付ける  →  指定に従う
$p = New-Case 'c21.txt'
New-RawFile $p ([byte[]](0x41, 0x80, 0x42))
Assert-Equal '21 --from で続行する' 0 (Invoke-Exe @($p, '--to', 'utf8', '--from', 'sjis', '--force'))

# 22. 存在しないファイル  →  終了コード 2
Assert-Equal '22 終了コード' 2 (Invoke-Exe @((Join-Path $Work 'nothing.txt'), '--to', 'ps1'))

# 23. UTF-16 LE のファイルを --info  →  UTF16LE と表示される
$p = New-Case 'c23.txt'
New-TextFile $p $Body $EncUtf16Le
$out = & $Exe $p --info
Assert-True '23 UTF16LE と表示される' ($out -match 'UTF16LE') $out

# 24. --from utf8bom を指定して BOM が無い  →  続行する
$p = New-Case 'c24.txt'
New-TextFile $p $Body $EncUtf8
Assert-Equal '24 エラーにしない' 0 (Invoke-Exe @($p, '--to', 'ps1', '--from', 'utf8bom'))

# 25. --from に改行を書く  →  終了コード 1
$p = New-Case 'c25.txt'
New-TextFile $p $Body $EncUtf8
Assert-Equal '25 終了コード' 1 (Invoke-Exe @($p, '--to', 'ps1', '--from', 'sjis/crlf'))

# 26. --to に知らない名前  →  終了コード 1
$p = New-Case 'c26.txt'
New-TextFile $p $Body $EncUtf8
Assert-Equal '26 終了コード' 1 (Invoke-Exe @($p, '--to', 'ebcdic'))

# ---------------------------------------------------------------
Write-Host ''
Write-Host '[実際のファイルでの往復]' -ForegroundColor Cyan

# このプロジェクトの実ファイルを複製し、往復させてバイト列が戻ることを見る
$pairs = @(
	@{ Name = 'build.cmd'; Src = (Join-Path $Root 'build.cmd'); To = 'cmd' },
	@{ Name = 'html2md-ps.ps1'; Src = (Join-Path $Root 'html2md-ps.ps1'); To = 'ps1' }
)

foreach ($pair in $pairs) {
	if (-not (Test-Path -LiteralPath $pair.Src)) { continue }
	$p = Join-Path $Work $pair.Name
	Copy-Item -LiteralPath $pair.Src -Destination $p
	$before = Get-Bytes $p

	# いったん UTF-8 + LF に落としてから元の形へ戻す
	[void](Invoke-Exe @($p, '--to', 'utf8/lf'))
	[void](Invoke-Exe @($p, '--to', $pair.To))

	$after = Get-Bytes $p
	$same = $true
	if ($before.Length -ne $after.Length) {
		$same = $false
	} else {
		for ($i = 0; $i -lt $before.Length; $i++) {
			if ($before[$i] -ne $after[$i]) { $same = $false; break }
		}
	}
	Assert-True ($pair.Name + ' 往復して戻る') $same ('' + $after.Length + ' バイト')
}

# ---------------------------------------------------------------
# 後片付けと結果
# ---------------------------------------------------------------

Remove-Item -LiteralPath $Work -Recurse -Force

Write-Host ''
if ($script:Fail -eq 0) {
	Write-Host ('=== ' + $script:Pass + ' 件すべて成功 ===') -ForegroundColor Green
	exit 0
} else {
	Write-Host ('=== ' + $script:Fail + ' 件失敗（成功 ' + $script:Pass + ' 件）===') -ForegroundColor Red
	exit 1
}
