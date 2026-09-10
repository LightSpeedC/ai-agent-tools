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
$Ps1 = Join-Path $Root 'html2md-ps.ps1'

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
		'| T17 td |',              # 表のデータ行
		'`T17b\|code`'             # 表セル内 code の | がエスケープされる（medium#1 の回帰）
	)
	'div' = @(
		'ケース1: テキストだけの div',
		'ケース2: クラス付きでテキストだけの div',
		'ケース4: テキスト',
		'ケース5: p で囲んでいない callout',   # callout の地の文
		'> [!NOTE]'
	)
	'chapters' = @(
		'第1部 基礎編',
		'(docs/01-背景.md)'   # ttl のリンクも他のリンクと同じ経路で .html → .md になる（バグ #699 の回帰）
	)
	'link' = @(
		'外部CSSのテスト',
		'本文'
	)
	'badge' = @(
		'**5.1 では BADGESTRONG を必ず付けてください。**',   # strong 直下のバッジ。二重の ** にならない
		'**完了** BADGEPLAIN',                                   # strong の外のバッジは従来どおり
		'**BADGENOSPAN のような、バッジを含まない通常の強調。**'
	)
	'cross-anchor' = @(
		'(#1-この文書の概要)',                              # 同一ファイル内のアンカー張り替え（従来どおり）
		'(docs/target.md#2-実行ポリシー-なぜ動かないのか)'  # 他ファイルへのアンカーがリンク先の見出しアンカーへ張り替わる
	)
	'md-skip' = @(
		'KEEPMARK'                 # meta が無いページは変換される
	)
	'log-test' = @(
		# 閉じていない div。最後の 1 行まで出ること
		'2026-08-30 12:44:58.448',
		'2026-08-30 13:00:02.321',
		'2026-08-30 13:01:12.100'
	)
	'extra' = @(
		'EXTRAMARK',                        # --extra で指定したページは変換される
		'[追加で指定したページ](../GUIDE.md)',   # 変換されるので .md になる
		'[作業用のページ](../WORK.html)'         # 変換されないので .html のまま
	)
	'untagged' = @(
		# hr は区切り線にする。閉じタグを持たないので、後ろが飲み込まれないことも見る
		'---',
		'区切り線の後ろの段落',
		# 定義リストは箇条書き。dd は 4 字下げてぶら下げる
		'- 定義リストの語',
		'    - その説明',
		'    - 段落を含む説明',
		# 折りたたみはタグのまま出す。GitHub が解釈する
		'<details>',
		'<summary>畳んだ見出し</summary>',
		'畳んだ中身の段落',
		'</details>'
	)
}

# ケースごとに --extra で渡すルート直下のファイル。
# exe と ps1 で引数の書き方が違うため、名前だけを持って両方に渡す。
$ExtraFiles = @{
	'extra' = @('GUIDE.html')
}

