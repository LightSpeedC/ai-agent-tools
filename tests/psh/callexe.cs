// psh のテスト用の .NET 製 exe。callexe.ps1 が tmp/ にビルドして呼ぶ。
// 文字コードは .NET Framework の既定のまま出す（それを psh が読み分けられるかを見るため）
using System;

class CallExe
{
	static void Main()
	{
		Console.WriteLine("ここは .NET 製 exe の出力です");
	}
}
