<#
	convert-encoding のテスト

	仕様書（notes/10_plan/p260906-01-convert-encoding.html）の 6 章に挙げた
	ケースを実行する。正しさはバイト列で確かめられるので、
	変換後の先頭バイト・改行の数・終了コードを見る。

	何度実行しても同じ結果になるよう、入力は毎回 tmp/ に作り直す。

	仕様書 6 章のケース 3・4 は、受け取った時点では「--to utf8 で LF のみ」を
	期待しており 2 章の規則「改行を書かなければ、改行は変えない」と食い違って
	いたが、記述ミスと判断し規則に合わせて直した（仕様書側の callout を参照）。
	このテストの期待値もその規則に従っている。
#>
[CmdletBinding()]
param(
	# 試す実装。既定は C# の exe。移植版を突き合わせるときに差し替える
	# （例: -Target (Join-Path $Root 'public\convert-encoding.cmd')）
	[string]$Target
)

$ErrorActionPreference = 'Stop'

# tools/40_test/ に置くため、2 階層上がプロジェクトルート
$Root = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
# 既定は移植版（ランチャー経由）。C# 版を見るときは -Target で名指しする
$Exe = if ($Target) { $Target } else { Join-Path $Root 'convert-encoding.cmd' }
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
	Write-Host ('対象がありません。C# 版を見るなら build-convert-encoding-cs.cmd を実行してください') -ForegroundColor Red
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

# 14. 純 ASCII のファイル  →  ascii と表示される（判定は utf8 のまま）
$p = New-Case 'c14.txt'
New-TextFile $p "abc`ndef" $EncUtf8
$out = & $Exe $p --info
Assert-True '14 ascii と表示される' ($out -cmatch 'ascii\s') $out

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
Assert-True '19 sjis と表示される' ($out -cmatch 'sjis') $out

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
Assert-True '23 utf16le と表示される' ($out -cmatch 'utf16le') $out

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

# 56. BOM 付きの UTF-8 に --from utf8 --to utf8 を強制すると、
#     以前は「プリアンブルが要らない組だから」で先頭バイトを見ずに通り、
#     BOM が残ったまま「変更なし」で終わっていた（定期レビュー #2 の medium 3。
#     HasCorrectPreamble が「足りない」方向しか見ていなかったのが原因）
$p = New-Case 'c56.txt'
New-TextFile $p $Body $EncUtf8Bom   # BOM 付き UTF-8
Assert-Equal '56 終了コード' 0 (Invoke-Exe @($p, '--from', 'utf8', '--to', 'utf8'))
$b = Get-Bytes $p
Assert-True '56 BOM が消える' (-not (Test-Prefix $b $Bom8)) '先頭が BOM でない'

# ---------------------------------------------------------------
Write-Host ''
Write-Host '[フォルダを見る（--info と --check）]' -ForegroundColor Cyan

# 規約に合うものと合わないものを混ぜたフォルダを作り、
# --info は全件、--check は違反だけを出すことを確かめる。
# 除外（tmp・先頭 _・バイナリ）も同じフォルダで見る。
$Tree = Join-Path $Work 'tree'
if (Test-Path -LiteralPath $Tree) { Remove-Item -LiteralPath $Tree -Recurse -Force }
New-Item -ItemType Directory -Path (Join-Path $Tree 'sub') -Force | Out-Null
New-Item -ItemType Directory -Path (Join-Path $Tree 'tmp') -Force | Out-Null

# 規約どおり（違反ではない）
New-TextFile (Join-Path $Tree 'ok.ps1')  ($L1 + "`r`n" + $L2 + "`r`n") $EncUtf8Bom
New-TextFile (Join-Path $Tree 'ok.html') ($L1 + "`n" + $L2 + "`n")     $EncUtf8Bom
New-TextFile (Join-Path $Tree 'ok.md')   ($L1 + "`n" + $L2 + "`n")     $EncUtf8
New-TextFile (Join-Path $Tree 'ok.cmd')  ($L1 + "`r`n")                $EncSjis
# 規約に合わない 3 件
New-TextFile (Join-Path $Tree 'bad.ps1')      ($L1 + "`n" + $L2 + "`n") $EncUtf8Bom   # CRLF であるべき
New-TextFile (Join-Path $Tree 'sub\bad.html') ($L1 + "`n")              $EncUtf8      # BOM が要る
New-TextFile (Join-Path $Tree 'sub\bad.ts')   ($L1 + "`r`n")            $EncUtf8      # LF であるべき
# 見ないもの
New-TextFile (Join-Path $Tree 'tmp\ignored.ps1') ($L1 + "`n") $EncUtf8Bom             # tmp は除外
New-TextFile (Join-Path $Tree '_secret.ps1')     ($L1 + "`n") $EncUtf8Bom             # 先頭 _ は除外
New-RawFile  (Join-Path $Tree 'bin.dat') @(0x00, 0x01, 0x02, 0xFF, 0x00)              # バイナリは除外

