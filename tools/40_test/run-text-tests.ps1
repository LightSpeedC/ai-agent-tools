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
param(
	# 試す実装。既定は C# の exe。移植版を突き合わせるときに差し替える
	# （例: -Target (Join-Path $Root 'bin\text.cmd')）
	[string]$Target
)

$ErrorActionPreference = 'Stop'

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

$Root = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
# 既定は移植版（ランチャー経由）。C# 版を見るときは -Target で名指しする
$Exe = if ($Target) { $Target } else { Join-Path $Root 'bin\text.cmd' }
$ConvExe = Join-Path $Root 'bin\convert-encoding.cmd'
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
if (-not (Test-Path $Exe)) { Write-Host ("[NG] 対象がありません: " + $Exe + "  C# 版を見るなら build-text-cs.cmd を先に実行してください。") -ForegroundColor Red; exit 2 }
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

# 純 ASCII は utf8 と sjis でバイト列が同じ。片方の名前だけを出すと
# 「cmd なのに utf8」と読めてしまうため、表示だけ ascii にする。
# convert-encoding と同じ見せ方に揃える（判定する組は増やさない）
$fAscii = Join-Path $Work 'i.cmd'
New-TextFile $fAscii "@echo off`r`n" $EncUtf8
$r = Run-Text @('read', $fAscii)
Assert-Match 'read: 純 ASCII は ascii と出す' $r.Out '[ascii/crlf]'

Write-Host ''
Write-Host '=== text find ===' -ForegroundColor Cyan

$r = Run-Text @('find', '日本語', '--path', $Work, '--recurse')
Assert-Equal 'find: 一致あり 終了 0' 0 $r.Code
Assert-Match 'find: SJIS の日本語が当たる（Grep が漏らす）' $r.Out 'a.cmd'
Assert-Match 'find: ◎ ヘッダ' $r.Out '◎"'
Assert-Match 'find: ◆ ファイル行に組' $r.Out '[sjis/crlf]'
Assert-Match 'find: サブフォルダも当たる' $r.Out 'h.cmd'
Assert-Match 'find: ■ サブフォルダ見出し' $r.Out '■"sub"'

# find のファイル行の組も ascii に揃える
$r = Run-Text @('find', 'echo', '--path', $Work, '--recurse')
Assert-Match 'find: 純 ASCII は ascii と出す' $r.Out '[ascii/crlf]'

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

<#
	既定で外すフォルダ（i260913-02）

	tmp ・ etc ・ node_modules ・ .git を素通ししていたため、--recurse を
	素で撃つと会話ログ（etc/history/jsonl）まで読んでいた。
	**共通ルール「.gitignore で除外されたものは読まない」を破る。**
	check-markdown ・ check-contrast は既にこの 4 つを既定で外している。
#>
foreach ($d in @('tmp', 'etc', 'node_modules', '.git')) {
	New-Item -ItemType Directory -Path (Join-Path $Work $d) -Force | Out-Null
	[System.IO.File]::WriteAllText((Join-Path $Work ($d + '\hidden.txt')), "既定で外すフォルダの中`n", (New-Object System.Text.UTF8Encoding($false)))
}

$r = Run-Text @('find', '既定で外すフォルダ', '--path', $Work, '--recurse')
Assert-Equal 'find: 既定で外すフォルダだけなら一致なし' 1 $r.Code
foreach ($d in @('tmp', 'etc', 'node_modules', '.git')) {
	Assert-True ('find: 既定で ' + $d + ' を外す') (-not ($r.Out -like ('*' + $d + '*'))) ($d + ' が出た')
}

# 明示すれば戻せる。意図して見たいときの逃げ道を残す
$r = Run-Text @('find', '既定で外すフォルダ', '--path', $Work, '--recurse', '--no-default-exclude')
Assert-Equal 'find: --no-default-exclude で見る' 0 $r.Code
Assert-Match 'find: --no-default-exclude なら tmp も出る' $r.Out 'hidden.txt'

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

# 両方妥当は --old-file / --new-file（内容ファイル）でも拒否する（i260908-02）。
# 対象ファイル（上のテスト）は拒否していたが、内容ファイル側は組の判定結果を
# 見ずに UTF-8 として黙って復号していた
$fTarget = Join-Path $Work 'target-for-ambig.txt'
New-TextFile $fTarget 'x' $EncUtf8
$r = Run-Text @('edit', $fTarget, '--old', 'x', '--new-file', $fAmbig)
Assert-Equal 'edit: --new-file が両方妥当なら拒否 終了 3' 3 $r.Code
$r = Run-Text @('edit', $fTarget, '--old-file', $fAmbig, '--new', 'y')
Assert-Equal 'edit: --old-file が両方妥当なら拒否 終了 3' 3 $r.Code

