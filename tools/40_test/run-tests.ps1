<#
	html2md のテスト

	tests/cases/ 配下の HTML を exe で変換し、次を確かめる。

	  1. exe が異常終了しないこと
	  2. 出力が tests/golden/ の期待値と完全に一致すること
	  3. 終了コードと検査の指摘（★ の行）も期待値と一致すること
	  4. ケースごとに決めた「出ているべき文字列」がすべて出ていること

	2 が要になる。以前は参照実装 ps1 で同じ変換を行い、2 本の出力が一致する
	ことで担保していたが、ps1 を消したため期待値との突き合わせに変えた。
	期待値は、exe と ps1 が 15 ケースすべてで一致していた時点の出力である。

	出力を変える修正を入れたときは、差分を目で確かめてから -UpdateGolden で
	期待値を更新する。確かめずに更新すると、担保が無くなる。

	何度実行しても同じ結果になるよう、変換は tmp/ に複製してから行う。
	tests/cases/ の HTML は書き換えない。
#>
[CmdletBinding()]
param(
	# 対象のケース名（省略時はすべて）
	[string]$Case,
	# 期待値を現在の出力で作り直す
	[switch]$UpdateGolden,
	# 試す実装。既定は C# の exe。移植版を突き合わせるときに差し替える
	# （例: -Target (Join-Path $Root 'html2md.cmd')）
	[string]$Target
)

# 標準出力を UTF-8 にする。既定は CP932 で、Bash から呼ぶと日本語が化ける
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

$ErrorActionPreference = 'Stop'