$infoOut = (& $Exe $Tree --info 2>&1 | Out-String)
Assert-Equal 'c1 --info の終了コード（違反があっても 0）' 0 (Invoke-Exe @($Tree, '--info'))
Assert-True 'c1 --info は規約どおりのものも出す' ($infoOut -match 'ok\.ps1') 'ok.ps1 が出る'
Assert-True 'c1 --info は違反も出す' ($infoOut -match 'bad\.ps1') 'bad.ps1 が出る'
Assert-True 'c1 --info は再帰する' ($infoOut -match 'bad\.ts') 'sub/bad.ts が出る'
Assert-True 'c2 tmp は見ない' (-not ($infoOut -match 'ignored\.ps1')) 'ignored.ps1 が出ない'
Assert-True 'c2 先頭 _ は見ない' (-not ($infoOut -match '_secret')) '_secret.ps1 が出ない'
Assert-True 'c2 バイナリは見ない' (-not ($infoOut -match 'bin\.dat')) 'bin.dat が出ない'

$checkOut = (& $Exe $Tree --check 2>&1 | Out-String)
Assert-Equal 'c3 --check の終了コード（違反あり）' 1 (Invoke-Exe @($Tree, '--check'))
Assert-True 'c3 --check は違反だけ出す（ok は出ない）' (-not ($checkOut -match 'ok\.ps1')) 'ok.ps1 が出ない'
Assert-True 'c3 --check に bad.ps1' ($checkOut -match 'bad\.ps1') '出る'
Assert-True 'c3 --check に bad.html' ($checkOut -match 'bad\.html') '出る'
Assert-True 'c3 --check に bad.ts' ($checkOut -match 'bad\.ts') '出る'

# 違反を直すと 0 になる
[void](Invoke-Exe @((Join-Path $Tree 'bad.ps1'), '--to', 'ps1'))
[void](Invoke-Exe @((Join-Path $Tree 'sub\bad.html'), '--to', 'html'))
[void](Invoke-Exe @((Join-Path $Tree 'sub\bad.ts'), '--to', 'utf8/lf'))
Assert-Equal 'c4 直したら --check は 0' 0 (Invoke-Exe @($Tree, '--check'))

# 純 ASCII なら UTF-8 と SJIS でバイト列が同じ。どちらと判定されても違反にしない
# （日本語を含まない cmd を「SJIS でない」と言わないため）
New-TextFile (Join-Path $Tree 'ascii.cmd') ("@echo off`r`n") $EncUtf8
Assert-Equal 'c7 純 ASCII の cmd は違反にしない' 0 (Invoke-Exe @($Tree, '--check'))

# 1 ファイルに渡したときの表示は変えない
$one = (& $Exe (Join-Path $Tree 'ok.cmd') --info 2>&1 | Out-String)
Assert-True 'c5 1 ファイルの --info は従来どおり' ($one -cmatch 'sjis' -and $one -cmatch 'crlf=') '組と改行の数が出る'