# ケースごとに期待する終了コード。書かなければ 0（指摘なし）を期待する。
# 意図して指摘あり（1）を確かめたいケースだけ、ここに名指しする
$ExpectedExitCode = @{
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
	$exeArgs = @('--root', $work, '--dir', 'docs', '--dir', 'notes')
	if ($ExtraFiles.ContainsKey($c.Name)) {
		foreach ($n in $ExtraFiles[$c.Name]) { $exeArgs += '--extra'; $exeArgs += $n }
	}
	& $Exe @exeArgs *> (Join-Path $work 'exe.log')
	$exeCode = $LASTEXITCODE
	# 既定は 0（指摘なし）。1（指摘あり）を許すケースは $ExpectedExitCode に名指しする。
	# 素通りにすると、フィクスチャ側の意図しないリンク切れ等が「成功」のまま埋もれる
	$expectExit = if ($ExpectedExitCode.ContainsKey($c.Name)) { $ExpectedExitCode[$c.Name] } else { 0 }
	if ($exeCode -ne $expectExit) {
		Write-Result '[NG]' ('exe の終了コードが {0} ではありません（実際 {1}）' -f $expectExit, $exeCode)
		$ok = $false
	}
	# 生成物は md と、切り出した svg。svg も比べるのは、SVG の中の CSS 変数を
	# 解決する処理が入っており、片方だけ直すと気づけないため
	$exeOut = @{}
	foreach ($f in @(Get-ChildItem -LiteralPath $work -Recurse -File | Where-Object { $_.Extension -eq '.md' -or $_.Extension -eq '.svg' })) {
		$exeOut[$f.FullName.Substring($work.Length)] = [System.IO.File]::ReadAllText($f.FullName, [System.Text.Encoding]::UTF8)
	}
	if ($exeOut.Count -eq 0) {
		Write-Result '[NG]' 'exe が Markdown を 1 つも生成しませんでした'
		$ok = $false
	}

	# --- 出てはいけない文字列 ---
	$forbidden = @{
		'md-skip' = @('SKIPMARK')      # meta name="md-skip" のページ
		'extra'   = @('WORKMARK')      # ルート直下でも --extra で名指ししていないページ
		'badge'   = @('****')          # strong 直下のバッジが二重の ** にならない（#715 の回帰）
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

	if ($forbidden.ContainsKey($c.Name)) {
		foreach ($f in $forbidden[$c.Name]) {
			if ($all.Contains($f)) {
				Write-Result '[NG]' ('出力に含まれてはいけません: ' + $f)
				$ok = $false
			}
		}
	}

	# --- ps1 で変換して突き合わせる ---
	#
	# exe の出力は読み終わったら消す。残したままだと、ps1 が 1 つも生成しなかった場合に
	# exe の出力をそのまま読んで「一致」と誤判定する
	foreach ($f in @(Get-ChildItem -LiteralPath $work -Recurse -File | Where-Object { $_.Extension -eq '.md' -or $_.Extension -eq '.svg' })) {
		Remove-Item -LiteralPath $f.FullName -Force
	}

	$ps1Err = $null
	$ps1Code = $null
	try {
		$ps1Args = @{ Root = $work; Dir = @('docs', 'notes') }
		if ($ExtraFiles.ContainsKey($c.Name)) { $ps1Args['Extra'] = $ExtraFiles[$c.Name] }
		& $Ps1 @ps1Args *> (Join-Path $work 'ps1.log')
		$ps1Code = $LASTEXITCODE
	}
	catch {
		$ps1Err = $_.Exception.Message
	}
	if ($ps1Err) {
		Write-Result '[NG]' ('ps1 が例外で止まりました: ' + $ps1Err)
		$ok = $false
	}
	else {
		if ($ps1Code -ne $exeCode) {
			Write-Result '[NG]' ('exe と ps1 で終了コードが違います（exe {0} / ps1 {1}）' -f $exeCode, $ps1Code)
			$ok = $false
		}

		# exe が生成したファイルを、ps1 も同じ中身で生成しているか（exe → ps1 方向）
		foreach ($k in $exeOut.Keys) {
			$path = $work + $k
			if (-not (Test-Path -LiteralPath $path)) {
				Write-Result '[NG]' ('ps1 が生成しませんでした: ' + $k)
				$ok = $false
				continue
			}
			$ps1Text = [System.IO.File]::ReadAllText($path, [System.Text.Encoding]::UTF8)
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

		# ps1 だけが余分に生成したファイルが無いか（ps1 → exe 方向。md-skip の
		# 変換忘れ・余分な SVG 切り出しなど、逆向きの乖離はここでしか捕まえられない）
		$ps1Files = @(Get-ChildItem -LiteralPath $work -Recurse -File | Where-Object { $_.Extension -eq '.md' -or $_.Extension -eq '.svg' })
		foreach ($f in $ps1Files) {
			$k = $f.FullName.Substring($work.Length)
			if (-not $exeOut.ContainsKey($k)) {
				Write-Result '[NG]' ('ps1 だけが生成しました: ' + $k)
				$ok = $false
			}
		}

		# 検査結果（★ で始まる行）を exe と ps1 で突き合わせる。本文が一致していても、
		# 検査の指摘内容そのものが食い違っていれば見逃さない
		$exeProblems = @(Get-Content -LiteralPath (Join-Path $work 'exe.log') -Encoding UTF8 | Where-Object { $_ -match '★' } | ForEach-Object { $_.Trim() } | Sort-Object)
		$ps1Problems = @(Get-Content -LiteralPath (Join-Path $work 'ps1.log') -Encoding UTF8 | Where-Object { $_ -match '★' } | ForEach-Object { $_.Trim() } | Sort-Object)
		$pd = Compare-Object $exeProblems $ps1Problems
		if ($pd) {
			Write-Result '[NG]' ('exe と ps1 で検査の指摘が違います（差分 {0} 件）' -f $pd.Count)
			$pd | Select-Object -First 6 | ForEach-Object {
				$side = if ($_.SideIndicator -eq '<=') { 'exe' } else { 'ps1' }
				Write-Host ('        {0}: {1}' -f $side, $_.InputObject)
			}
			$ok = $false
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
