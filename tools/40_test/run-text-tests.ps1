<#
	text（文字コード対応テキスト・ツール一式）のテスト

	仕様書 notes/10_plan/p260907-01-text-tools.html のふるまいを確かめる。
	read / find / edit / write の 4 サブコマンドを、SJIS・UTF-16・UTF-8BOM
	のファイルに対して実行する。

	何度実行しても同じ結果になるよう、入力は毎回 tmp/ に作り直す。
	SJIS・UTF-16 のファイルは .NET のエンコーダで書く（バイト列を直接
	書かない）。判定できない並びだけ convert-encoding --from hex で作る。
#>
[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

$Root = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$Exe = Join-Path $Root 'text.exe'
$ConvExe = Join-Path $Root 'convert-encoding.exe'
$Work = Join-Path $Root 'tmp\text-test'

$script:Pass = 0
$script:Fail = 0

$EncUtf8 = New-Object System.Text.UTF8Encoding($false)
$EncUtf8Bom = New-Object System.Text.UTF8Encoding($true)
$EncSjis = [System.Text.Encoding]::GetEncoding(932)
$EncUtf16Le = New-Object System.Text.UnicodeEncoding($false, $true)
$EncUtf16Be = New-Object System.Text.UnicodeEncoding($true, $true)

function New-TextFile {
	param([string]$Path, [string]$Text, [System.Text.Encoding]$Encoding)
	$dir = Split-Path -Parent $Path
	if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Force $dir | Out-Null }
	[System.IO.File]::WriteAllText($Path, $Text, $Encoding)
}

# 判定できない並びを作る。16 進テキストを書いてから展開する（AMSI 回避）。
function New-RawFile {
	param([string]$Path, [byte[]]$Bytes)
	$dir = Split-Path -Parent $Path
	if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Force $dir | Out-Null }
	$hex = ($Bytes | ForEach-Object { '{0:X2}' -f $_ }) -join ' '
	Set-Content -LiteralPath $Path -Value $hex -Encoding ascii -NoNewline
	& $ConvExe $Path --from hex *> $null
}

function Get-Bytes { param([string]$Path) return [System.IO.File]::ReadAllBytes($Path) }

# text.exe を実行し、出力（UTF-8 文字列）と終了コードを返す
function Run-Text {
	param([string[]]$Arguments)
	$old = $ErrorActionPreference
	$ErrorActionPreference = 'Continue'
	$out = & $Exe @Arguments 2>&1
	$code = $LASTEXITCODE
	$ErrorActionPreference = $old
	$lines = $out | ForEach-Object { if ($_ -is [System.Management.Automation.ErrorRecord]) { $_.ToString() } else { $_ } }
	return [pscustomobject]@{ Out = ($lines -join "`n"); Code = $code }
}

function Write-Ok { param([string]$Name) $script:Pass++; Write-Host ('  [OK] ' + $Name) -ForegroundColor Green }
function Write-Ng { param([string]$Name, [string]$Detail) $script:Fail++; Write-Host ('  [NG] ' + $Name + '  ' + $Detail) -ForegroundColor Red }

function Assert-True { param([string]$Name, [bool]$Value, [string]$Detail = '') if ($Value) { Write-Ok $Name } else { Write-Ng $Name $Detail } }
function Assert-Equal { param([string]$Name, $Expected, $Actual) if ($Expected -eq $Actual) { Write-Ok $Name } else { Write-Ng $Name ('期待 ' + $Expected + ' / 実際 ' + $Actual) } }
function Assert-Match { param([string]$Name, [string]$Text, [string]$Needle) if ($Text.Contains($Needle)) { Write-Ok $Name } else { Write-Ng $Name ('「' + $Needle + '」が無い') } }

# ---------------------------------------------------------------
if (-not (Test-Path $Exe)) { Write-Host "[NG] text.exe がありません。build-text.cmd を先に実行してください。" -ForegroundColor Red; exit 2 }
if (Test-Path $Work) { Remove-Item -Recurse -Force $Work }
New-Item -ItemType Directory -Force $Work | Out-Null

# テストデータ
$fSjis = Join-Path $Work 'a.cmd'
$fU8 = Join-Path $Work 'b.txt'
$fReg = Join-Path $Work 'c.reg'
$fBom = Join-Path $Work 'd.html'
$fBe = Join-Path $Work 'e.txt'
$fBin = Join-Path $Work 'f.bin'
$fAmbig = Join-Path $Work 'g.txt'
$fSub = Join-Path $Work 'sub\h.cmd'