# 読めないバイトがあると置換位置がずれるため、edit を止める（i260908-04）。
# A + 不正な SJIS 2 バイト（85 40）+ 改行 + B + 改行。2 行目（B）を書き換えようと
# すると、1 行目の不正バイトを再エンコードした長さが元と食い違い、実際とは
# 違う位置を切ってしまう
$fBadSjis = Join-Path $Work 'bad-sjis.txt'
New-RawFile $fBadSjis @(0x41, 0x85, 0x40, 0x0A, 0x42, 0x0A)
$before = Get-Bytes $fBadSjis
$r = Run-Text @('edit', $fBadSjis, '--from', 'sjis', '--lines', '2-2', '--new', 'X')
Assert-Equal 'edit: 読めないバイトがあれば拒否 終了 2' 2 $r.Code
Assert-True 'edit: 拒否時は元ファイルが不変' ((Get-Bytes $fBadSjis) -join ',' -eq ($before -join ',')) '書き換わった'

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
# 短い漢字だけの文だと UTF-8 のバイト列が SJIS 構造としても妥当になり、
# 組が曖昧（Ambiguous）と判定されて --in の読み込みが拒否される。
# ひらがな主体の長めの文にして一意に決まるようにする
New-TextFile $fBody "こんにちは`n今日はよい天気です" $EncUtf8
$fW = Join-Path $Work 'out.cmd'
$r = Run-Text @('write', $fW, '--to', 'cmd', '--in', $fBody)
Assert-Equal 'write: --to cmd 終了 0' 0 $r.Code
$b = Get-Bytes $fW
Assert-True 'write: SJIS+CRLF で書ける（CRLF あり）' (($b -contains 0x0D) -and ($b -contains 0x0A)) 'CRLF が無い'
Assert-Match 'write: 読み直すと sjis/crlf' (Run-Text @('read', $fW)).Out '[sjis/crlf]'

# 両方妥当な --in（内容ファイル）は拒否する（i260908-02）
$r = Run-Text @('write', $fW, '--to', 'cmd', '--in', $fAmbig)
Assert-Equal 'write: --in が両方妥当なら拒否 終了 3' 3 $r.Code

$fWr = Join-Path $Work 'out.reg'
$r = Run-Text @('write', $fWr, '--to', 'reg', '--in', $fBody)
$b = Get-Bytes $fWr
Assert-True 'write: reg は UTF-16LE BOM(FF FE)' (($b[0] -eq 0xFF) -and ($b[1] -eq 0xFE)) 'BOM が無い'

$r = Run-Text @('write', $fW, '--keep', '--in', $fBody)
Assert-Match 'write: --keep 2 回目は変更なし' $r.Out '変更なし'

Write-Host ''
Write-Host '=== レビュー #649 の回帰 ===' -ForegroundColor Cyan

# high 3: 第 2 引数が標準入力より優先され、0 バイト上書きにならない
$fH3 = Join-Path $Work 'h3.cmd'
$r = Run-Text @('write', $fH3, '--to', 'cmd', '@echo off')
Assert-True 'high3: 第 2 引数が空にならない（0 バイトでない）' ((Get-Item $fH3).Length -gt 0) '0 バイトになった'
Assert-Match 'high3: 中身が第 2 引数になる' (Run-Text @('read', $fH3)).Out '@echo off'

# high 4: 変換先で表現できない文字は exit 5 で止まる（黙って ? にしない）
$r = Run-Text @('write', (Join-Path $Work 'h4.cmd'), '--to', 'cmd', '見出し😀')
Assert-Equal 'high4: write の未対応文字は exit 5' 5 $r.Code
$fH4e = Join-Path $Work 'h4e.cmd'
New-TextFile $fH4e "rem 日本語`r`n@echo off`r`n" $EncSjis
$r = Run-Text @('edit', $fH4e, '--old', '@echo off', '--new', '@echo off ✓')
Assert-Equal 'high4: edit の未対応文字は exit 5' 5 $r.Code

# medium: find <語> <パス>（grep と同じ書き方）で位置引数のパスを使う
$r = Run-Text @('find', '日本語', $Work, '--recurse')
Assert-Equal 'med: find の第 2 引数がパスとして効く（一致あり）' 0 $r.Code
Assert-Match 'med: 位置引数のパスを探す' $r.Out 'a.cmd'

# medium: --lines 無しの digest が全文で一致する（末尾改行のファイル）
$fDg = Join-Path $Work 'dg.txt'
New-TextFile $fDg "line1`nline2`n" $EncUtf8
$hd = (Run-Text @('read', $fDg)).Out
$dg2 = ''
if ($hd -match 'digest=([0-9a-f]+)') { $dg2 = $Matches[1] }
$r = Run-Text @('edit', $fDg, '--digest', $dg2, '--old', 'line1', '--new', 'LINE1')
Assert-Equal 'med: --lines 無しの digest が一致（末尾改行）' 0 $r.Code

# ---------------------------------------------------------------
Write-Host ''
Write-Host ('結果: ' + $script:Pass + ' 件成功 / ' + $script:Fail + ' 件失敗')
if ($script:Fail -gt 0) { exit 1 } else { exit 0 }
