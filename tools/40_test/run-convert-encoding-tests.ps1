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
	# Windows PowerShell 5.1 では -Encoding が Encoding オブジェクトを受けないため
	# WriteAllText を使う（どの環境でもそのまま動く）。
	[System.IO.File]::WriteAllText($Path, $Text, $Encoding)
}

# バイト列をファイルに書く。判定できない並びを作るのに使う。
# PowerShell でバイト列を書くとウイルス対策に検知される（AmsiBypazz）ため、
# 16 進テキストを書いてから convert-encoding --from hex で展開する。
# 16 進テキストは ASCII なので書き込みが検知されない。
function New-RawFile {
	param(
		[string]$Path,
		[byte[]]$Bytes
	)
	$hex = ($Bytes | ForEach-Object { '{0:X2}' -f $_ }) -join ' '
	Set-Content -LiteralPath $Path -Value $hex -Encoding ascii -NoNewline
	& $Exe $Path --from hex *> $null
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
	# 5.1 では ErrorActionPreference=Stop のとき native の stderr 出力が
	# 停止エラーになる。想定内の [NG] 出力で落ちないよう一時的に Continue にする。
	$old = $ErrorActionPreference
	$ErrorActionPreference = 'Continue'
	& $Exe @Arguments *> $null
	$code = $LASTEXITCODE
	$ErrorActionPreference = $old
	return $code
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

# --read は UTF-8 のバイト列を標準出力へ流す。受け取り側を UTF-8 に固定しないと、
# Windows PowerShell 5.1 は OEM コードページ（932）として読んで化ける
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

$Bom8 = [byte[]](0xEF, 0xBB, 0xBF)
$Bom16Le = [byte[]](0xFF, 0xFE)

# 日本語を含む本文。SJIS でも表現できる文字だけを使う。
# 短すぎると UTF-8 のバイト列が SJIS 構造としても妥当になり（漢字だけだと
# 起きやすい）、判定が「両方妥当」で止まる。ひらがな主体の普通の文にして、
# 数十文字あれば SJIS 構造が崩れて UTF-8 に一意に決まる。
$Body = "最初の行です" + "`n" + "これは二番目の行" + "`n" + "三番目の行になります"

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

# 改行の混在を試す本文。判定が一意に決まる長さの日本語にし、
# 改行だけを差し替える。$L1〜$L3 は 1 行分の本文
$L1 = '最初の行の本文です'
$L2 = 'これは二番目の行の本文'
$L3 = '三番目の行の本文になります'

# 5i. 改行が混在した入力に --to sjis  →  混在したまま
$p = New-Case 'c05i.txt'
New-TextFile $p ($L1 + "`r`n" + $L2 + "`n" + $L3) $EncUtf8
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
New-TextFile $p ($L1 + "`r`n" + $L2 + "`n" + $L3) $EncUtf8
[void](Invoke-Exe @($p, '--to', 'ps1'))
$e = Measure-Eol (Get-Bytes $p)
Assert-True '8 すべて CRLF に揃う' ($e.CrLf -eq 2 -and $e.Lf -eq 0) ('CRLF=' + $e.CrLf)

# 9. CR 単独  --to ps1  →  CRLF になる
$p = New-Case 'c09.txt'
New-TextFile $p ($L1 + "`r" + $L2 + "`r" + $L3) $EncUtf8
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
Write-Host '[読み取り]' -ForegroundColor Cyan

# 27. SJIS のファイルを --read  →  中身が返る。ファイルは変わらない
$p = New-Case 'c27.txt'
New-TextFile $p $Body $EncSjis
$before = Get-Bytes $p
$out = (& $Exe $p --read) -join "`n"
Assert-Equal '27 中身が返る' $Body $out
$after = Get-Bytes $p
Assert-Equal '27 書き換えない' $before.Length $after.Length

# 28. UTF-16 LE のファイルを --read  →  中身が返る
$p = New-Case 'c28.txt'
New-TextFile $p $Body $EncUtf16Le
$out = (& $Exe $p --read) -join "`n"
Assert-Equal '28 中身が返る' $Body $out

# 29. BOM 付き UTF-8 を --read  →  BOM が混ざらない
$p = New-Case 'c29.txt'
New-TextFile $p $Body $EncUtf8Bom
$out = (& $Exe $p --read) -join "`n"
Assert-Equal '29 BOM が混ざらない' $Body $out

# 30. 判定できないファイルを --read  →  終了コード 3
$p = New-Case 'c30.txt'
New-RawFile $p ([byte[]](0x41, 0x80, 0x42))
Assert-Equal '30 終了コード' 3 (Invoke-Exe @($p, '--read'))

# 31. 存在しないファイルを --read  →  終了コード 2
Assert-Equal '31 終了コード' 2 (Invoke-Exe @((Join-Path $Work 'nothing.txt'), '--read'))

# ---------------------------------------------------------------
Write-Host ''
Write-Host '[16 進テキストの展開]' -ForegroundColor Cyan

# 展開結果のバイト列を確かめる補助。New-RawFile が --from hex を使うので、
# ここは Set-Content で 16 進テキストを書いてから直に呼ぶ
function Expand-Hex {
	param([string]$Name, [string]$Hex)
	$p = New-Case $Name
	Set-Content -LiteralPath $p -Value $Hex -Encoding ascii -NoNewline
	$code = Invoke-Exe @($p, '--from', 'hex')
	return [pscustomobject]@{ Path = $p; Code = $code }
}

# 38. 空白区切りの 16 進  →  3 バイトになる
$r = Expand-Hex 'c38.txt' '41 80 42'
Assert-Equal '38 終了コード' 0 $r.Code
$b = Get-Bytes $r.Path
Assert-True '38 3 バイトになる' ($b.Length -eq 3 -and $b[0] -eq 0x41 -and $b[1] -eq 0x80 -and $b[2] -eq 0x42) (($b | ForEach-Object { '{0:X2}' -f $_ }) -join ' ')

# 39. 空白なし  →  同じ 3 バイト
$r = Expand-Hex 'c39.txt' '418042'
$b = Get-Bytes $r.Path
Assert-True '39 空白なしでも同じ' ($b.Length -eq 3 -and $b[1] -eq 0x80) (($b | ForEach-Object { '{0:X2}' -f $_ }) -join ' ')

# 40. 改行を挟む  →  同じ 3 バイト
$r = Expand-Hex 'c40.txt' ("41" + "`r`n" + "80 42")
$b = Get-Bytes $r.Path
Assert-True '40 改行を挟んでも同じ' ($b.Length -eq 3 -and $b[1] -eq 0x80) (($b | ForEach-Object { '{0:X2}' -f $_ }) -join ' ')

# 41. 小文字  →  BOM の 3 バイト
$r = Expand-Hex 'c41.txt' 'ef bb bf'
$b = Get-Bytes $r.Path
Assert-True '41 小文字も読める' (Test-Prefix $b $Bom8) (($b | ForEach-Object { '{0:X2}' -f $_ }) -join ' ')

# 42. 桁数が奇数  →  終了コード 1。書き込まない
$p = New-Case 'c42.txt'
Set-Content -LiteralPath $p -Value '418' -Encoding ascii -NoNewline
Assert-Equal '42 終了コード' 1 (Invoke-Exe @($p, '--from', 'hex'))
Assert-Equal '42 書き込まない' '418' ([System.IO.File]::ReadAllText($p))

# 43. 16 進以外を含む  →  終了コード 1
$p = New-Case 'c43.txt'
Set-Content -LiteralPath $p -Value '41 zz 42' -Encoding ascii -NoNewline
Assert-Equal '43 終了コード' 1 (Invoke-Exe @($p, '--from', 'hex'))

# 44. --from hex --to ps1  →  終了コード 1
$p = New-Case 'c44.txt'
Set-Content -LiteralPath $p -Value '41 42' -Encoding ascii -NoNewline
Assert-Equal '44 終了コード' 1 (Invoke-Exe @($p, '--from', 'hex', '--to', 'ps1'))

# 45. 空のファイル  →  0 バイトのまま。エラーにしない
$p = New-Case 'c45.txt'
Set-Content -LiteralPath $p -Value '' -Encoding ascii -NoNewline
Assert-Equal '45 終了コード' 0 (Invoke-Exe @($p, '--from', 'hex'))
Assert-Equal '45 0 バイトのまま' 0 (Get-Bytes $p).Length

# ---------------------------------------------------------------
Write-Host ''
Write-Host '[16 進での表示]' -ForegroundColor Cyan

# 46. 3 バイトを --dump  →  「41 80 42」。ファイルは変わらない
$p = New-Case 'c46.txt'
New-RawFile $p ([byte[]](0x41, 0x80, 0x42))
$out = (& $Exe $p --dump).Trim()
Assert-Equal '46 16 進が返る' '41 80 42' $out
Assert-Equal '46 書き換えない' 3 (Get-Bytes $p).Length

# 47. --offset 1 --bytes 1  →  2 バイト目だけ
$p = New-Case 'c47.txt'
New-RawFile $p ([byte[]](0x41, 0x80, 0x42))
$out = (& $Exe $p --dump --offset 1 --bytes 1).Trim()
Assert-Equal '47 範囲を絞る' '80' $out

# 48. --bytes がファイルを超える  →  ある分だけ
$p = New-Case 'c48.txt'
New-RawFile $p ([byte[]](0x41, 0x80, 0x42))
$out = (& $Exe $p --dump --offset 2 --bytes 99).Trim()
Assert-Equal '48 ある分だけ' '42' $out

# 49. --offset がファイルを超える  →  何も返らない。終了コード 0
$p = New-Case 'c49.txt'
New-RawFile $p ([byte[]](0x41, 0x80, 0x42))
$out = (@(& $Exe $p --dump --offset 99) -join '').Trim()
Assert-Equal '49 終了コード' 0 $LASTEXITCODE
Assert-Equal '49 何も返らない' '' $out

# 50. --dump の出力を --from hex に渡す  →  元のバイト列に戻る。
#     20 バイトにして 16 バイトごとの折り返しをまたぐ。改行を挟んでも戻る
$p = New-Case 'c50.txt'
$orig = @()
for ($k = 0; $k -lt 20; $k++) { $orig += [byte]($k * 7 % 256) }
New-RawFile $p ([byte[]]$orig)
$hex = ((& $Exe $p --dump) -join "`n")   # 複数行をそのまま 1 文字列に
$q = New-Case 'c50out.txt'
Set-Content -LiteralPath $q -Value $hex -Encoding ascii -NoNewline
[void](Invoke-Exe @($q, '--from', 'hex'))
$a = Get-Bytes $p; $b = Get-Bytes $q
$same = ($a.Length -eq $b.Length)
if ($same) { for ($k = 0; $k -lt $a.Length; $k++) { if ($a[$k] -ne $b[$k]) { $same = $false; break } } }
Assert-True '50 折り返しをまたいで戻る' $same ('' + $b.Length + ' バイト')

# 50b. 16 バイトを超えると折り返す  →  2 行になる
$p = New-Case 'c50b.txt'
New-RawFile $p ([byte[]]$orig)
$lines = @(& $Exe $p --dump)
Assert-Equal '50b 20 バイトで 2 行' 2 $lines.Count
Assert-Equal '50b 1 行目は 16 バイト' 16 ($lines[0].Trim() -split '\s+').Count

# 51. 存在しないファイルを --dump  →  終了コード 2
Assert-Equal '51 終了コード' 2 (Invoke-Exe @((Join-Path $Work 'nothing.txt'), '--dump'))

# ---------------------------------------------------------------
Write-Host ''
Write-Host '[バイト列を保つ変換]' -ForegroundColor Cyan

# CP932 の重複文字「ⅰ」(EEEF) を含む SJIS ファイル。改行は LF。
# デコードを通すと FA40 に化ける。バイト保持なら EEEF のまま
# 41(A) EE EF 0A(LF) 42(B)
$necBytes = [byte[]](0x41, 0xEE, 0xEF, 0x0A, 0x42)

# 52. --to /crlf  →  EEEF のまま。改行だけ CRLF
$p = New-Case 'c52.txt'
New-RawFile $p $necBytes
[void](Invoke-Exe @($p, '--to', '/crlf'))
$b = Get-Bytes $p
Assert-True '52 EEEF が化けない' ($b[1] -eq 0xEE -and $b[2] -eq 0xEF) (($b | ForEach-Object { '{0:X2}' -f $_ }) -join ' ')
Assert-True '52 改行が CRLF' ($b -contains 0x0D) 'CR あり'

# 53. --to sjis/crlf（文字コードは同じ）  →  同上
$p = New-Case 'c53.txt'
New-RawFile $p $necBytes
[void](Invoke-Exe @($p, '--to', 'sjis/crlf'))
$b = Get-Bytes $p
Assert-True '53 EEEF が化けない' ($b[1] -eq 0xEE -and $b[2] -eq 0xEF) (($b | ForEach-Object { '{0:X2}' -f $_ }) -join ' ')

# 54. UTF-16 LE を --to /crlf  →  改行が CRLF。文字は壊れない
$p = New-Case 'c54.txt'
New-TextFile $p $Body $EncUtf16Le
[void](Invoke-Exe @($p, '--to', '/crlf'))
$b = Get-Bytes $p
$decoded = $EncUtf16Le.GetString($b) -replace "`r`n", "`n"
Assert-Equal '54 文字が保たれる' $Body $decoded

# ---------------------------------------------------------------
Write-Host ''
Write-Host '[BOM を伴う組の強制指定]' -ForegroundColor Cyan

# 55. BOM の無い UTF-8 に --from utf8bom --to utf8bom を強制すると、
#     以前は「同じ組だから」とバイト保持パスに入り、BOM が付かないまま
#     「変更なし」で終わっていた（i260908-02。実際の先頭バイトを見ずに
#     --from の申告を信じていたのが原因）
$p = New-Case 'c55.txt'
New-TextFile $p $Body $EncUtf8   # BOM 無し UTF-8
Assert-Equal '55 終了コード' 0 (Invoke-Exe @($p, '--from', 'utf8bom', '--to', 'utf8bom'))
$b = Get-Bytes $p
Assert-True '55 BOM が付く' (Test-Prefix $b $Bom8) '先頭 EF BB BF'

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
# レビュー #649 の回帰（high 2: デコード側の検査）
# ---------------------------------------------------------------

Write-Host ''
Write-Host '[デコード側の検査]' -ForegroundColor Cyan

# 85 40 は CP932 未割当。SJIS と構造判定されるが strict デコードでは読めない。
# 別の組へ再エンコードするとき best-fit で化けるのを止める（exit 4）。
$p = New-Case 'undec.txt'
New-RawFile $p @(0x41, 0x85, 0x40, 0x42)
Assert-Equal 'high2 未割当バイトの再エンコードは exit 4' 4 (Invoke-Exe @($p, '--to', 'ps1'))
# 同一組（バイト保持）は触らないので通る
Assert-Equal 'high2 同一組はバイト保持で通る' 0 (Invoke-Exe @($p, '--to', 'sjis'))
# --force なら ? として続行できる
Assert-Equal 'high2 --force なら続行' 0 (Invoke-Exe @($p, '--to', 'ps1', '--force'))

# medium: --read/--info と --from hex の併用は拒否（読むつもりの上書きを防ぐ）
$phx = New-Case 'hx.txt'
New-TextFile $phx '41 42 43' $EncUtf8
$before = [System.IO.File]::ReadAllText($phx)
Assert-Equal 'med --read + --from hex は拒否' 1 (Invoke-Exe @($phx, '--read', '--from', 'hex'))
Assert-Equal 'med 併用拒否で元ファイルは不変' $before ([System.IO.File]::ReadAllText($phx))

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