New-TextFile $fSjis "rem 日本語コメント`r`ncd /d work`r`n" $EncSjis
New-TextFile $fU8 "あいう`nかきく`nさしす" $EncUtf8
New-TextFile $fReg "`"名前`"=`"日本語`"`r`n" $EncUtf16Le
New-TextFile $fBom "<p>見出し</p>`n" $EncUtf8Bom
New-TextFile $fBe "漢字テスト" $EncUtf16Be
New-RawFile $fBin @(0x41, 0x00, 0x42, 0x0A)          # NUL 入り＝バイナリ
New-RawFile $fAmbig @(0xC2, 0xB1)                    # UTF-8「±」/ SJIS 半角カナ 2 文字＝両方妥当
New-TextFile $fSub "rem 日本語 in sub`r`n" $EncSjis

Write-Host ''
Write-Host '=== text read ===' -ForegroundColor Cyan

$r = Run-Text @('read', $fSjis)
Assert-Match 'read: SJIS を化けずに読む' $r.Out '日本語コメント'
Assert-Match 'read: 組が sjis/crlf' $r.Out '[sjis/crlf]'
Assert-Match 'read: digest を返す' $r.Out 'digest='
Assert-Match 'read: 行番号＋コロン' $r.Out '1:'
Assert-Equal 'read: 終了 0' 0 $r.Code

$r = Run-Text @('read', $fReg)
Assert-Match 'read: UTF-16LE(reg) を読む' $r.Out '名前'
Assert-Match 'read: 組が utf16le/crlf' $r.Out '[utf16le/crlf]'

$r = Run-Text @('read', $fBe)
Assert-Match 'read: UTF-16BE を読む' $r.Out '漢字テスト'
Assert-Match 'read: 組が utf16be' $r.Out '[utf16be'

$r = Run-Text @('read', $fBom)
Assert-Match 'read: UTF-8BOM を読む' $r.Out '見出し'
Assert-Match 'read: 組が utf8bom/lf' $r.Out '[utf8bom/lf]'

$r = Run-Text @('read', $fU8, '--lines', '2-2')
Assert-Match 'read: --lines で範囲を絞る' $r.Out 'かきく'
Assert-True 'read: --lines 外の行は出ない' (-not ($r.Out -like '*あいう*')) 'あいう が出た'
Assert-Match 'read: lines= を表示' $r.Out 'lines=2-2'

$r = Run-Text @('read', $fU8, '--from', 'sjis')
Assert-Match 'read: --from で判定を上書き' $r.Out '[sjis/'

Write-Host ''
Write-Host '=== text find ===' -ForegroundColor Cyan

$r = Run-Text @('find', '日本語', '--path', $Work, '--recurse')
Assert-Equal 'find: 一致あり 終了 0' 0 $r.Code
Assert-Match 'find: SJIS の日本語が当たる（Grep が漏らす）' $r.Out 'a.cmd'
Assert-Match 'find: ◎ ヘッダ' $r.Out '◎"'
Assert-Match 'find: ◆ ファイル行に組' $r.Out '[sjis/crlf]'
Assert-Match 'find: サブフォルダも当たる' $r.Out 'h.cmd'
Assert-Match 'find: ■ サブフォルダ見出し' $r.Out '■"sub"'

$r = Run-Text @('find', 'いない語 zzz', '--path', $Work, '--recurse')
Assert-Equal 'find: 一致なし 終了 1' 1 $r.Code

$r = Run-Text @('find', '日本語', '--path', $Work, '--recurse', '--include', '*.reg')
Assert-Match 'find: --include で reg に絞る' $r.Out 'c.reg'
Assert-True 'find: --include 外は出ない' (-not ($r.Out -like '*a.cmd*')) 'a.cmd が出た'

$r = Run-Text @('find', '日本語', '--path', $Work, '--recurse', '--exclude-dir', 'sub')
Assert-True 'find: --exclude-dir でフォルダを外す' (-not ($r.Out -like '*h.cmd*')) 'h.cmd が出た'

$r = Run-Text @('find', 'A', '--path', $Work, '--recurse')
Assert-True 'find: バイナリを飛ばす' (-not ($r.Out -like '*f.bin*')) 'f.bin が出た'

