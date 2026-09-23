<#
	他の PC でも ai-agent-tools を使えるように、実行に最低限必要なファイルだけを
	_releases/ai-agent-tools/ へ集める。

	含めるもの: ランチャー（拡張子なし + .cmd）・実行に使う src 配下・
	TOOLS-USAGE・最小の package.json（"type": "module" だけ）・個人用
	セッション起動スクリプト（cc.cmd・cx.cmd・n.cmd・nn.cmd。単体の cmd
	で src 依存なし）

	含めないもの: テスト・tools・notes・.git・node_modules・bun.lock・
	tsconfig.json・*.exe（C# 移植版のビルド成果物）・src 内の C# 移植ソース
	（ConvertEncodingCs・Html2MdCs・TextCs）・移行前の PowerShell 版
	（check-markdown-ps.ps1）・このプロジェクト自身のビルド用 cmd
	（build-*-cs.cmd）

	check-contrast は i260922-02 で PlayWright 側へ一本化したため、
	ランチャー・src・contrast/ とも含めない。

	毎回 _releases/ai-agent-tools/ を作り直す。世代は残さない。
	出力先は .gitignore の "_*" で除外済み（追加の設定は要らない）。
#>
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

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
	'cc.cmd', 'cx.cmd', 'n.cmd', 'nn.cmd'
)
New-Item -ItemType Directory -Path (Join-Path $target 'bin') -Force | Out-Null
foreach ($name in $launchers) {
	Copy-Item (Join-Path $root "bin/$name") (Join-Path $target "bin/$name")
}

# 実行に使う src 配下（C# 移植ソースは含めない）
$srcDirs = @('lib', 'html2md', 'text', 'convert-encoding', 'check-markdown', 'check-public', 'psh')
foreach ($dir in $srcDirs) {
	Copy-Item (Join-Path $root "src/$dir") (Join-Path $target "src/$dir") -Recurse
}

# 使う側の案内（読むのはこれだけでよい）
Copy-Item (Join-Path $root 'TOOLS-USAGE.md') (Join-Path $target 'TOOLS-USAGE.md')
Copy-Item (Join-Path $root 'TOOLS-USAGE.html') (Join-Path $target 'TOOLS-USAGE.html')

# 最小の package.json（devDependencies は実行に要らない。"type": "module" だけ要る）
$pkg = [ordered]@{
	name = 'ai-agent-tools'
	private = $true
	type = 'module'
	description = 'HTML → Markdown 変換と、文字コード・テキスト操作の共有ツール'
}
$json = $pkg | ConvertTo-Json
[System.IO.File]::WriteAllText((Join-Path $target 'package.json'), $json, (New-Object System.Text.UTF8Encoding($false)))

$fileCount = (Get-ChildItem $target -Recurse -File).Count
Write-Host "配布物を生成しました: $target"
Write-Host "ファイル数: $fileCount"
