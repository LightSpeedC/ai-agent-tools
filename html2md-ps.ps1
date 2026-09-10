<#
	html2md-ps.ps1

	HTML ドキュメントから Markdown を生成する（参照実装）。

	通常は html2md（exe）を使う。こちらは exe の挙動を読んで確かめるためと、
	csc.exe が使えない環境のために残している。出力が exe と一致することを
	tools/40_test/run-tests.cmd で検査している。

	HTML を正とし、Markdown はこのスクリプトの生成物として扱う。
	内容を更新するときは HTML を直してこのスクリプトを再実行する。
	生成された .md を直接編集しても次回実行で上書きされる。

	使い方:
	    html2md-ps -Root <プロジェクトフォルダ>
	    html2md-ps                     カレントフォルダを対象にする
	    html2md-ps -Root . -DryRun     書き出さず、変換結果と検査だけを見る

	変換対象: <Root>\README.html と -Dir で渡したフォルダ配下の *.html（既定は notes。index.html は除く）

	HTML 側の目印:
	    <svg id="xxx">              images\xxx.svg として切り出す
	                                （id が無ければ <ファイル名>-figNN.svg になる）
	    <div class="callout ...">   tip / important / warning / caution を併記すると
	                                対応する GitHub アラートになる。無指定は NOTE
	    <code class="language-xxx"> コードフェンスの言語指定になる
	    class="md-skip"             その要素を Markdown に出力しない
	    <td class="num">            列全体が num なら数値列として右寄せにする

	生成後に次を機械的に検査する:
	    - Markdown 側のリンク切れ・アンカー切れ
	    - HTML 側のリンクが .md を指していないか、HTML 側のリンク切れ
	    - Markdown 側にしか存在しない文言が無いか
	    - HTML の更新日がファイルの更新時刻より古くないか（警告のみ）

	日本語の強調:
	    CommonMark は ** の前後の文字を見て開閉を判定するため、
	    「主題は**「何が流れるか」**です」のような並びでは ** が記号のまま表示される。
	    このスクリプトは出力位置ごとにフランキング規則を判定し、** で成立しない
	    箇所だけを <strong> / <em> タグで出力する。書き手が意識する必要はない。

	プロジェクト固有の差分（バッジのクラス名など）は、いまはこのファイル先頭の
	既定値で吸収している。設定ファイルへの外出しは今後の検討事項。
#>
[CmdletBinding()]
param(
	# 変換対象のプロジェクトフォルダ（既定: カレントフォルダ）
	[string]$Root,

	# 探索するフォルダ。複数指定できる（既定: notes）
	[string[]]$Dir,

	# 変換しないファイル名（既定: index.html）
	[string[]]$Exclude,

	# ルート直下の追加ファイル。複数指定できる
	[string[]]$Extra,

	# ルート直下の README.html を対象から外す
	[switch]$NoReadme,

	# ファイルを書き出さず、変換結果と検査結果だけを表示する
	[switch]$DryRun
)

$ErrorActionPreference = 'Stop'

# ---------------------------------------------------------------------------
# 既定値（プロジェクト固有の差分はここに集約する）
# ---------------------------------------------------------------------------

# 変換対象から外すファイル名（index.html は README.html へのリダイレクト専用）。
# -Exclude で置き換えられる
$ExcludeNames = if ($Exclude) { $Exclude } else { @('index.html') }

# バッジのクラス名 → Markdown で使う記号。
# 色でしか区別していない情報なので、記号＋太字の文字情報に落とす。
# 既存プロジェクトの命名（b-ok / b-good / b-ng / b-bad / b-na / b-non / b-none）を
# まとめて受けられるようにしている。
$BadgeMarks = @{
	'ok'      = '✅'
	'good'    = '✅'
	'done'    = '✅'
	'ng'      = '❌'
	'bad'     = '❌'
	'risk'    = '❌'
	'warn'    = '⚠'
	'warning' = '⚠'
	'na'      = ''
	'non'     = ''
	'none'    = ''
}

# callout の追加クラス → GitHub アラートの種別。
# callout-important と important の両方の書き方を受ける。
$CalloutKinds = @{
	'note'      = 'NOTE'
	'tip'       = 'TIP'
	'important' = 'IMPORTANT'
	'warning'   = 'WARNING'
	'caution'   = 'CAUTION'
}

# ---------------------------------------------------------------------------
# 内部で使う一時記号
#
# 強調はここでは確定させず、いったんセンチネルで囲んでおく。
# 最終段（Resolve-Emphasis）で前後の文字を見て ** かタグかを決めるため。
# ---------------------------------------------------------------------------
$SB = [char]0x01	# <strong> 開始
$SE = [char]0x02	# <strong> 終了
$EB = [char]0x03	# <em> 開始
$EE = [char]0x04	# <em> 終了
$BR = [char]0x05	# <br>
$DB = [char]0x06	# <del> 開始（~~ も ** と同じ前後判定を受ける）
$DE = [char]0x08	# <del> 終了
$CS = [char]0x07	# 退避した文字列の開始（コードスパン・タグのまま残すもの）
# 退避した文字列の終了。開始と別の文字にする。
# 両端を同じ文字にすると、あるキーの終了・本文の数字・次のキーの開始が並んだときに
# 偽のキーができ、2<sup>10</sup> が別の退避内容に置き換わる。
# センチネルに使えるのは \s にマッチしない制御文字だけ。本文は最後に空白をまとめるため、
# \t \n \v \f \r（0x09〜0x0D）を使うとキーが空白に置き換わって壊れる。
$CE = [char]0x0E

# コードスパンの退避先（ファイル単位で作り直す）
$script:CodeSpans = New-Object System.Collections.ArrayList

# ---------------------------------------------------------------------------
# 文字列ユーティリティ
# ---------------------------------------------------------------------------

# ScriptBlock を正規表現の置換に渡すためのキャスト。
# Windows PowerShell 5.1 は ScriptBlock を暗黙にデリゲートへ変換できないため、
# 明示的に MatchEvaluator にする。
function New-Evaluator([scriptblock]$Block) {
	return [System.Text.RegularExpressions.MatchEvaluator]$Block
}

function Convert-Entity([AllowEmptyString()][string]$Text) {
	if ([string]::IsNullOrEmpty($Text)) { return '' }
	$t = $Text
	$t = $t -replace '&nbsp;', ' '
	$t = $t -replace '&lt;', '<'
	$t = $t -replace '&gt;', '>'
	$t = $t -replace '&quot;', '"'
	$t = $t -replace '&apos;', "'"
	$t = $t -replace '&laquo;', '«'
	$t = $t -replace '&raquo;', '»'
	$t = $t -replace '&mdash;', '—'
	$t = $t -replace '&ndash;', '–'
	$t = $t -replace '&hellip;', '…'
	$t = $t -replace '&times;', '×'
	$t = $t -replace '&rarr;', '→'
	$t = $t -replace '&larr;', '←'
	$t = $t -replace '&copy;', '©'
	$t = [regex]::Replace($t, '&#(\d+);', (New-Evaluator {
		param($m) [string][char][int]$m.Groups[1].Value
	}))
	$t = [regex]::Replace($t, '&#x([0-9a-fA-F]+);', (New-Evaluator {
		param($m) [string][char][Convert]::ToInt32($m.Groups[1].Value, 16)
	}))
	# &amp; は最後に戻す（他の実体参照を壊さないため）
	$t = $t -replace '&amp;', '&'
	return $t
}

function Get-ClassList([AllowEmptyString()][string]$OpenTag) {
	$m = [regex]::Match($OpenTag, '^<[^>]*?\sclass="([^"]*)"')
	if (-not $m.Success) { return @() }
	return @($m.Groups[1].Value -split '\s+' | Where-Object { $_ })
}

function Get-Attr {
	param(
		[AllowEmptyString()][string]$OpenTag,
		[string]$Name
	)
	$m = [regex]::Match($OpenTag, ('\s{0}="([^"]*)"' -f [regex]::Escape($Name)))
	if (-not $m.Success) { return '' }
	return $m.Groups[1].Value
}

# タグと実体参照を落として素のテキストにする（アンカー計算・突き合わせ用）
function Get-PlainText([AllowEmptyString()][string]$Html) {
	if ([string]::IsNullOrEmpty($Html)) { return '' }
	$t = $Html -replace '<[^>]+>', ' '
	$t = Convert-Entity $t
	$t = $t -replace '\s+', ' '
	return $t.Trim()
}

# GitHub の見出しアンカーを見出しテキストから求める。
# 小文字化 → 記号を落とす → 空白 1 文字をハイフン 1 個にする。
function Get-Anchor([string]$Heading) {
	$a = $Heading.Trim().ToLowerInvariant()
	$a = $a -replace '[^\p{L}\p{N}\p{M}\s_-]', ''
	$a = $a.Trim() -replace '\s', '-'
	return $a
}