# tools/40_test/ に置くため、2 階層上がプロジェクトルート
$Root = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$CasesDir = Join-Path $Root 'tests\cases'
$GoldenDir = Join-Path $Root 'tests\golden'
$WorkRoot = Join-Path $Root 'tmp\test-run'
$Exe = if ($Target) { $Target } else { Join-Path $Root 'html2md-cs.exe' }

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
		'`T17b\|code`',            # 表セル内 code の | がエスケープされる（medium#1 の回帰）
		'[リンク文字列 <p> を含む](README.md)',   # リンク文字列内の実体参照が早期デコードで消えない（i260908-02）
		'![alt の <p> 文字](README.html)',        # alt 内の実体参照も同様（img src は変換されないので .html のまま）
		'バッジ <p> 文字'                          # バッジ文字列内の実体参照も同様
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
		'(docs/01-背景.md)',   # ttl のリンクも他のリンクと同じ経路で .html → .md になる（バグ #699 の回帰）
		'| 部 | タイトル | 内容 |',   # data-columns の見出し行（i260910-02 の10。表になる前の旧挙動を通さない）
		'|---|---|---|',              # 区切り行
		'| 第2部 | 03. リンクなしタイトル |',        # ttl が a で囲まれていなければリンク化しない（i260910-03。desc 側だけの a を誤って使わない）
		'詳しくは[こちら](docs/02-実行環境.md)を参照'  # desc 自身のリンクはそのまま残る
	)
	'details' = @(
		# summary の行は HTML ブロックの中で ** が効かないため、強調はタグで出す（決着 12）
		'<summary>✅ <strong>済</strong> i260830-01 DETAILSTRONG の件名</summary>',
		'畳んだ中の段落。ここは**通常の判定**で強調になる。',   # 中身は空行で区切られ、通常の Markdown になる
		'<summary>i260830-02 バッジなしの件名</summary>',       # .no は CSS の余白の代わりに空白 1 個を補う
		# md-flat は畳まず、summary を「その位置の h2」の段の見出しにする
		'### ⚠ **着手** i260830-03 FLATTITLE の件名',
		'- 配下の箇条書きも本文として出る'
	)
	'toc-dl' = @(
		# 目次の md-skip は番号を消費しない。章側の md-skip も番号を消費しないため、
		# 目次の番号と見出しの番号が揃う（i260911-01 の medium 1）
		'1. [TOCKEEP1 はじめに](#1-tockeep1-はじめに)',
		'2. [TOCKEEP2 本編](#2-tockeep2-本編)',
		'## 2. TOCKEEP2 本編',
		# 定義リストの md-skip は dt・dd それぞれ 1 要素だけを落とす
		'- DLKEEP dt',
		'    - DLKEEP dd',
		'- DLKEEP dt2',
		'    - DLKEEP dd2'
	)
	'link' = @(
		'外部CSSのテスト',
		'本文'
	)
	'badge' = @(
		'**5.1 では BADGESTRONG を必ず付けてください。**',   # strong 直下のバッジ。二重の ** にならない
		'**完了** BADGEPLAIN',                                   # strong の外のバッジは従来どおり
		'**BADGENOSPAN のような、バッジを含まない通常の強調。**',
		'先頭は**BADGEWSTRONG** 続きです。'   # strong 内側末尾の空白は外側へ出す（i260910-03。Trim で捨てて語が繋がらない）
	)
	'cross-anchor' = @(
		'(#1-この文書の概要)',                              # 同一ファイル内のアンカー張り替え（従来どおり）
		'(docs/target.md#2-実行ポリシー-なぜ動かないのか)'  # 他ファイルへのアンカーがリンク先の見出しアンカーへ張り替わる
	)
	'md-skip' = @(
		'KEEPMARK',                # meta が無いページは変換される
		'ELEMKEEP1',               # class="md-skip" が無い li は残る（i260908-02）
		'ELEMKEEP2',
		'ELEMKEEP td',             # class="md-skip" が無い td は残る
		'ELEMKEEP span'            # span の md-skip は中身だけ消え、外側の地の文は残る
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
	'outside' = @(
		# 探索フォルダ（notes）の中は .md、外（extra）は .html のまま（i260910-02 の11）
		'[もう 1 つのページ](other.md)',
		'[外にあるページ](../extra/outside.html)'
	)
	'icon-link' = @(
		# アイコンだけのリンクは、代替テキストから記号に置き換える（i260912-05）。
		# 置き換えの対応は共通ルール「資料間のリンク」が定める
		'[<<](b.md)',            # aria-label="前へ"
		'[>>](b.md)',            # aria-label="次へ"。title="次へ" も同じ記号になる
		'[^^](b.md)',            # aria-label="目次"。class="backlink" も同じ記号になる
		'[付録](b.md)',          # 対応表に無い語は、その語をそのまま文字にする
		'[ふつうのリンク](b.md)' # 文字があるリンクは、これまでどおり
	)
	'svgvar' = @(
		# 章スコープの CSS 変数が章ごとに解決される（i260910-02 の11）
		'hsl(280,78%,25%)',    # ch01 の --accent
		'hsl(0,78%,25%)',      # ch02 の --accent（ch01 と違う値になること）
		'#d9dfe8',             # var(--line, #cccccc) は :root の定義を優先し、フォールバックは使わない
		'#336699',             # var(--nothing, #336699) は定義が無いのでフォールバックを使う
		'var(--unknown)'       # 定義もフォールバックも無い var はそのまま残す
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
	'cross-anchor-bad' = 1   # 存在しない他ファイルのアンカーを検出できるかの確認用
	'icon-link' = 1          # 手がかりの無いアイコンリンクを指摘できるかの確認用（i260912-05）
}

function Write-Result([string]$Mark, [string]$Text) {
	Write-Host ('  {0} {1}' -f $Mark, $Text)
}

Write-Host ''
Write-Host '=== html2md のテスト ===' -ForegroundColor Cyan

if (-not (Test-Path -LiteralPath $Exe)) {
	Write-Host ('html2md.exe がありません。build-html2md-cs.cmd を実行してください: ' + $Exe) -ForegroundColor Red
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

	# --- 改行は LF ---
	# .editorconfig・.gitattributes が .md を LF と宣言しているため、生成物も LF で書く。
	# exe と ps1 の一致だけでは捕まらない（両方が CRLF でも一致してしまう）ので、
	# バイトを直接見る。svg も .md と揃える
	foreach ($f in @(Get-ChildItem -LiteralPath $work -Recurse -File | Where-Object { $_.Extension -eq '.md' -or $_.Extension -eq '.svg' })) {
		$bytes = [System.IO.File]::ReadAllBytes($f.FullName)
		if ($bytes -contains 13) {
			Write-Result '[NG]' ('CR が混ざっています（LF で書くこと）: ' + $f.FullName.Substring($work.Length))
			$ok = $false
		}
	}

	# --- 出てはいけない文字列 ---
	$forbidden = @{
		'md-skip' = @('SKIPMARK', 'ELEMSKIP')      # meta name="md-skip" のページ／要素単位の md-skip の中身（i260908-02）
		'extra'   = @('WORKMARK')      # ルート直下でも --extra で名指ししていないページ
		'badge'   = @('****', 'BADGEWSTRONG**続きです')   # 二重の **（#715）／strong 内末尾の空白を Trim で捨てて語が繋がる（i260910-03）
		'outside'  = @('OUTSIDEMARK')   # 探索フォルダの外のページは変換されない
		'chapters' = @('[03. リンクなしタイトル]', 'SKIPCHAPTER')   # ttl が誤ってリンク化されない（i260910-03）／chapters の md-skip の li は行ごと落ちる（i260911-01）
		'toc-dl'   = @('TOCSKIP', 'DLSKIP', '3. [')   # 目次・定義リスト・章の md-skip（i260911-01）
		# summary の中に ** を残さない／md-flat では details タグを出さない（決着 12）
		'details'  = @('<summary>✅ **済**', 'i260830-01DETAILSTRONG', '<summary>⚠ **着手**')
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

	# --- 期待値（ゴールデン）と突き合わせる ---
	#
	# 以前は参照実装 ps1 で同じ変換を行い、2 本の出力が一致することで担保していた。
	# ps1 を消したため、tests/golden/ に固定した期待値と突き合わせる形に変えた。
	# 期待値は、exe と ps1 の出力が 15 ケースすべてで一致していた時点のもの。
	#
	# 出力そのものだけでなく、検査の指摘（★ の行）と終了コードも固定する。
	# 本文が合っていても、指摘の内容が変われば見逃さない。
	$goldenCase = Join-Path $GoldenDir $c.Name
	$exeProblems = @(Get-Content -LiteralPath (Join-Path $work 'exe.log') -Encoding UTF8 |
		Where-Object { $_ -match '★' } | ForEach-Object { $_.Trim() } | Sort-Object)

	if ($UpdateGolden) {
		if (Test-Path -LiteralPath $goldenCase) { Remove-Item -LiteralPath $goldenCase -Recurse -Force }
		New-Item -ItemType Directory -Path $goldenCase -Force | Out-Null
		foreach ($k in $exeOut.Keys) {
			$dst = Join-Path $goldenCase ($k.TrimStart('\'))
			New-Item -ItemType Directory -Path (Split-Path -Parent $dst) -Force | Out-Null
			[System.IO.File]::WriteAllText($dst, $exeOut[$k], (New-Object System.Text.UTF8Encoding($false)))
		}
		$meta = @('exit=' + $exeCode) + $exeProblems
		# WriteAllLines は Environment.NewLine（CRLF）で書く。期待値も LF に揃える
		[System.IO.File]::WriteAllText(
			(Join-Path $goldenCase 'expected.txt'),
			(($meta -join "`n") + "`n"),
			(New-Object System.Text.UTF8Encoding($false)))
		Write-Result '[--]' ('期待値を更新しました（{0} ファイル）' -f $exeOut.Count)
		continue
	}

	if (-not (Test-Path -LiteralPath $goldenCase)) {
		Write-Result '[NG]' ('期待値がありません。-UpdateGolden で作成してください: tests\golden\' + $c.Name)
		$failed++
		continue
	}

	# 期待値と同じ中身か（期待値 → 出力 方向）
	$goldenFiles = @(Get-ChildItem -LiteralPath $goldenCase -Recurse -File |
		Where-Object { $_.Extension -eq '.md' -or $_.Extension -eq '.svg' })
	foreach ($g in $goldenFiles) {
		$k = $g.FullName.Substring($goldenCase.Length)
		if (-not $exeOut.ContainsKey($k)) {
			Write-Result '[NG]' ('生成されませんでした: ' + $k)
			$ok = $false
			continue
		}
		$want = [System.IO.File]::ReadAllText($g.FullName, [System.Text.Encoding]::UTF8)
		if ($exeOut[$k] -cne $want) {
			$d = Compare-Object ($want -split "`r?`n") ($exeOut[$k] -split "`r?`n")
			Write-Result '[NG]' ('期待値と出力が違います{0}（差分 {1} 行）' -f $k, $d.Count)
			$d | Select-Object -First 6 | ForEach-Object {
				$side = if ($_.SideIndicator -eq '<=') { '期待' } else { '実際' }
				Write-Host ('        {0}: {1}' -f $side, $_.InputObject)
			}
			$ok = $false
		}
	}

	# 期待値に無いものを生成していないか（出力 → 期待値 方向）。
	# md-skip の変換忘れ・余分な SVG 切り出しは、この向きでしか捕まらない
	$goldenKeys = @{}
	foreach ($g in $goldenFiles) { $goldenKeys[$g.FullName.Substring($goldenCase.Length)] = $true }
	foreach ($k in $exeOut.Keys) {
		if (-not $goldenKeys.ContainsKey($k)) {
			Write-Result '[NG]' ('期待値に無いものを生成しました: ' + $k)
			$ok = $false
		}
	}

	# 終了コードと検査の指摘
	$expected = @(Get-Content -LiteralPath (Join-Path $goldenCase 'expected.txt') -Encoding UTF8)
	$wantExit = ($expected | Where-Object { $_ -like 'exit=*' }) -replace '^exit=', ''
	$wantProblems = @($expected | Where-Object { $_ -notlike 'exit=*' })
	if ([string]$exeCode -ne [string]$wantExit) {
		Write-Result '[NG]' ('終了コードが期待値と違います（期待 {0} / 実際 {1}）' -f $wantExit, $exeCode)
		$ok = $false
	}
	$pd = Compare-Object $wantProblems $exeProblems
	if ($pd) {
		Write-Result '[NG]' ('検査の指摘が期待値と違います（差分 {0} 件）' -f $pd.Count)
		$pd | Select-Object -First 6 | ForEach-Object {
			$side = if ($_.SideIndicator -eq '<=') { '期待' } else { '実際' }
			Write-Host ('        {0}: {1}' -f $side, $_.InputObject)
		}
		$ok = $false
	}

	if ($ok) {
		Write-Result '[OK]' ('{0} ファイルを変換、期待値と一致' -f $exeOut.Count)
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