# 絞り込み
$incOut = (& $Exe $Tree --check --include '*.html' 2>&1 | Out-String)
Assert-True 'c6 --include で絞れる' (-not ($incOut -match '\.ts')) 'ts は出ない'
$excOut = (& $Exe $Tree --info --exclude-dir 'sub' 2>&1 | Out-String)
Assert-True 'c6 --exclude-dir が効く' (-not ($excOut -match 'bad\.ts')) 'sub の中が出ない'
# カンマ区切りでまとめて書ける（text find と同じ語彙）
$twoOut = (& $Exe $Tree --info --include '*.html,*.cmd' 2>&1 | Out-String)
Assert-True 'c6 --include はカンマ区切り（html）' ($twoOut -match 'ok\.html') 'html が出る'
Assert-True 'c6 --include はカンマ区切り（cmd）' ($twoOut -match 'ok\.cmd') 'cmd が出る'
Assert-True 'c6 --include はカンマ区切り（外は出ない）' (-not ($twoOut -match 'ok\.ps1')) 'ps1 は出ない'
$excFile = (& $Exe $Tree --info --exclude 'ok.*' 2>&1 | Out-String)
Assert-True 'c6 --exclude でファイルを外す' (-not ($excFile -match 'ok\.ps1')) 'ok.ps1 が出ない'

# ---------------------------------------------------------------
Write-Host ''
Write-Host '[表示は小文字に揃える]' -ForegroundColor Cyan

# 指定側（--to / --from）は元から小文字。表示も小文字にして一致させる。
# text 側は元から小文字で、convert-encoding だけが大文字だった。
# PowerShell の -match は既定で大小を区別しないため、ここは -cmatch で見る
$p = New-Case 'low1.txt'
New-TextFile $p ($L1 + "`r`n" + $L2 + "`r`n") $EncSjis
$lowOut = (& $Exe $p --info 2>&1 | Out-String)
Assert-True 'l1 組が小文字で出る' ($lowOut -cmatch 'sjis') $lowOut.Trim()
Assert-True 'l1 大文字では出ない' (-not ($lowOut -cmatch 'SJIS')) '大文字の SJIS が無い'
Assert-True 'l2 改行のラベルも小文字' ($lowOut -cmatch 'crlf=2') $lowOut.Trim()
Assert-True 'l2 大文字のラベルは出ない' (-not ($lowOut -cmatch 'CRLF=')) '大文字の CRLF= が無い'

# 変換した行も小文字
$p = New-Case 'low2.txt'
New-TextFile $p ($L1 + "`n") $EncUtf8
$lowConv = (& $Exe $p --to ps1 2>&1 | Out-String)
Assert-True 'l3 変換の行が小文字' ($lowConv -cmatch 'utf8bom\+crlf') $lowConv.Trim()

# エラーメッセージの組名も小文字。
# ここは stderr を読むので、Invoke-Exe と同じ手当てが要る。5.1 では
# ErrorActionPreference=Stop のとき native の stderr 出力が停止エラーになる
$p = New-Case 'low3.txt'
New-TextFile $p "困った✓です`n" $EncUtf8
$oldEap = $ErrorActionPreference
$ErrorActionPreference = 'Continue'
$lowErr = (& $Exe $p --to sjis 2>&1 | Out-String)
$ErrorActionPreference = $oldEap
Assert-True 'l4 エラーの組名も小文字' ($lowErr -cmatch 'sjis で表現できない') $lowErr.Trim()

# ---------------------------------------------------------------
Write-Host ''
Write-Host '[純 ASCII は ascii と表示する]' -ForegroundColor Cyan

# 純 ASCII は utf8 と sjis でバイト列が同じ。片方の名前だけを出すと
# 「cmd なのに utf8」と読めてしまうため、表示だけ ascii にする。
# 判定（--from に渡せる組）は utf8 のままで、ascii という組は増やさない
$p = New-Case 'asc1.cmd'
New-TextFile $p "@echo off`r`n" $EncUtf8
$ascOut = (& $Exe $p --info 2>&1 | Out-String)
Assert-True 'a1 --info は ascii と出す' ($ascOut -cmatch 'ascii') $ascOut.Trim()

# 日本語が入れば ascii ではない
$p = New-Case 'asc2.txt'
New-TextFile $p ($L1 + "`n") $EncUtf8
$ascOut2 = (& $Exe $p --info 2>&1 | Out-String)
Assert-True 'a2 日本語入りは ascii にしない' (-not ($ascOut2 -cmatch 'ascii')) $ascOut2.Trim()

# 変換した行の変換元も ascii と出る
$p = New-Case 'asc3.txt'
New-TextFile $p "abc`n" $EncUtf8
$ascConv = (& $Exe $p --to ps1 2>&1 | Out-String)
Assert-True 'a3 変換の行も ascii' ($ascConv -cmatch 'ascii\+lf') $ascConv.Trim()