# リンク先の拡張子を .md に差し替える。他ファイルへのアンカーは、リンク先ファイルの
# 見出しアンカーマップ（$script:CrossAnchors）を引いて張り替える。見つからなければ
# 元のアンカーのまま残す（同一ファイル内の張り替えと同じ落とし方）。
#
# 置き換えるのは、この実行で .md が生成されるページへのリンクだけ。
# 探索フォルダの外にある HTML や md-skip のページを .md で指すと、
# 存在しないファイルを指すことになる。
function Convert-LinkTarget([AllowEmptyString()][string]$Href) {
	if ([string]::IsNullOrEmpty($Href)) { return '' }
	if ($Href -match '^(https?:|mailto:|tel:|#)') { return $Href }
	# 対象が分からないときは従来どおり全部置き換える
	if (-not $script:ConvertedPages -or -not $script:LinkBaseDir) {
		return ($Href -replace '\.html(?=$|[#?])', '.md')
	}
	$target = ($Href -split '#')[0]
	if (-not $target) { return $Href }
	$full = $null
	try { $full = [System.IO.Path]::GetFullPath((Join-Path $script:LinkBaseDir ($target -replace '/', '\'))) } catch { $full = $null }
	if (-not $full -or -not $script:ConvertedPages.Contains($full)) { return $Href }

	$hashIdx = $Href.IndexOf('#')
	if ($hashIdx -ge 0 -and $script:CrossAnchors -and $script:CrossAnchors.ContainsKey($full)) {
		$targetAnchors = $script:CrossAnchors[$full]
		$id = $Href.Substring($hashIdx + 1)
		if ($targetAnchors.ContainsKey($id)) {
			$Href = $Href.Substring(0, $hashIdx) + '#' + $targetAnchors[$id]
		}
	}
	return ($Href -replace '\.html(?=$|[#?])', '.md')
}

# $Start 位置から始まるタグのブロックと中身を切り出す（同名タグの入れ子に対応）。
# Outer = 開きタグから閉じタグまで、Inner = 開きタグと閉じタグの間。
#
# 中身の範囲はここで一緒に決める。ブロック全体を返して呼び出し側で
# 閉じタグを探し直すと、子要素の閉じタグを自分のものと取り違える。
# 閉じられていない要素（書き込み途中のログ HTML 等）では最後の子要素が失われていた。
function Get-Block {
	param(
		[string]$Html,
		[int]$Start,
		[string]$Tag
	)
	$open = '<' + $Tag
	$close = '</' + $Tag + '>'
	$contentStart = $Html.IndexOf('>', $Start)
	$contentStart = if ($contentStart -lt 0) { $Html.Length } else { $contentStart + 1 }

	# 空要素は閉じタグを持たない。開きタグだけをブロックとする。
	# 閉じタグを探させると見つからず、後ろが丸ごと 1 ブロックに飲み込まれる
	if ($Tag -eq 'hr') {
		return [pscustomobject]@{ Outer = $Html.Substring($Start, $contentStart - $Start); Inner = '' }
	}

	$depth = 0
	$i = $Start
	while ($i -lt $Html.Length) {
		$no = $Html.IndexOf($open, $i, [System.StringComparison]::OrdinalIgnoreCase)
		$nc = $Html.IndexOf($close, $i, [System.StringComparison]::OrdinalIgnoreCase)
		# 閉じタグが無い。末尾までをブロックとし、中身も末尾までとする
		if ($nc -lt 0) {
			return [pscustomobject]@{ Outer = $Html.Substring($Start); Inner = $Html.Substring($contentStart) }
		}
		if ($no -ge 0 -and $no -lt $nc) {
			# <p> が <pre> に一致してしまうのを防ぐため、タグ名の直後を確かめる
			$after = if ($no + $open.Length -lt $Html.Length) { $Html[$no + $open.Length] } else { ' ' }
			if ($after -eq '>' -or $after -eq '/' -or [char]::IsWhiteSpace($after)) { $depth++ }
			$i = $no + $open.Length
			continue
		}
		$depth--
		$i = $nc + $close.Length
		if ($depth -le 0) {
			# $nc がこのブロックに対応する閉じタグ
			$len = $nc - $contentStart
			$inner = if ($len -gt 0) { $Html.Substring($contentStart, $len) } else { '' }
			return [pscustomobject]@{ Outer = $Html.Substring($Start, $i - $Start); Inner = $inner }
		}
	}
	return [pscustomobject]@{ Outer = $Html.Substring($Start); Inner = $Html.Substring($contentStart) }
}

# ページ全体を Markdown に出さない指定があるか。
# <meta name="md-skip"> を head に置いたページは変換しない。
#
# details / summary で畳んだ課題一覧のように、Markdown にすると
# 構造が失われる HTML がある。クラスの md-skip は要素単位なので、
# ページ単位の指定をこちらで受ける。
function Test-MdSkipPage([string]$Html) {
	return [regex]::IsMatch($Html, '<meta\b[^>]*\sname="md-skip"', 'IgnoreCase')
}

function Get-OpenTag([string]$Block) {
	$i = $Block.IndexOf('>')
	if ($i -lt 0) { return $Block }
	return $Block.Substring(0, $i + 1)
}

# ---------------------------------------------------------------------------
# 強調（** / <strong>）の決定
#
# CommonMark は区切り記号の前後の文字を見て開閉を判定する。** は語中にも置ける
# ため、開きが成立しないのは「内容の先頭が句読点で、その手前が通常文字」の場合、
# 閉じが成立しないのは「内容の末尾が句読点で、その直後が通常文字」の場合だけ。
# どちらかが成立しないときは ** が記号のまま表示されるので、タグで出力する。
# ---------------------------------------------------------------------------

# CommonMark が句読点として扱う文字か（Unicode の P* と S* カテゴリ）
function Test-Punct([char]$Ch) {
	switch ([System.Globalization.CharUnicodeInfo]::GetUnicodeCategory($Ch)) {
		'ConnectorPunctuation' { return $true }
		'DashPunctuation' { return $true }
		'OpenPunctuation' { return $true }
		'ClosePunctuation' { return $true }
		'InitialQuotePunctuation' { return $true }
		'FinalQuotePunctuation' { return $true }
		'OtherPunctuation' { return $true }
		'MathSymbol' { return $true }
		'CurrencySymbol' { return $true }
		'ModifierSymbol' { return $true }
		'OtherSymbol' { return $true }
	}
	return $false
}

function Test-CanEmphasize {
	param(
		[string]$Text,
		[int]$Start,
		[int]$Length
	)
	if ($Length -le 0) { return $false }
	# 行頭・行末は空白として扱う（CommonMark の規定）
	$before = if ($Start -gt 0) { $Text[$Start - 1] } else { [char]' ' }
	$after = if ($Start + $Length -lt $Text.Length) { $Text[$Start + $Length] } else { [char]' ' }
	$first = $Text[$Start]
	$last = $Text[$Start + $Length - 1]

	# 開き側
	if ([char]::IsWhiteSpace($first)) { return $false }
	if ((Test-Punct $first) -and -not ([char]::IsWhiteSpace($before) -or (Test-Punct $before))) { return $false }

	# 閉じ側
	if ([char]::IsWhiteSpace($last)) { return $false }
	if ((Test-Punct $last) -and -not ([char]::IsWhiteSpace($after) -or (Test-Punct $after))) { return $false }

	return $true
}

# センチネルの文字から強調の種類を求める。開きと閉じで別に引く。
#
# switch を式として使うと、break を書かないかぎり後続の条件も評価され、
# 一致した分岐すべての値が配列で返る。if の連鎖で書く
function Get-EmphasisKind([char]$Ch, [bool]$IsBegin) {
	if ($IsBegin) {
		if ($Ch -ceq $script:SB) { return 'strong' }
		if ($Ch -ceq $script:EB) { return 'em' }
		if ($Ch -ceq $script:DB) { return 'del' }
		return ''
	}
	if ($Ch -ceq $script:SE) { return 'strong' }
	if ($Ch -ceq $script:EE) { return 'em' }
	if ($Ch -ceq $script:DE) { return 'del' }
	return ''
}

# 強調の種類から Markdown の記号を求める
function Get-EmphasisMark([string]$Kind) {
	if ($Kind -ceq 'strong') { return '**' }
	if ($Kind -ceq 'em') { return '*' }
	return '~~'
}

# センチネルで囲んだ強調を、内側から順に ** かタグに確定させる
function Resolve-Emphasis([string]$Text) {
	$t = $Text
	$pat = "[$SB$EB$DB]([^$SB$SE$EB$EE$DB$DE]*)[$SE$EE$DE]"
	while ($true) {
		$m = [regex]::Match($t, $pat)
		if (-not $m.Success) { break }
		# 開きと閉じの種類が食い違うときは、記法にせずタグで出す
		$openKind = Get-EmphasisKind $t[$m.Index] $true
		$closeKind = Get-EmphasisKind $t[$m.Index + $m.Length - 1] $false
		$inner = $m.Groups[1].Value.Trim()
		$prefix = $t.Substring(0, $m.Index)
		$suffix = $t.Substring($m.Index + $m.Length)

		if ($inner.Length -eq 0) {
			$t = $prefix + $suffix
			continue
		}

		# 同じ種類の強調がそのまま入れ子になっている場合（バッジが strong の
		# 先頭に来るときなど）。直前・直後に同じ種類の生のセンチネルがまだ
		# 残っているなら、ここでは記法を確定させず中身だけを残す。外側の
		# ペアが次の周で解決するとき、まとめて 1 組の記法になる。
		#
		# 生のセンチネル文字は HTML 由来の文字列に現れないので、この判定は
		# 文字列の中身（** など）を見る必要がなく誤検出しない。
		$prevKind = if ($m.Index -gt 0) { Get-EmphasisKind $t[$m.Index - 1] $true } else { '' }
		$nextKind = if ($m.Index + $m.Length -lt $t.Length) { Get-EmphasisKind $t[$m.Index + $m.Length] $false } else { '' }
		$touchesOuterSameKind = ($prevKind -ceq $openKind -and $prevKind) -or ($nextKind -ceq $closeKind -and $nextKind)

		if ($openKind -cne $closeKind) {
			# 開きと閉じの種類が食い違うときは、記法にせずタグで出す
			$rep = '<' + $openKind + '>' + $inner + '</' + $openKind + '>'
		}
		elseif ($touchesOuterSameKind) {
			$rep = $inner
		}
		else {
			$probe = $prefix + $inner + $suffix
			if (Test-CanEmphasize -Text $probe -Start $prefix.Length -Length $inner.Length) {
				$mark = Get-EmphasisMark $openKind
				$rep = $mark + $inner + $mark
			}
			else {
				$rep = '<' + $openKind + '>' + $inner + '</' + $openKind + '>'
			}
		}
		$t = $prefix + $rep + $suffix
	}
	return $t
}

# ---------------------------------------------------------------------------
# インライン要素の変換
# ---------------------------------------------------------------------------

function Add-CodeSpan([string]$Text) {
	$i = $script:CodeSpans.Add($Text)
	return ([string]$script:CS + [string]$i + [string]$script:CE)
}

function Restore-CodeSpan([string]$Text) {
	$t = $Text
	for ($i = $script:CodeSpans.Count - 1; $i -ge 0; $i--) {
		$t = $t.Replace(([string]$script:CS + [string]$i + [string]$script:CE), $script:CodeSpans[$i])
	}
	return $t
}

# バッジのクラスから記号を求める。バッジでなければ $null を返す
function Get-BadgeMark([string[]]$Classes) {
	$isBadge = ($Classes -contains 'badge') -or ($Classes -contains 'b')
	$mark = $null
	$found = $false
	foreach ($c in $Classes) {
		if ($c -notmatch '^b-(.+)$') { continue }
		$key = $Matches[1]
		if ($script:BadgeMarks.ContainsKey($key)) {
			$mark = $script:BadgeMarks[$key]
			$found = $true
			break
		}
		# b-xxx が付いていれば、記号が決まらなくてもバッジとして扱う
		$found = $true
		$mark = ''
	}
	if (-not $isBadge -and -not $found) { return $null }
	if ($null -eq $mark) { $mark = '' }
	return $mark
}

function Convert-Inline {
	param(
		[AllowEmptyString()][string]$Html,
		[hashtable]$Anchors,
		[switch]$InTable
	)
	if ([string]::IsNullOrEmpty($Html)) { return '' }

	# ScriptBlock はデリゲート経由で呼ばれるため、参照する値は script スコープに置く
	$script:CurAnchors = $Anchors
	$s = $Html

	# セル内に置かれたコードブロックは 1 行のコード表記に落とす
	$s = [regex]::Replace($s, '(?s)<pre\b[^>]*>\s*<code\b[^>]*>(.*?)</code>\s*</pre>', (New-Evaluator {
		param($m)
		$code = Convert-Entity ($m.Groups[1].Value -replace '<[^>]+>', '')
		$code = ($code -replace '\r?\n', ' ') -replace '`', "'"
		$code = $code.Trim()
		# 表のセルでは、コードスパンの中でも | を \| にする（GFM はセル内の
		# code の | も列区切りとして数える）。退避後に一括エスケープすると
		# 中身が対象から外れて素通りするため、退避前にここで処理する
		if ($InTable) { $code = $code -replace '\|', '\|' }
		return (Add-CodeSpan ('`' + $code + '`'))
	}))

	# コードスパンは退避する（中身を他の変換の対象から外すため）
	$s = [regex]::Replace($s, '(?s)<code\b[^>]*>(.*?)</code>', (New-Evaluator {
		param($m)
		$code = Convert-Entity ($m.Groups[1].Value -replace '<[^>]+>', '')
		if ($InTable) { $code = $code -replace '\|', '\|' }
		return (Add-CodeSpan ('`' + $code + '`'))
	}))

	# バッジは色でしか区別していないので、記号＋太字の文字情報に落とす
	$s = [regex]::Replace($s, '(?s)<span\b([^>]*)>(.*?)</span>', (New-Evaluator {
		param($m)
		$classes = Get-ClassList ('<span' + $m.Groups[1].Value + '>')
		$inner = $m.Groups[2].Value
		$mark = Get-BadgeMark $classes
		if ($null -eq $mark) { return $inner }
		$text = (Get-PlainText $inner)
		if (-not $text) { return '' }
		$body = [string]$script:SB + $text + [string]$script:SE
		# バッジは CSS の余白で本文と離れていたので、空白 1 個を補って続く文と分ける
		if ($mark) { return ($mark + ' ' + $body + ' ') }
		return ($body + ' ')
	}))

	# 画像
	$s = [regex]::Replace($s, '<img\b([^>]*?)/?>', (New-Evaluator {
		param($m)
		$tag = '<img' + $m.Groups[1].Value + '>'
		$src = Get-Attr $tag 'src'
		if (-not $src) { return '' }
		$alt = Convert-Entity (Get-Attr $tag 'alt')
		return ('![{0}]({1})' -f $alt, $src)
	}))

	# リンク: 拡張子を .md に置き換え、ページ内アンカーは見出しアンカーへ張り替える
	$s = [regex]::Replace($s, '(?s)<a\b([^>]*)>(.*?)</a>', (New-Evaluator {
		param($m)
		$tag = '<a' + $m.Groups[1].Value + '>'
		$href = Get-Attr $tag 'href'
		$text = $m.Groups[2].Value -replace '<[^>]+>', ''
		$text = (Convert-Entity $text) -replace '\s+', ' '
		$text = $text.Trim()
		if (-not $href) { return $text }
		if ($href.StartsWith('#')) {
			$key = $href.Substring(1)
			if ($null -ne $script:CurAnchors -and $script:CurAnchors.ContainsKey($key)) {
				$href = '#' + $script:CurAnchors[$key]
			}
		}
		else {
			$href = Convert-LinkTarget $href
		}
		return ('[{0}]({1})' -f $text, $href)
	}))

	# 強調はセンチネルで囲むだけにして、記法は最終段で決める
	$s = [regex]::Replace($s, '(?s)<(strong|b)\b[^>]*>(.*?)</\1>', (New-Evaluator {
		param($m)
		$inner = $m.Groups[2].Value
		if (-not (Get-PlainText $inner)) { return '' }
		return ([string]$script:SB + $inner + [string]$script:SE)
	}))
	$s = [regex]::Replace($s, '(?s)<(em|i)\b[^>]*>(.*?)</\1>', (New-Evaluator {
		param($m)
		$inner = $m.Groups[2].Value
		if (-not (Get-PlainText $inner)) { return '' }
		return ([string]$script:EB + $inner + [string]$script:EE)
	}))

	# 取り消し線。GitHub は ~~ を解釈するが、** と同じ前後判定を受けるので
	# 記法にするかタグにするかは最終段で決める
	$s = [regex]::Replace($s, '(?s)<(del)\b[^>]*>(.*?)</\1>', (New-Evaluator {
		param($m)
		$inner = $m.Groups[2].Value
		if (-not (Get-PlainText $inner)) { return '' }
		return ([string]$script:DB + $inner + [string]$script:DE)
	}))

	# GitHub が解釈するインラインタグは、タグのまま残す。平文に落とすより情報が残る。
	# 開きと閉じだけ退避し、中身は通常の変換を通す。
	#
	# ここに挙げるのは GitHub のレンダラで実際に生き残るものだけ。
	# abbr・small・cite・time はサニタイズで除去され（中身のテキストは残る）、
	# タグで出しても表示に効かないので平文に落とす
	$s = [regex]::Replace($s, '</?(?:ins|sup|sub|mark|kbd|q)\b[^>]*>', (New-Evaluator {
		param($m)
		return (Add-CodeSpan $m.Value)
	}))

	# <br> はタグ除去で消えないよう退避する
	$s = $s -replace '<br\s*/?>', [string]$script:BR

	# 残ったタグを落とす
	$s = $s -replace '<[^>]+>', ''
	$s = Convert-Entity $s
	$s = $s -replace '\s+', ' '

	# <br> はタグのまま出す。表の中と外で表現を揃える
	$s = $s.Replace([string]$script:BR, '<br>')
	if ($InTable) {
		# セル区切りとの衝突を避ける
		$s = $s -replace '\|', '\|'
	}
	return $s.Trim()
}

# ---------------------------------------------------------------------------
# テーブル（rowspan / colspan を展開する）
# ---------------------------------------------------------------------------
function Convert-Table {
	param(
		[string]$TableHtml,
		[hashtable]$Anchors
	)

	# 行を集める。thead があればその行をヘッダとみなす
	$headEnd = -1
	$mHead = [regex]::Match($TableHtml, '(?s)<thead\b[^>]*>.*?</thead>')
	if ($mHead.Success) { $headEnd = $mHead.Index + $mHead.Length }

	$rows = @()
	foreach ($rm in [regex]::Matches($TableHtml, '(?s)<tr\b[^>]*>(.*?)</tr>')) {
		$isHead = ($headEnd -ge 0 -and $rm.Index -lt $headEnd)
		$cells = @()
		foreach ($cm in [regex]::Matches($rm.Groups[1].Value, '(?s)<(t[hd])\b([^>]*)>(.*?)</\1>')) {
			$attrs = '<td' + $cm.Groups[2].Value + '>'
			$colspan = 1
			$rowspan = 1
			if ($cm.Groups[2].Value -match 'colspan="(\d+)"') { $colspan = [int]$Matches[1] }
			if ($cm.Groups[2].Value -match 'rowspan="(\d+)"') { $rowspan = [int]$Matches[1] }
			$cells += [pscustomobject]@{
				Text    = (Convert-Inline -Html $cm.Groups[3].Value -Anchors $Anchors -InTable)
				ColSpan = $colspan
				RowSpan = $rowspan
				IsNum   = ((Get-ClassList $attrs) -contains 'num')
				IsHead  = ($isHead -or $cm.Groups[1].Value -eq 'th')
			}
		}
		if ($cells.Count -gt 0) { $rows += , $cells }
	}
	if ($rows.Count -eq 0) { return '' }

	# rowspan / colspan をグリッドに展開する
	$grid = @{}
	$numCount = @{}
	$dataCount = @{}
	$maxCol = 0
	$rowCount = 0
	for ($r = 0; $r -lt $rows.Count; $r++) {
		$c = 0
		foreach ($cell in $rows[$r]) {
			while ($grid.ContainsKey("$r,$c")) { $c++ }
			for ($dr = 0; $dr -lt $cell.RowSpan; $dr++) {
				for ($dc = 0; $dc -lt $cell.ColSpan; $dc++) {
					$rr = $r + $dr
					$cc = $c + $dc
					# 結合元のセルにだけ文字を置き、残りは空欄にする
					$grid["$rr,$cc"] = if ($dr -eq 0 -and $dc -eq 0) { $cell.Text } else { '' }
					if ($rr + 1 -gt $rowCount) { $rowCount = $rr + 1 }
				}
			}
			# 数値列の判定はヘッダを除いたデータ行だけで行う
			if (-not $cell.IsHead) {
				if (-not $dataCount.ContainsKey($c)) { $dataCount[$c] = 0 }
				$dataCount[$c] = $dataCount[$c] + 1
				if ($cell.IsNum) {
					if (-not $numCount.ContainsKey($c)) { $numCount[$c] = 0 }
					$numCount[$c] = $numCount[$c] + 1
				}
			}
			$c += $cell.ColSpan
			if ($c -gt $maxCol) { $maxCol = $c }
		}
	}
	if ($maxCol -eq 0 -or $rowCount -eq 0) { return '' }

	# 列全体が num のときだけ右寄せにする
	$sep = @()
	for ($c = 0; $c -lt $maxCol; $c++) {
		$n = if ($numCount.ContainsKey($c)) { $numCount[$c] } else { 0 }
		$d = if ($dataCount.ContainsKey($c)) { $dataCount[$c] } else { 0 }
		if ($n -gt 0 -and $n -eq $d) { $sep += '---:' } else { $sep += '---' }
	}

	$lines = @()
	for ($r = 0; $r -lt $rowCount; $r++) {
		$cols = @()
		for ($c = 0; $c -lt $maxCol; $c++) {
			$cols += if ($grid.ContainsKey("$r,$c")) { $grid["$r,$c"] } else { '' }
		}
		$lines += '| ' + ($cols -join ' | ') + ' |'
		if ($r -eq 0) { $lines += '|' + ($sep -join '|') + '|' }
	}
	return ($lines -join "`n")
}

# ---------------------------------------------------------------------------
# リスト（入れ子に対応する）
# ---------------------------------------------------------------------------
function Convert-List {
	param(
		[string]$ListHtml,
		[string]$Tag,
		[hashtable]$Anchors,
		[int]$Depth = 0
	)
	# リストの中身。閉じられていない場合も末尾までを中身とする
	$inner = (Get-Block $ListHtml 0 $Tag).Inner
	$indent = ' ' * (4 * $Depth)
	$out = @()
	$n = 0
	$i = 0
	while ($true) {
		$m = [regex]::Match($inner.Substring($i), '<li\b')
		if (-not $m.Success) { break }
		$start = $i + $m.Index
		$block = Get-Block $inner $start 'li'
		$i = $start + $block.Outer.Length
		$liInner = $block.Inner

		# 入れ子のリストを取り出してから、残りを 1 行のテキストにする
		$nested = @()
		while ($true) {
			$nm = [regex]::Match($liInner, '<(ul|ol)\b')
			if (-not $nm.Success) { break }
			$nTag = $nm.Groups[1].Value.ToLowerInvariant()
			$nBlock = (Get-Block $liInner $nm.Index $nTag).Outer
			$nested += , @($nTag, $nBlock)
			$liInner = $liInner.Remove($nm.Index, $nBlock.Length)
		}

		$text = Convert-Inline -Html $liInner -Anchors $Anchors
		$text = $text -replace '\s*\r?\n\s*', ' '
		if (-not $text -and $nested.Count -eq 0) { continue }
		$n++
		if ($Tag -eq 'ol') { $out += ($indent + ('{0}. {1}' -f $n, $text)) }
		else { $out += ($indent + '- ' + $text) }

		foreach ($nst in $nested) {
			$sub = Convert-List -ListHtml $nst[1] -Tag $nst[0] -Anchors $Anchors -Depth ($Depth + 1)
			if ($sub) { $out += $sub }
		}
	}
	return ($out -join "`n")
}

# 目次: <li><a href="#chNN">見出し</a></li> を、生成後の見出しアンカーへ向ける
function Convert-Toc {
	param(
		[string]$TocHtml,
		[hashtable]$Anchors
	)
	$out = @()
	$n = 0
	foreach ($li in [regex]::Matches($TocHtml, '(?s)<li\b[^>]*>(.*?)</li>')) {
		$a = [regex]::Match($li.Groups[1].Value, '(?s)<a\b[^>]*href="#([^"]+)"[^>]*>(.*?)</a>')
		if (-not $a.Success) { continue }
		$n++
		$id = $a.Groups[1].Value
		$text = Convert-Inline -Html $a.Groups[2].Value -Anchors $Anchors
		$anchor = if ($Anchors.ContainsKey($id)) { $Anchors[$id] } else { $id }
		$out += ('{0}. [{1}](#{2})' -f $n, $text, $anchor)
	}
	return ($out -join "`n")
}

# span の中身をクラス名で拾う（part / ttl / desc）
function Get-SpanText {
	param(
		[string]$Html,
		[string]$ClassName,
		[hashtable]$Anchors
	)
	$raw = Get-SpanRaw -Html $Html -ClassName $ClassName
	if (-not $raw) { return '' }
	$text = Convert-Inline -Html $raw -Anchors $Anchors -InTable $true
	return ($text -replace '\s*\r?\n\s*', ' ')
}

# 指定クラスの span の中身を、変換せず生の HTML のまま返す
function Get-SpanRaw {
	param(
		[string]$Html,
		[string]$ClassName
	)
	foreach ($m in [regex]::Matches($Html, '(?s)<span\b([^>]*)>(.*?)</span>')) {
		$spanClasses = Get-ClassList ('<span' + $m.Groups[1].Value + '>')
		if ($spanClasses -contains $ClassName) { return $m.Groups[2].Value }
	}
	return ''
}

# class="chapters" のリストを、data-columns の 3 列見出しを持つ表にする
# （タグ対応仕様の決着 10）。data-columns が無い・列数が 3 でなければエラーで止める
function Convert-Chapters {
	param(
		[string]$UlHtml,
		[hashtable]$Anchors
	)
	$openEnd = $UlHtml.IndexOf('>')
	$openTag = if ($openEnd -ge 0) { $UlHtml.Substring(0, $openEnd + 1) } else { $UlHtml }
	$columnsAttr = Get-Attr $openTag 'data-columns'
	if (-not $columnsAttr) {
		throw 'class="chapters" には data-columns が必須です（例: data-columns="部,タイトル,内容"）。表の見出しは HTML に書かれた文言しか使えません。'
	}
	$headers = $columnsAttr -split ','
	if ($headers.Count -ne 3) {
		throw ('data-columns は 3 列で指定してください（part, ttl, desc に対応）: ' + $columnsAttr)
	}

	$inner = (Get-Block $UlHtml 0 'ul').Inner
	$rows = @()
	$i = 0
	while ($true) {
		$m = [regex]::Match($inner.Substring($i), '<li\b')
		if (-not $m.Success) { break }
		$start = $i + $m.Index
		$block = Get-Block $inner $start 'li'
		$i = $start + $block.Outer.Length
		$liInner = $block.Inner

		$part = Get-SpanText -Html $liInner -ClassName 'part' -Anchors $Anchors
		$desc = Get-SpanText -Html $liInner -ClassName 'desc' -Anchors $Anchors

		# ttl は生のまま取り出し、a で囲む href があれば合成 <a> にして Convert-Inline に
		# 通す。ほかのリンクと同じ経路（.md 置換・他ファイルのアンカー張り替え）を通すため
		$ttlRaw = Get-SpanRaw -Html $liInner -ClassName 'ttl'
		$aTag = [regex]::Match($liInner, '(?s)<a\b([^>]*)>.*?</a>')
		$href = if ($aTag.Success) { Get-Attr ('<a' + $aTag.Groups[1].Value + '>') 'href' } else { '' }
		$ttl = if ($href -and $ttlRaw) {
			Convert-Inline -Html ('<a href="' + $href + '">' + $ttlRaw + '</a>') -Anchors $Anchors -InTable $true
		} else {
			Convert-Inline -Html $ttlRaw -Anchors $Anchors -InTable $true
		}
		$ttl = $ttl -replace '\s*\r?\n\s*', ' '

		if (-not $part -and -not $ttl -and -not $desc) { continue }
		$rows += , @($part, $ttl, $desc)
	}
	if ($rows.Count -eq 0) { return '' }

	$out = @()
	$out += ('| ' + ($headers -join ' | ') + ' |')
	$out += '|---|---|---|'
	foreach ($row in $rows) {
		$out += ('| ' + ($row -join ' | ') + ' |')
	}
	return ($out -join "`n")
}

# ---------------------------------------------------------------------------
# インライン SVG の切り出し
#
# GitHub は Markdown 内のインライン SVG をサニタイズで除去するため、
# images/ に独立ファイルとして書き出して画像参照にする。
# ---------------------------------------------------------------------------
# @media や @supports のブロックを中身ごと落とす。入れ子があるため括弧を数える
function Remove-AtBlock([string]$Css) {
	$sb = New-Object System.Text.StringBuilder
	$i = 0
	while ($true) {
		$at = $Css.IndexOf('@', $i)
		if ($at -lt 0) { [void]$sb.Append($Css.Substring($i)); break }
		$brace = $Css.IndexOf('{', $at)
		if ($brace -lt 0) { [void]$sb.Append($Css.Substring($i)); break }
		[void]$sb.Append($Css.Substring($i, $at - $i))
		$depth = 0
		$end = -1
		for ($q = $brace; $q -lt $Css.Length; $q++) {
			if ($Css[$q] -eq '{') { $depth++ }
			elseif ($Css[$q] -eq '}') { $depth--; if ($depth -eq 0) { $end = $q; break } }
		}
		if ($end -lt 0) { break }
		$i = $end + 1
	}
	return $sb.ToString()
}

# style から CSS 変数を読む。「セレクタの鍵 → 変数名 → 値」の入れ子のハッシュ。
# :root は空文字の鍵、章のクラスは chNN の鍵で持つ。
#
# SVG を単体ファイルに切り出すと var() が解決されず色が失われるため、
# 切り出すときに静的に埋める。@media の中と JS による上書きは対象外。
function Get-CssVars([string]$Html) {
	$map = @{}
	foreach ($st in [regex]::Matches($Html, '(?s)<style\b[^>]*>(.*?)</style>')) {
		$css = [regex]::Replace($st.Groups[1].Value, '(?s)/\*.*?\*/', '')
		$css = Remove-AtBlock $css
		foreach ($rule in [regex]::Matches($css, '([^{}]+)\{([^{}]*)\}')) {
			$decl = $rule.Groups[2].Value
			if ($decl.IndexOf('--') -lt 0) { continue }

			$keys = @()
			foreach ($one in ($rule.Groups[1].Value -split ',')) {
				$sel = $one.Trim()
				if ($sel -ceq ':root') { $keys += '' }
				elseif ($sel -cmatch '^\.(ch\d+)$') { $keys += $Matches[1] }
			}
			if ($keys.Count -eq 0) { continue }

			foreach ($d in [regex]::Matches($decl, '(--[\w-]+)\s*:\s*([^;]+)')) {
				$name = $d.Groups[1].Value
				$val = $d.Groups[2].Value.Trim()
				foreach ($key in $keys) {
					if (-not $map.ContainsKey($key)) { $map[$key] = @{} }
					$map[$key][$name] = $val
				}
			}
		}
	}
	return $map
}

# var(--x) と var(--x, 既定値) を実際の値に置き換える。
# 章のクラスの定義を先に見て、無ければ :root を見る。どちらにも無ければ
# 既定値、それも無ければ元の記述を残す。
#
# 正規表現で括るとフォールバックに hsl(...) のような括弧が入ったときに
# 途中で切れるため、括弧を数えて取り出す。
function Resolve-CssVars([string]$Text, [hashtable]$Vars, [string]$ChapterClass) {
	if (-not $Vars -or $Vars.Count -eq 0 -or -not $Text) { return $Text }
	if ($Text.IndexOf('var(') -lt 0) { return $Text }

	$sb = New-Object System.Text.StringBuilder
	$i = 0
	while ($true) {
		$p = $Text.IndexOf('var(', $i)
		if ($p -lt 0) { [void]$sb.Append($Text.Substring($i)); break }
		[void]$sb.Append($Text.Substring($i, $p - $i))

		$brace = $p + 3
		$depth = 0
		$end = -1
		for ($q = $brace; $q -lt $Text.Length; $q++) {
			if ($Text[$q] -eq '(') { $depth++ }
			elseif ($Text[$q] -eq ')') { $depth--; if ($depth -eq 0) { $end = $q; break } }
		}
		if ($end -lt 0) { [void]$sb.Append($Text.Substring($p)); break }

		$inner = $Text.Substring($brace + 1, $end - $brace - 1)
		$original = $Text.Substring($p, $end - $p + 1)
		[void]$sb.Append((Resolve-OneVar $inner $Vars $ChapterClass $original))
		$i = $end + 1
	}
	return $sb.ToString()
}

function Resolve-OneVar([string]$Inner, [hashtable]$Vars, [string]$ChapterClass, [string]$Original) {
	$comma = $Inner.IndexOf(',')
	$name = if ($comma -lt 0) { $Inner.Trim() } else { $Inner.Substring(0, $comma).Trim() }
	$fallback = if ($comma -lt 0) { '' } else { $Inner.Substring($comma + 1).Trim() }

	$found = $null
	if ($ChapterClass -and $Vars.ContainsKey($ChapterClass) -and $Vars[$ChapterClass].ContainsKey($name)) {
		$found = $Vars[$ChapterClass][$name]
	}
	if ($null -eq $found -and $Vars.ContainsKey('') -and $Vars[''].ContainsKey($name)) {
		$found = $Vars[''][$name]
	}
	if ($null -ne $found) { return (Resolve-CssVars $found $Vars $ChapterClass) }
	if ($fallback) { return (Resolve-CssVars $fallback $Vars $ChapterClass) }
	return $Original
}

# クラスの一覧から章のクラス（chNN）を返す。無ければ空文字
function Get-ChapterClass([string[]]$Classes) {
	if (-not $Classes) { return '' }
	foreach ($c in $Classes) {
		if ($c -cmatch '^ch\d+$') { return $c }
	}
	return ''
}

function Export-Svg {
	param(
		[string]$SvgHtml,
		[hashtable]$Ctx
	)
	$open = [regex]::Match($SvgHtml, '(?s)^<svg\b([^>]*)>')
	$attrs = if ($open.Success) { $open.Groups[1].Value } else { '' }
	$openTag = if ($open.Success) { $open.Value } else { '<svg>' }

	$Ctx.FigIndex = $Ctx.FigIndex + 1
	$id = Get-Attr $openTag 'id'
	$fileName = if ($id) { $id + '.svg' } else { ('{0}-fig{1:d2}.svg' -f $Ctx.BasePrefix, $Ctx.FigIndex) }

	$body = if ($open.Success) { $SvgHtml.Substring($open.Length) } else { $SvgHtml }
	$body = [regex]::Replace($body, '(?s)</svg>\s*$', '')

	# var(--accent) は切り出した先では解決されず、色が失われる。
	# 章のクラスの定義を先に見て、無ければ :root を見て静的に埋める
	$body = Resolve-CssVars $body $Ctx.CssVars $Ctx.ChapterClass

	# 切り出したあとの id はファイル単位で一意ならよいので、短い名前に振り直す
	$ids = @()
	foreach ($m in [regex]::Matches($body, '\sid="([^"]+)"')) {
		if ($ids -notcontains $m.Groups[1].Value) { $ids += $m.Groups[1].Value }
	}
	$k = 0
	foreach ($old in $ids) {
		$k++
		$new = 'i' + $k
		$body = $body -replace ('\sid="' + [regex]::Escape($old) + '"'), (' id="' + $new + '"')
		$body = $body -replace ('url\(#' + [regex]::Escape($old) + '\)'), ('url(#' + $new + ')')
		$body = $body -replace ('href="#' + [regex]::Escape($old) + '"'), ('href="#' + $new + '"')
	}

	# 単体ファイルとして開けるよう xmlns と width / height を付ける
	$viewBox = Get-Attr $openTag 'viewBox'
	$label = Get-Attr $openTag 'aria-label'
	$font = Get-Attr $openTag 'font-family'
	$w = ''
	$h = ''
	if ($viewBox -match '^\s*[\d.\-]+\s+[\d.\-]+\s+([\d.]+)\s+([\d.]+)\s*$') {
		$w = $Matches[1]
		$h = $Matches[2]
	}
	$newAttrs = 'xmlns="http://www.w3.org/2000/svg"'
	if ($viewBox) { $newAttrs += (' viewBox="{0}"' -f $viewBox) }
	if ($w -and $h) { $newAttrs += (' width="{0}" height="{1}"' -f $w, $h) }
	$newAttrs += ' role="img"'
	if ($label) { $newAttrs += (' aria-label="{0}"' -f $label) }
	if ($font) { $newAttrs += (' font-family="{0}"' -f $font) }

	# 透過のままだとダークモードで文字が読めないので白背景を敷く。
	# defs の直後に入れて、グラデーション定義より後ろに来るようにする
	$bg = "`t" + '<rect width="100%" height="100%" fill="#ffffff"/>'
	$defsEnd = $body.IndexOf('</defs>', [System.StringComparison]::OrdinalIgnoreCase)
	if ($defsEnd -ge 0) {
		$cut = $defsEnd + '</defs>'.Length
		$body = $body.Substring(0, $cut) + "`n" + $bg + $body.Substring($cut)
	}
	else {
		$body = "`n" + $bg + $body
	}

	$svg = ('<svg {0}>{1}</svg>' -f $newAttrs, $body)
	$svg = ($svg -replace '\r?\n', "`r`n")
	if (-not $svg.EndsWith("`r`n")) { $svg += "`r`n" }

	if ($Ctx.Write) {
		if (-not (Test-Path -LiteralPath $Ctx.ImagesDir)) {
			New-Item -ItemType Directory -Path $Ctx.ImagesDir -Force | Out-Null
		}
		[System.IO.File]::WriteAllText((Join-Path $Ctx.ImagesDir $fileName), $svg,
			(New-Object System.Text.UTF8Encoding($false)))
	}
	$Ctx.Images.Add($fileName) | Out-Null
	return [pscustomobject]@{ FileName = $fileName; Label = (Convert-Entity $label) }
}

# ---------------------------------------------------------------------------
# ブロック要素の変換
# ---------------------------------------------------------------------------

# 見出しの記号を決める。
# 章（section 内の h1）は h2 相当に下げる。ミニタイトルバーを使う構成では
# minibar が章の区切りになるので、その配下をもう 1 段下げる。
function Get-HeadingMark {
	param(
		[hashtable]$Ctx,
		[int]$HtmlLevel
	)
	$shift = if ($Ctx.HasMinibar) { 2 } else { 1 }
	$level = $HtmlLevel + $shift
	# 章の外の見出し（目次・索引の案内など）は章と同じ立場なので 1 段上げる。
	# h2 だけを上げると h2 が ## で h3 が #### になり、### が抜ける
	if ((-not $Ctx.InSection) -and $HtmlLevel -ge 2) { $level-- }
	if ($level -gt 6) { $level = 6 }
	return ('#' * $level) + ' '
}

# 定義リストを箇条書きにする。dt が項目、dd はその下に 4 字下げてぶら下げる。
# Markdown に定義リストは無いため、足す記号が - だけで済む形を選んだ。
# dt を太字にしない。** は HTML に無い装飾になる
function Convert-DefList {
	param(
		[AllowEmptyString()][string]$Inner,
		[hashtable]$Ctx
	)
	$lines = @()
	$i = 0
	while ($true) {
		$m = [regex]::Match($Inner.Substring($i), '<(dt|dd)\b')
		if (-not $m.Success) { break }
		$start = $i + $m.Index
		$tag = $m.Groups[1].Value.ToLowerInvariant()
		$block = Get-Block $Inner $start $tag
		$i = $start + $block.Outer.Length

		$text = Convert-Inline -Html ($block.Inner) -Anchors ($Ctx.Anchors)
		# 項目の中で改行すると箇条書きが切れる
		$text = ([regex]::Replace($text, '\s*\r?\n\s*', ' ')).Trim()
		if (-not $text) { continue }
		$mark = if ($tag -eq 'dd') { '    - ' } else { '- ' }
		$lines += ($mark + $text)
	}
	if ($lines.Count -eq 0) { return '' }
	return ($lines -join "`n")
}

# 折りたたみはタグのまま出す。GitHub が解釈するため畳みが効く。
# summary の後ろと閉じる前に空行を置く。空行が無いと中身が HTML として読まれ、
# Markdown の記法が効かない
function Convert-Details {
	param(
		[AllowEmptyString()][string]$Inner,
		[hashtable]$Ctx
	)
	$summaryText = ''
	$sm = [regex]::Match($Inner, '(?is)<summary\b[^>]*>(.*?)</summary>')
	if ($sm.Success) {
		$summaryText = Convert-Inline -Html ($sm.Groups[1].Value) -Anchors ($Ctx.Anchors)
		$summaryText = ([regex]::Replace($summaryText, '\s*\r?\n\s*', ' ')).Trim()
		$Inner = $Inner.Remove($sm.Index, $sm.Length)
	}

	$sub = Convert-Blocks $Inner $Ctx

	$d = @('<details>', ('<summary>' + $summaryText + '</summary>'))
	foreach ($b in $sub) {
		$d += ''
		$d += $b
	}
	$d += ''
	$d += '</details>'
	return ($d -join "`n")
}

function Convert-Blocks {
	param(
		[AllowEmptyString()][string]$Html,
		[hashtable]$Ctx
	)
	$out = New-Object System.Collections.ArrayList
	if ([string]::IsNullOrEmpty($Html)) { return , @() }

	$anchors = $Ctx.Anchors
	$i = 0
	while ($true) {
		$m = [regex]::Match($Html.Substring($i),
			('<(section|figure|footer|blockquote|div|nav|table|main|article|aside|header|address' +
			 '|details|summary|dl|dt|dd|hr|h1|h2|h3|h4|h5|h6|p|ul|ol|pre|svg|a)\b'))
		if (-not $m.Success) {
			# 最後のブロックより後ろに残ったテキスト
			$rest = Convert-Inline -Html $Html.Substring($i) -Anchors $anchors
			if ($rest) { $out.Add($rest) | Out-Null }
			break
		}
		$start = $i + $m.Index
		# ブロックの手前に地の文がある場合、それも 1 段落として出す。
		# <div>テキスト<p>段落</p></div> のようにブロックと混在していても落とさない
		$lead = Convert-Inline -Html $Html.Substring($i, $m.Index) -Anchors $anchors
		if ($lead) { $out.Add($lead) | Out-Null }
		$tag = $m.Groups[1].Value.ToLowerInvariant()
		$block = Get-Block $Html $start $tag
		$i = $start + $block.Outer.Length
		$openTag = Get-OpenTag $block.Outer
		$classes = Get-ClassList $openTag

		if ($classes -contains 'md-skip') { continue }

		switch ($tag) {
			'section' {
				# 章のクラスは配下の SVG が var() を解決するのに使う。
				# 入れ子があっても壊れないよう、元の値に戻す
				$prevClass = $Ctx.ChapterClass
				$found = Get-ChapterClass $classes
				if ($found) { $Ctx.ChapterClass = $found }
				$Ctx.InSection = $true
				$sub = Convert-Blocks ($block.Inner) $Ctx
				foreach ($b in $sub) { $out.Add($b) | Out-Null }
				$Ctx.InSection = $false
				$Ctx.ChapterClass = $prevClass
			}
			'footer' {
				$sub = Convert-Blocks ($block.Inner) $Ctx
				foreach ($b in $sub) { $out.Add($b) | Out-Null }
			}
			'nav' {
				$sub = Convert-Blocks ($block.Inner) $Ctx
				foreach ($b in $sub) { $out.Add($b) | Out-Null }
			}
			# 文書構造のタグ（main article aside header address）と、
			# 親の外に単独で置かれた summary dt dd。中身を段落として出す
			{ $_ -in @('main', 'article', 'aside', 'header', 'address', 'summary', 'dt', 'dd') } {
				$sub = Convert-Blocks ($block.Inner) $Ctx
				foreach ($b in $sub) { $out.Add($b) | Out-Null }
			}
			'hr' {
				$out.Add('---') | Out-Null
			}
			'dl' {
				$b = Convert-DefList ($block.Inner) $Ctx
				if ($b) { $out.Add($b) | Out-Null }
			}
			'details' {
				$out.Add((Convert-Details ($block.Inner) $Ctx)) | Out-Null
			}
			'blockquote' {
				$sub = Convert-Blocks ($block.Inner) $Ctx
				$q = @()
				$first = $true
				foreach ($b in $sub) {
					if (-not $first) { $q += '>' }
					$first = $false
					foreach ($line in ($b -split "`n")) { $q += ('> ' + $line).TrimEnd() }
				}
				if ($q.Count -gt 0) { $out.Add(($q -join "`n")) | Out-Null }
			}
			'div' {
				if ($classes -contains 'callout') {
					$kind = 'NOTE'
					foreach ($c in $classes) {
						$key = $c -replace '^callout-', ''
						if ($key -eq 'callout') { continue }
						if ($script:CalloutKinds.ContainsKey($key)) { $kind = $script:CalloutKinds[$key] }
					}
					$sub = Convert-Blocks ($block.Inner) $Ctx
					$q = @('> [!' + $kind + ']')
					foreach ($b in $sub) {
						foreach ($line in ($b -split "`n")) { $q += ('> ' + $line).TrimEnd() }
					}
					$out.Add(($q -join "`n")) | Out-Null
				}
				elseif ($classes -contains 'titlebar') {
					$Ctx.InTitlebar = $true
					$sub = Convert-Blocks ($block.Inner) $Ctx
				foreach ($b in $sub) { $out.Add($b) | Out-Null }
					$Ctx.InTitlebar = $false
				}
				elseif ($classes -contains 'minibar') {
					$text = Convert-Inline -Html ($block.Inner) -Anchors $anchors
					if ($text) { $out.Add('## ' + $text) | Out-Null }
				}
				elseif ($classes -contains 'toc') {
					$h = [regex]::Match($block.Outer, '(?s)<h2\b[^>]*>(.*?)</h2>')
					if ($h.Success) { $out.Add('## ' + (Convert-Inline -Html $h.Groups[1].Value -Anchors $anchors)) | Out-Null }
					$items = Convert-Toc -TocHtml $block.Outer -Anchors $anchors
					if ($items) { $out.Add($items) | Out-Null }
				}
				elseif ($classes -contains 'meta') {
					# タイトルバー内の作成日・更新日は引用行にする
					$text = Convert-Inline -Html ($block.Inner) -Anchors $anchors
					if ($text) { $out.Add('> ' + ($text -replace '\s*\r?\n\s*', ' ')) | Out-Null }
				}
				else {
					$sub = Convert-Blocks ($block.Inner) $Ctx
				foreach ($b in $sub) { $out.Add($b) | Out-Null }
				}
			}
			'figure' {
				$svgM = [regex]::Match($block.Outer, '(?s)<svg\b.*?</svg>')
				if ($svgM.Success) {
					$info = Export-Svg -SvgHtml $svgM.Value -Ctx $Ctx
					$out.Add(('![{0}](images/{1})' -f $info.Label, $info.FileName)) | Out-Null
				}
				$capM = [regex]::Match($block.Outer, '(?s)<figcaption\b[^>]*>(.*?)</figcaption>')
				if ($capM.Success) {
					$cap = Convert-Inline -Html $capM.Groups[1].Value -Anchors $anchors
					if ($cap) { $out.Add($cap) | Out-Null }
				}
			}
			'svg' {
				$info = Export-Svg -SvgHtml $block.Outer -Ctx $Ctx
				$out.Add(('![{0}](images/{1})' -f $info.Label, $info.FileName)) | Out-Null
			}
			'table' {
				# caption は表の見出し。Markdown に記法が無いので表の直前の段落にする
				$tabCap = [regex]::Match($block.Outer, '(?s)<caption\b[^>]*>(.*?)</caption>')
				if ($tabCap.Success) {
					$cap = Convert-Inline -Html ($tabCap.Groups[1].Value) -Anchors $anchors
					if ($cap) { $out.Add($cap) | Out-Null }
				}
				$t = Convert-Table -TableHtml $block.Outer -Anchors $anchors
				if ($t) { $out.Add($t) | Out-Null }
			}
			'h1' {
				$text = Convert-Inline -Html ($block.Inner) -Anchors $anchors
				if ($Ctx.InTitlebar) {
					# タイトルバーの h1 は文書のタイトル
					if ($text) { $out.Add('# ' + $text) | Out-Null }
				}
				else {
					$Ctx.ChapterNo = $Ctx.ChapterNo + 1
					$out.Add((Get-HeadingMark $Ctx 1) + ('{0}. {1}' -f $Ctx.ChapterNo, $text)) | Out-Null
				}
			}
			'h2' {
				$text = Convert-Inline -Html ($block.Inner) -Anchors $anchors
				if (-not $text) { break }
				$out.Add((Get-HeadingMark $Ctx 2) + $text) | Out-Null
			}
			'h3' {
				$text = Convert-Inline -Html ($block.Inner) -Anchors $anchors
				if ($text) { $out.Add((Get-HeadingMark $Ctx 3) + $text) | Out-Null }
			}
			'h4' {
				$text = Convert-Inline -Html ($block.Inner) -Anchors $anchors
				if ($text) { $out.Add((Get-HeadingMark $Ctx 4) + $text) | Out-Null }
			}
			'h5' {
				$text = Convert-Inline -Html ($block.Inner) -Anchors $anchors
				if ($text) { $out.Add((Get-HeadingMark $Ctx 5) + $text) | Out-Null }
			}
			'h6' {
				$text = Convert-Inline -Html ($block.Inner) -Anchors $anchors
				if ($text) { $out.Add((Get-HeadingMark $Ctx 6) + $text) | Out-Null }
			}
			'p' {
				$text = Convert-Inline -Html ($block.Inner) -Anchors $anchors
				if (-not $text) { break }
				# タイトルバー内の作成日・更新日は引用行にする
				$isMeta = ($classes -contains 'meta') -or ($classes -contains 'date')
				if ($isMeta -or ($Ctx.InTitlebar -and $text.StartsWith('📅'))) {
					$out.Add('> ' + ($text -replace '\s*\r?\n\s*', ' ')) | Out-Null
				}
				else {
					$out.Add($text) | Out-Null
				}
			}
			'ul' {
				$items = if ($classes -contains 'chapters') {
					Convert-Chapters -UlHtml $block.Outer -Anchors $anchors
				} else {
					Convert-List -ListHtml $block.Outer -Tag 'ul' -Anchors $anchors
				}
				if ($items) { $out.Add($items) | Out-Null }
			}
			'ol' {
				if ($classes -contains 'toc') {
					$items = Convert-Toc -TocHtml $block.Outer -Anchors $anchors
					if ($items) { $out.Add($items) | Out-Null }
				}
				else {
					$items = Convert-List -ListHtml $block.Outer -Tag 'ol' -Anchors $anchors
					if ($items) { $out.Add($items) | Out-Null }
				}
			}
			'pre' {
				$inner = $block.Inner
				$lang = ''
				$codeM = [regex]::Match($inner, '(?s)<code\b([^>]*)>(.*?)</code>')
				if ($codeM.Success) {
					foreach ($c in (Get-ClassList ('<code' + $codeM.Groups[1].Value + '>'))) {
						if ($c -like 'language-*') { $lang = $c.Substring('language-'.Length) }
					}
					$inner = $codeM.Groups[2].Value
				}
				$code = Convert-Entity ($inner -replace '<[^>]+>', '')
				$code = $code -replace "`r`n", "`n"
				# 前後の空行だけを落とす（行頭のインデントは保つ）
				$code = $code -replace '\A(\s*\n)+', ''
				$code = $code -replace '(\n\s*)+\z', ''
				$out.Add('```' + $lang + "`n" + $code + "`n" + '```') | Out-Null
			}
			'a' {
				# 段落の外に単独で置かれたリンク（.doclink など）
				$text = Convert-Inline -Html $block.Outer -Anchors $anchors
				if ($text) { $out.Add($text) | Out-Null }
			}
		}
	}
	return , @($out.ToArray() | Where-Object { $_ })
}

# ---------------------------------------------------------------------------
# 1 ファイルの変換
# ---------------------------------------------------------------------------

# section の id → 生成後の見出しアンカーの対応表（目次のリンク張り替え用）
# コメント・style・script・head を落として body の中身だけにする。
# ConvertFile と、クロスファイルのアンカー事前パスの両方から呼ぶ
function Get-StrippedBody([string]$Html) {
	$s = [regex]::Replace($Html, '(?s)<!--.*?-->', '')
	$s = [regex]::Replace($s, '(?s)<style\b[^>]*>.*?</style>', '')
	$s = [regex]::Replace($s, '(?s)<script\b[^>]*>.*?</script>', '')
	$s = [regex]::Replace($s, '(?s)<head\b[^>]*>.*?</head>', '')
	$body = $s
	$bs = $s.IndexOf('<body', [System.StringComparison]::OrdinalIgnoreCase)
	if ($bs -ge 0) {
		$bs = $s.IndexOf('>', $bs) + 1
		$be = $s.IndexOf('</body>', [System.StringComparison]::OrdinalIgnoreCase)
		if ($be -lt 0) { $be = $s.Length }
		$body = $s.Substring($bs, $be - $bs)
	}
	return $body
}

function Get-AnchorMap {
	param(
		[string]$Body,
		[bool]$HasMinibar
	)
	$map = @{}
	$no = 0
	# section を 1 つずつ切り出して中の h1 を探す。
	# 正規表現で <section>〜<h1> をまとめて拾うと、h1 を持たない
	# <section class="toc"> が次の章の h1 まで飲み込み、
	# 最初の章の id が登録されないまま章番号だけ進む。
	$i = 0
	while ($true) {
		$m = [regex]::Match($Body.Substring($i), '<section\b')
		if (-not $m.Success) { break }
		$start = $i + $m.Index
		$block = Get-Block $Body $start 'section'
		$i = $start + $block.Outer.Length

		$h1 = [regex]::Match($block.Outer, '(?s)<h1\b[^>]*>(.*?)</h1>')
		if (-not $h1.Success) { continue }   # 目次など h1 を持たない section は章に数えない
		$no++
		$id = Get-Attr (Get-OpenTag $block.Outer) 'id'
		if (-not $id) { continue }
		$title = Get-PlainText $h1.Groups[1].Value
		$map[$id] = Get-Anchor ('{0}. {1}' -f $no, $title)
	}
	# h2 / h3 に id が振られている場合も拾う
	foreach ($m in [regex]::Matches($Body, '(?s)<h([23])\b([^>]*)>(.*?)</h\1>')) {
		$id = Get-Attr ('<h' + $m.Groups[1].Value + $m.Groups[2].Value + '>') 'id'
		if (-not $id) { continue }
		if ($map.ContainsKey($id)) { continue }
		$map[$id] = Get-Anchor (Get-PlainText $m.Groups[3].Value)
	}
	return $map
}

function Convert-HtmlFile {
	param(
		[string]$HtmlPath,
		[bool]$Write
	)
	$script:CodeSpans = New-Object System.Collections.ArrayList
	$script:LinkBaseDir = Split-Path -Parent $HtmlPath

	$html = [System.IO.File]::ReadAllText($HtmlPath, [System.Text.Encoding]::UTF8)

	# style は次で落ちるので、その前に CSS 変数を読む
	$cssVars = Get-CssVars $html

	# コメント・style・script・head を落とす
	$html = [regex]::Replace($html, '(?s)<!--.*?-->', '')
	$html = [regex]::Replace($html, '(?s)<style\b[^>]*>.*?</style>', '')
	$html = [regex]::Replace($html, '(?s)<script\b[^>]*>.*?</script>', '')
	$html = [regex]::Replace($html, '(?s)<head\b[^>]*>.*?</head>', '')

	$body = $html
	$bs = $html.IndexOf('<body', [System.StringComparison]::OrdinalIgnoreCase)
	if ($bs -ge 0) {
		$bs = $html.IndexOf('>', $bs) + 1
		$be = $html.IndexOf('</body>', [System.StringComparison]::OrdinalIgnoreCase)
		if ($be -lt 0) { $be = $html.Length }
		$body = $html.Substring($bs, $be - $bs)
	}

	$hasMinibar = ($body -match '<div\b[^>]*class="[^"]*\bminibar\b')
	$dir = Split-Path -Parent $HtmlPath
	$base = [System.IO.Path]::GetFileNameWithoutExtension($HtmlPath)

	$ctx = @{
		Anchors     = (Get-AnchorMap -Body $body -HasMinibar $hasMinibar)
		ImagesDir   = (Join-Path $dir 'images')
		BasePrefix  = $base
		FigIndex    = 0
		Images      = (New-Object System.Collections.ArrayList)
		InTitlebar  = $false
		InSection   = $false
		HasMinibar  = $hasMinibar
		ChapterNo   = 0
		Write       = $Write
		CssVars     = $cssVars
		ChapterClass = ''
	}

	$blocks = Convert-Blocks $body $ctx
	$md = ($blocks -join "`n`n")

	# コードスパンを戻したあとで強調の記法を決める（前後の文字を見て判定するため）
	$md = Restore-CodeSpan $md
	$md = Resolve-Emphasis $md

	$md = $md -replace "[ `t]+`n", "`n"
	$md = $md -replace "`n{3,}", "`n`n"
	$md = $md.TrimEnd() + "`n"
	$md = $md -replace '\r?\n', "`r`n"

	$mdPath = [System.IO.Path]::ChangeExtension($HtmlPath, '.md')
	if ($Write) {
		[System.IO.File]::WriteAllText($mdPath, $md, (New-Object System.Text.UTF8Encoding($false)))
	}

	return [pscustomobject]@{
		HtmlPath = $HtmlPath
		MdPath   = $mdPath
		Markdown = $md
		Images   = @($ctx.Images.ToArray())
	}
}

# ---------------------------------------------------------------------------
# 検査
# ---------------------------------------------------------------------------

# Markdown 側のリンク切れ・アンカー切れ
function Test-MdLinks([object]$Result) {
	$dir = Split-Path -Parent $Result.MdPath
	$md = $Result.Markdown

	$heads = @()
	foreach ($m in [regex]::Matches($md, '(?m)^#{1,6}\s+(.+)$')) {
		$heads += Get-Anchor (($m.Groups[1].Value -replace '<[^>]+>', '') -replace '[*`]', '')
	}

	$bad = @()
	# フェンスとコードスパンの中は対象にしない。
	# 書き方を説明する文書では ![](images/xxx.svg) のような例がコードとして現れる
	$body = [regex]::Replace($md, '(?s)```.*?```', '')
	$body = [regex]::Replace($body, '`[^`\r\n]*`', '')
	foreach ($m in [regex]::Matches($body, '!?\[[^\]]*\]\(([^)]+)\)')) {
		$link = $m.Groups[1].Value
		if ($link -match '^(https?:|mailto:|tel:)') { continue }
		if ($link.StartsWith('#')) {
			if ($heads -notcontains $link.Substring(1)) { $bad += ('アンカー先なし: ' + $link) }
			continue
		}
		$target = ($link -split '#')[0]
		if (-not $target) { continue }
		$full = Join-Path $dir ($target -replace '/', '\')
		if (-not (Test-Path -LiteralPath $full)) { $bad += ('リンク切れ: ' + $link) }
	}
	return , $bad
}

# HTML 側のリンクが .md を指していないか、また参照先が実在するか。
# Markdown 側だけを検査すると、変換で .md になった分と区別できず見逃す。
function Test-HtmlLinks([string]$HtmlPath) {
	$html = [System.IO.File]::ReadAllText($HtmlPath, [System.Text.Encoding]::UTF8)
	$dir = Split-Path -Parent $HtmlPath
	$bad = @()
	foreach ($m in [regex]::Matches($html, 'href="([^"]+)"')) {
		$href = $m.Groups[1].Value
		if ($href -match '^(https?:|mailto:|tel:|#)') { continue }
		if ($href -match '\.md($|[#?])') {
			$bad += ('.md を参照: ' + $href + '（HTML には常に .html と書く）')
			continue
		}
		$target = ($href -split '#')[0]
		if (-not $target) { continue }
		$full = Join-Path $dir ($target -replace '/', '\')
		if (-not (Test-Path -LiteralPath $full)) { $bad += ('リンク切れ: ' + $href) }
	}
	return , $bad
}

# 比較用に記号を落とす。Markdown 側と HTML 側に同じ処理をかけること。
# 片方だけで落とすと、コード例に含まれる * や \ や <strong> が差分に見えて誤検出する。
function Get-NormalizedText([string]$Text) {
	$s = $Text
	# 記法そのものがコード例として本文に現れることがあるので、両側で同じ扱いにする。
	# 画像は元が SVG なら HTML の本文に対応が無いため、両側から落とす
	$s = $s -replace '!\[[^\]]*\]\([^)]*\)', ''
	$s = $s -replace '\[([^\]]*)\]\([^)]*\)', '$1'
	# タグ名そのものがコード例として本文に現れることがある。
	# タグのまま出すものは属性を持つことがあるので、開きタグは属性まで含めて落とす
	$s = $s -replace '</?(?:strong|em|br|del|ins|sup|sub|mark|kbd|abbr|small|q|cite|time|details|summary)\b[^>]*>', ''
	$s = $s -replace '\\\|', '|'
	# 記法の記号（* ` | ~）とパス区切りの \ は、どちらの側に現れても落とす
	$s = $s -replace '[*`|~\\]', ''
	# 色分けの代替として認めた記号
	$s = $s -replace '[✅❌⚠⬜✖―]', ''
	$s = $s -replace '️', ''                       # 異体字セレクタ
	$s = $s -replace '\s', ''
	return $s
}

# Markdown の 1 行から、行頭の記法を落として比較用の文字列にする
function Get-CompareText([string]$Line) {
	$s = $Line
	$s = $s -replace '^\s*>\s*\[!\w+\]\s*$', ''
	$s = $s -replace '^\s*>\s?', ''
	$s = $s -replace '^\s*#{1,6}\s*', ''
	$s = $s -replace '^\s*[-+]\s+', ''
	$s = $s -replace '^\s*\d+\.\s+', ''
	return (Get-NormalizedText $s)
}

# Markdown 側にしか存在しない文言が無いか。
# 変換は記法の置き換えだけを行い、文言は HTML と同一にする決まりのため、
# HTML の可視テキストに無い文字列が現れたら付け足しとみなす。
function Test-ExtraText([object]$Result) {
	$html = [System.IO.File]::ReadAllText($Result.HtmlPath, [System.Text.Encoding]::UTF8)
	$html = [regex]::Replace($html, '(?s)<!--.*?-->', '')
	$html = [regex]::Replace($html, '(?s)<head\b[^>]*>.*?</head>', '')
	$html = [regex]::Replace($html, '(?s)<style\b[^>]*>.*?</style>', '')
	$html = [regex]::Replace($html, '(?s)<script\b[^>]*>.*?</script>', '')

	# aria-label は属性なのでタグ除去で消える。画像の alt と突き合わせるため足す
	$labels = ''
	foreach ($m in [regex]::Matches($html, 'aria-label="([^"]*)"')) { $labels += (Convert-Entity $m.Groups[1].Value) }
	# data-columns も属性。chapters の表見出しはここにしか無い文言なので同じく足す
	# （カンマは Markdown 側の見出し行に出ないため、比較前に落としておく）
	foreach ($m in [regex]::Matches($html, 'data-columns="([^"]*)"')) { $labels += ((Convert-Entity $m.Groups[1].Value) -replace ',', '') }
	$plain = Get-NormalizedText ((Get-PlainText $html) + $labels)

	$extra = @()
	$inFence = $false
	$lineNo = 0
	foreach ($line in ($Result.Markdown -split '\r?\n')) {
		$lineNo++
		# callout の中のコードフェンスは "> ```" の形になる。
		# 引用記号を外してから判定しないとフェンスの内外を取り違える
		$head = ($line.TrimStart() -replace '^>\s?', '').TrimStart()
		if ($head.StartsWith('```')) { $inFence = -not $inFence; continue }
		if ($inFence) { continue }
		if (-not $line.Trim()) { continue }
		# 表の区切り行は記法そのもの
		if ($line -match '^\s*\|?[\s:|-]+\|?\s*$') { continue }
		$c = Get-CompareText $line
		# 章見出しに付けた連番は HTML に無いので落とす
		$c = $c -replace '^\d+\.', ''
		if ($c.Length -lt 2) { continue }
		if (-not $plain.Contains($c)) {
			$head = $line.Trim()
			if ($head.Length -gt 90) { $head = $head.Substring(0, 90) + '…' }
			$extra += ('{0} 行目: {1}' -f $lineNo, $head)
		}
	}
	return , $extra
}

# HTML の更新日が、ファイルの最終更新時刻より古くないか。
# 体裁だけの変更では更新日を変えない決まりのため、警告に留める。
function Test-UpdatedDate([string]$HtmlPath) {
	$html = [System.IO.File]::ReadAllText($HtmlPath, [System.Text.Encoding]::UTF8)
	if ($html -notmatch '作成:\s*([\d-]+)\s*/\s*更新:\s*([\d-]+)') {
		return '作成日・更新日の記載が見つかりません'
	}
	$written = $Matches[2]
	$parsed = [datetime]::MinValue
	if (-not [datetime]::TryParseExact($written, 'yyyy-MM-dd', $null, 'None', [ref]$parsed)) {
		return ('更新日の書式が不正です: ' + $written)
	}
	$mtime = (Get-Item -LiteralPath $HtmlPath).LastWriteTime.Date
	if ($parsed -lt $mtime) {
		return ('更新日が古い可能性: ヘッダ {0} / ファイル更新 {1}（体裁だけの変更ならこのままでよい）' -f `
			$written, $mtime.ToString('yyyy-MM-dd'))
	}
	return ''
}

# ---------------------------------------------------------------------------
# 実行
# ---------------------------------------------------------------------------
if (-not $Root) { $Root = (Get-Location).Path }
if (-not (Test-Path -LiteralPath $Root)) { throw ('フォルダが見つかりません: ' + $Root) }
$Root = (Resolve-Path -LiteralPath $Root).Path

Write-Host ''
Write-Host '=== HTML → Markdown 変換 ==='
if ($DryRun) { Write-Host '（-DryRun: ファイルは書き出しません）' }
Write-Host ('対象ルート: ' + $Root)

$dirNames = if ($Dir) { $Dir } else { @('notes') }
Write-Host ('探索フォルダ: ' + ($dirNames -join ' '))

# ルート直下を名指しにしているのは、作業用に置いた HTML まで拾わないため
$targets = New-Object System.Collections.ArrayList
if (-not $NoReadme) {
	$readme = Join-Path $Root 'README.html'
	if (Test-Path -LiteralPath $readme) { $targets.Add((Get-Item -LiteralPath $readme)) | Out-Null }
}
foreach ($name in @($Extra)) {
	if (-not $name) { continue }
	$extra = Join-Path $Root $name
	if (Test-Path -LiteralPath $extra) { $targets.Add((Get-Item -LiteralPath $extra)) | Out-Null }
}
foreach ($d in $dirNames) {
	$sub = Join-Path $Root $d
	if (-not (Test-Path -LiteralPath $sub)) { continue }
	foreach ($f in (Get-ChildItem -LiteralPath $sub -Recurse -File -Filter '*.html' | Sort-Object FullName)) {
		$targets.Add($f) | Out-Null
	}
}
$targets = @($targets | Where-Object { $ExcludeNames -notcontains $_.Name })

if ($targets.Count -eq 0) {
	Write-Host ('変換対象の HTML が見つかりませんでした（README.html と ' + ($dirNames -join ' / ') + ' 配下を探しています）。')
	exit 1
}

$results = @()

# head に <meta name="md-skip"> があるページは Markdown にしない。
# details で畳んだ課題一覧のように、変換すると構造が失われるものがある。
#
# 変換より先に、この実行で .md ができるページを確定させる。
# リンクの置き換えがこの一覧を見て、載っていないものは .html のまま残す。
# md-skip のページと、探索フォルダの外にある HTML がこれに当たる
$script:MdSkipPages = New-Object 'System.Collections.Generic.HashSet[string]' ([System.StringComparer]::OrdinalIgnoreCase)
$script:ConvertedPages = New-Object 'System.Collections.Generic.HashSet[string]' ([System.StringComparer]::OrdinalIgnoreCase)
# 他ファイルへのアンカー付きリンクを、リンク先の見出しアンカーへ張り替えるための
# 事前パス。変換対象すべての見出しアンカーマップを先に作っておく
$script:CrossAnchors = @{}
foreach ($t in $targets) {
	$full = [System.IO.Path]::GetFullPath($t.FullName)
	$text = [System.IO.File]::ReadAllText($t.FullName, [System.Text.Encoding]::UTF8)
	if (Test-MdSkipPage $text) {
		[void]$script:MdSkipPages.Add($full)
	}
	else {
		[void]$script:ConvertedPages.Add($full)
		$script:CrossAnchors[$full] = (Get-AnchorMap -Body (Get-StrippedBody $text) -HasMinibar $false)
	}
}

Write-Host ''
foreach ($t in $targets) {
	$rel = $t.FullName.Substring($Root.Length).TrimStart('\')

	if ($script:MdSkipPages.Contains([System.IO.Path]::GetFullPath($t.FullName))) {
		Write-Host ('[{0}]' -f $rel)
		Write-Host '    -- md-skip の指定により変換しません'
		continue
	}

	$res = Convert-HtmlFile -HtmlPath $t.FullName -Write (-not $DryRun)
	$lines = ($res.Markdown -split '\r?\n').Count
	$size = [System.Text.Encoding]::UTF8.GetByteCount($res.Markdown)
	Write-Host ('[{0}]' -f $rel)
	Write-Host ('    -> {0}  ({1} 行 / {2:N1} KB)' -f `
		$res.MdPath.Substring($Root.Length).TrimStart('\'), $lines, ($size / 1KB))
	if ($res.Images.Count -gt 0) {
		Write-Host ('    画像: {0}' -f (($res.Images | ForEach-Object { 'images/' + $_ }) -join ', '))
	}
	$results += $res
}

Write-Host ''
Write-Host '=== 検査 ==='
$problems = 0
$warnings = 0
foreach ($r in $results) {
	$rel = $r.HtmlPath.Substring($Root.Length).TrimStart('\')
	Write-Host ('[{0}]' -f $rel)

	$htmlBad = Test-HtmlLinks $r.HtmlPath
	if ($htmlBad.Count -gt 0) {
		$problems += $htmlBad.Count
		foreach ($b in $htmlBad) { Write-Host ('    ★HTML 側: ' + $b) }
	}
	else {
		Write-Host '    HTML 側のリンク: すべて .html で参照先も実在'
	}

	$mdBad = Test-MdLinks $r
	if ($mdBad.Count -gt 0) {
		$problems += $mdBad.Count
		foreach ($b in $mdBad) { Write-Host ('    ★Markdown 側: ' + $b) }
	}
	else {
		Write-Host '    Markdown 側のリンク: リンク切れ・アンカー切れなし'
	}

	$extra = Test-ExtraText $r
	if ($extra.Count -gt 0) {
		$problems += $extra.Count
		Write-Host ('    ★HTML に無い文言 {0} 件:' -f $extra.Count)
		foreach ($e in $extra) { Write-Host ('        ' + $e) }
	}
	else {
		Write-Host '    HTML に無い文言なし'
	}

	$dateNg = Test-UpdatedDate $r.HtmlPath
	if ($dateNg) {
		$warnings++
		Write-Host ('    ▲' + $dateNg)
	}
}

Write-Host ''
if ($problems -gt 0) {
	Write-Host ('=== 変換完了。{0} 件の指摘あり ===' -f $problems)
	if ($warnings -gt 0) { Write-Host ('（ほかに警告 {0} 件）' -f $warnings) }
	exit 1
}
if ($warnings -gt 0) {
	Write-Host ('=== 変換完了。警告 {0} 件（指摘なし） ===' -f $warnings)
}
else {
	Write-Host '=== 変換完了。指摘なし ==='
}
Write-Host ''
Write-Host '生成した Markdown が GitHub で意図どおりに表示されるかは check-markdown.ps1 で確かめる。'
exit 0
