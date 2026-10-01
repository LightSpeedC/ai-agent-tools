<#
	他の PC でも ai-agent-tools を使えるように、実行に最低限必要なファイルだけを
	_releases/ai-agent-tools/ へ集める。

	含めるもの: ランチャー（拡張子なし + .cmd）・実行に使う src 配下・
	TOOLS-USAGE・最小の package.json（"type": "module" と koffi の版）・個人用
	セッション起動スクリプト（cc.cmd・cx.cmd・w.cmd・ww.cmd。単体の cmd
	で src 依存なし）

	node_modules のうち koffi だけを含める（spawn-server が node で FFI を使うため）。

	含めないもの: テスト・tools・notes・.git・koffi 以外の node_modules・bun.lock・
	tsconfig.json・移行前の PowerShell 版（check-markdown-ps.ps1）

	check-contrast は i260922-02 で PlayWright 側へ一本化したため、
	ランチャー・src・contrast/ とも含めない。

	毎回 _releases/ai-agent-tools/ を作り直す。世代は残さない。
	出力先は .gitignore の "_*" で除外済み（追加の設定は要らない）。
#>
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

$ErrorActionPreference = 'Stop'

$root = (Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
$target = Join-Path $root '_releases/ai-agent-tools'

if (Test-Path $target) {
	Remove-Item $target -Recurse -Force
}
New-Item -ItemType Directory -Path $target -Force | Out-Null

# ランチャー（拡張子なし + .cmd）。bin/ 配下に置く
$launchers = @(
	'html2md', 'html2md.cmd',
	'text', 'text.cmd',
	'convert-encoding', 'convert-encoding.cmd',
	'psh', 'psh.cmd',
	'check-markdown', 'check-markdown.cmd',
	'check-public', 'check-public.cmd',
	'spawn-server', 'spawn-server.cmd',
	'cc.cmd', 'cx.cmd', 'w.cmd', 'ww.cmd'
)
New-Item -ItemType Directory -Path (Join-Path $target 'bin') -Force | Out-Null
foreach ($name in $launchers) {
	Copy-Item (Join-Path $root "bin/$name") (Join-Path $target "bin/$name")
}

# 実行に使う src 配下
$srcDirs = @('lib', 'html2md', 'text', 'convert-encoding', 'check-markdown', 'check-public', 'psh', 'spawn-server-ts')
foreach ($dir in $srcDirs) {
	Copy-Item (Join-Path $root "src/$dir") (Join-Path $target "src/$dir") -Recurse
}

# koffi（node で FFI を使うため。spawn-server が CreateProcessW を呼ぶ）。
# 無くても動くが、node では PowerShell 経由に落ちて起動が 0.6 秒ほど遅くなる。bun は使わない
$koffi = Join-Path $root 'node_modules/koffi'
if (-not (Test-Path -LiteralPath $koffi)) { throw ('koffi がありません。npm install を先に実行してください: ' + $koffi) }
New-Item -ItemType Directory -Path (Join-Path $target 'node_modules') -Force | Out-Null
Copy-Item -LiteralPath $koffi -Destination (Join-Path $target 'node_modules/koffi') -Recurse

# 使う側の案内（読むのはこれだけでよい）
Copy-Item (Join-Path $root 'TOOLS-USAGE.md') (Join-Path $target 'TOOLS-USAGE.md')
Copy-Item (Join-Path $root 'TOOLS-USAGE.html') (Join-Path $target 'TOOLS-USAGE.html')

# 最小の package.json（devDependencies は実行に要らない。"type": "module" と、同梱した koffi の版だけ書く）
$pkg = [ordered]@{
	name = 'ai-agent-tools'
	private = $true
	type = 'module'
	description = 'HTML → Markdown 変換と、文字コード・テキスト操作の共有ツール'
	dependencies = [ordered]@{ koffi = (Get-Content -LiteralPath (Join-Path $root 'package.json') -Raw -Encoding UTF8 | ConvertFrom-Json).dependencies.koffi }
}
$json = $pkg | ConvertTo-Json
[System.IO.File]::WriteAllText((Join-Path $target 'package.json'), $json, (New-Object System.Text.UTF8Encoding($false)))

$fileCount = (Get-ChildItem $target -Recurse -File).Count
Write-Host "配布物を生成しました: $target"
Write-Host "ファイル数: $fileCount"