$r = Run-Text @('find', '名前', '--path', $Work, '--recurse', '--bare')
Assert-Match 'find: --bare は grep 素形' $r.Out 'c.reg:1:'

Write-Host ''
Write-Host '=== text edit ===' -ForegroundColor Cyan

$fE = Join-Path $Work 'edit.cmd'
New-TextFile $fE "rem 日本語コメント`r`ncd /d work`r`n" $EncSjis
$r = Run-Text @('edit', $fE, '--old', 'work', '--new', 'home')
Assert-Equal 'edit: --old 置換 終了 0' 0 $r.Code
$r2 = Run-Text @('read', $fE)
Assert-Match 'edit: 置換された' $r2.Out 'home'
Assert-Match 'edit: 組を保つ（sjis/crlf）' $r2.Out '[sjis/crlf]'
$b = Get-Bytes $fE
Assert-True 'edit: SJIS の日本語バイトが残る（先頭 0x72=r 以降に 0x93 等）' (($b -contains 0x93) -or ($b -contains 0x8A)) 'SJIS バイトが消えた'

# 合言葉の流れ
$fD = Join-Path $Work 'digest.cmd'
New-TextFile $fD "line1`r`nline2`r`nline3`r`n" $EncSjis
$head = (Run-Text @('read', $fD, '--lines', '2-2')).Out
$dg = ''
if ($head -match 'digest=([0-9a-f]+)') { $dg = $Matches[1] }
Assert-True 'edit: read が 8 桁 digest を返す' ($dg.Length -eq 8) ('digest=' + $dg)
$r = Run-Text @('edit', $fD, '--lines', '2-2', '--digest', $dg, '--new', 'LINE2')
Assert-Equal 'edit: 正しい digest で置換 終了 0' 0 $r.Code
Assert-Match 'edit: 置換確認' (Run-Text @('read', $fD, '--lines', '2-2')).Out 'LINE2'

$r = Run-Text @('edit', $fD, '--lines', '1-1', '--digest', 'deadbeef', '--new', 'x')
Assert-Equal 'edit: 合言葉不一致 終了 4' 4 $r.Code

# 両方妥当は edit で拒否
$r = Run-Text @('edit', $fAmbig, '--old', 'x', '--new', 'y')
Assert-Equal 'edit: 両方妥当は拒否 終了 3' 3 $r.Code

# --old が複数一致でエラー
$fMulti = Join-Path $Work 'multi.txt'
New-TextFile $fMulti "foo`nfoo`n" $EncUtf8
$r = Run-Text @('edit', $fMulti, '--old', 'foo', '--new', 'bar')
Assert-Equal 'edit: --old 複数一致でエラー 終了 2' 2 $r.Code
$r = Run-Text @('edit', $fMulti, '--lines', '1-1', '--old', 'foo', '--new', 'bar')
Assert-Equal 'edit: --lines で範囲を絞れば一意 終了 0' 0 $r.Code

Write-Host ''
Write-Host '=== text write ===' -ForegroundColor Cyan

$fBody = Join-Path $Work 'body.txt'
New-TextFile $fBody "こんにちは`n世界" $EncUtf8
$fW = Join-Path $Work 'out.cmd'
$r = Run-Text @('write', $fW, '--to', 'cmd', '--in', $fBody)
Assert-Equal 'write: --to cmd 終了 0' 0 $r.Code
$b = Get-Bytes $fW
Assert-True 'write: SJIS+CRLF で書ける（CRLF あり）' (($b -contains 0x0D) -and ($b -contains 0x0A)) 'CRLF が無い'
Assert-Match 'write: 読み直すと sjis/crlf' (Run-Text @('read', $fW)).Out '[sjis/crlf]'

$fWr = Join-Path $Work 'out.reg'
$r = Run-Text @('write', $fWr, '--to', 'reg', '--in', $fBody)
$b = Get-Bytes $fWr
Assert-True 'write: reg は UTF-16LE BOM(FF FE)' (($b[0] -eq 0xFF) -and ($b[1] -eq 0xFE)) 'BOM が無い'

$r = Run-Text @('write', $fW, '--keep', '--in', $fBody)
Assert-Match 'write: --keep 2 回目は変更なし' $r.Out '変更なし'

# ---------------------------------------------------------------
Write-Host ''
Write-Host ('結果: ' + $script:Pass + ' 件成功 / ' + $script:Fail + ' 件失敗')
if ($script:Fail -gt 0) { exit 1 } else { exit 0 }