# 組が増えたわけではないので --from ascii は受けない
$p = New-Case 'asc4.txt'
New-TextFile $p "abc`n" $EncUtf8
Assert-Equal 'a4 --from ascii は受けない' 1 (Invoke-Exe @($p, '--from', 'ascii', '--to', 'utf8'))

# ---------------------------------------------------------------
Write-Host ''
Write-Host '[規約を定めていない拡張子の改行は問わない]' -ForegroundColor Cyan

# .gitattributes の「* text=auto eol=lf」で git 側は LF に正規化される。
# 作業ツリーの改行まで縛ると、手で CRLF にした txt が毎回違反に出る。
# 文字コードは git が変換しないので、そちらは見る
$Tree2 = Join-Path $Work 'tree2'
if (Test-Path -LiteralPath $Tree2) { Remove-Item -LiteralPath $Tree2 -Recurse -Force }
New-Item -ItemType Directory -Path $Tree2 -Force | Out-Null

New-TextFile (Join-Path $Tree2 'memo.txt') ($L1 + "`r`n" + $L2 + "`r`n") $EncUtf8
Assert-Equal 'x1 CRLF の txt は違反にしない' 0 (Invoke-Exe @($Tree2, '--check'))

# 規約を定めた拡張子は今までどおり見る
New-TextFile (Join-Path $Tree2 'a.ts') ($L1 + "`r`n") $EncUtf8
Assert-Equal 'x2 CRLF の ts は違反' 1 (Invoke-Exe @($Tree2, '--check'))
Remove-Item -LiteralPath (Join-Path $Tree2 'a.ts') -Force

# 混在と単独 CR は、どの拡張子でも違反
New-TextFile (Join-Path $Tree2 'mix.txt') ($L1 + "`r`n" + $L2 + "`n") $EncUtf8
Assert-Equal 'x3 混在は txt でも違反' 1 (Invoke-Exe @($Tree2, '--check'))
Remove-Item -LiteralPath (Join-Path $Tree2 'mix.txt') -Force

New-TextFile (Join-Path $Tree2 'cr.txt') ($L1 + "`r" + $L2 + "`r") $EncUtf8
Assert-Equal 'x4 単独 CR は txt でも違反' 1 (Invoke-Exe @($Tree2, '--check'))
Remove-Item -LiteralPath (Join-Path $Tree2 'cr.txt') -Force

# 文字コードは見る（BOM 付きの txt は違反）
New-TextFile (Join-Path $Tree2 'bom.txt') ($L1 + "`r`n") $EncUtf8Bom
Assert-Equal 'x5 BOM 付きの txt は違反' 1 (Invoke-Exe @($Tree2, '--check'))
$x5Out = (& $Exe $Tree2 --check 2>&1 | Out-String)
Assert-True 'x5 あるべき組に改行を書かない' ($x5Out -cmatch 'txt は utf8(?!\+)') $x5Out.Trim()
Remove-Item -LiteralPath (Join-Path $Tree2 'bom.txt') -Force

# あるべき組の呼び名は拡張子。用途名の無いものも「既定」ではなく拡張子で出す
New-TextFile (Join-Path $Tree2 'b.ts') ($L1 + "`r`n") $EncUtf8
$x6Out = (& $Exe $Tree2 --check 2>&1 | Out-String)
Assert-True 'x6 拡張子の名前で出す' ($x6Out -cmatch 'ts は utf8\+lf') $x6Out.Trim()

# ---------------------------------------------------------------
Write-Host ''
Write-Host '[実際のファイルでの往復]' -ForegroundColor Cyan

# このプロジェクトの実ファイルを複製し、往復させてバイト列が戻ることを見る
$pairs = @(
	@{ Name = 'build-html2md-cs.cmd'; Src = (Join-Path $Root 'build-html2md-cs.cmd'); To = 'cmd' },
	# 日本語を多く含む大きめの ps1 を選ぶ。往復で 1 バイトでも変われば落ちる
	@{ Name = 'run-tests.ps1'; Src = (Join-Path $Root 'tools\40_test\run-tests.ps1'); To = 'ps1' }
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
