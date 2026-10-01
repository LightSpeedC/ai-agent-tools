<#
	run-bench.ts が起動させる。標準出力が窓（コンソール）につながっているかを、引数のファイルに追記する。
	False ならリダイレクトされていない＝窓に出る。
#>
param([string]$Path)
Add-Content -LiteralPath $Path -Value ([string][Console]::IsOutputRedirected) -Encoding Ascii
