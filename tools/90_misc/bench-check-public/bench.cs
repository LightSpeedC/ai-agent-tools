using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Text;
using System.Text.RegularExpressions;

// check-public の検査を C# で書いた見積もり用の実装。
// 3 つの処理系（csc / node / PowerShell 5.1）で同じ処理を書き、
// 速度と行数を比べるために置いている。実装の本体ではない。
//
// 比較の条件を揃えるため、次を守る。
//   ・同じフォルダを同じ拡張子で走査する
//   ・同じ 4 つの正規表現を、1 行ずつに当てる
//   ・起動を除いた時間を自分で測り、最後の行に出す
internal static class Bench
{
	private static readonly string[] Exts = { ".cs", ".ps1", ".md", ".html", ".cmd", ".txt", ".json", ".js" };

	private static readonly Regex[] Patterns =
	{
		// 1. メールアドレス
		new Regex(@"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}", RegexOptions.Compiled),
		// 2. C:\Users\ の直後がプレースホルダでないもの
		new Regex(@"[Cc]:\\Users\\(?!<|%|\$)[A-Za-z0-9._-]+", RegexOptions.Compiled),
		// 3. 認証情報に値が続くもの
		new Regex(@"(?i)(password|passwd|secret|api_key|token)\s*[:=]\s*[^\s""'<$%{]{4,}", RegexOptions.Compiled),
		// 5. 日本語・英数字の並びに混ざったキリル・ハングル
		new Regex(@"[\u0400-\u04FF\uAC00-\uD7AF]", RegexOptions.Compiled),
	};

	private static int Main(string[] args)
	{
		if (args.Length < 1)
		{
			Console.Error.WriteLine("使い方: bench-cs.exe <対象フォルダ>");
			return 2;
		}
		Stopwatch sw = Stopwatch.StartNew();

		int files = 0;
		int lines = 0;
		int hits = 0;

		foreach (string path in Walk(args[0]))
		{
			files++;
			string[] text = File.ReadAllLines(path, Encoding.UTF8);
			for (int i = 0; i < text.Length; i++)
			{
				lines++;
				for (int p = 0; p < Patterns.Length; p++)
				{
					if (Patterns[p].IsMatch(text[i])) hits++;
				}
			}
		}

		sw.Stop();
		Console.WriteLine("files=" + files + " lines=" + lines + " hits=" + hits +
			" inner_ms=" + sw.ElapsedMilliseconds);
		return 0;
	}

	private static IEnumerable<string> Walk(string root)
	{
		Stack<string> dirs = new Stack<string>();
		dirs.Push(root);
		while (dirs.Count > 0)
		{
			string dir = dirs.Pop();
			string name = Path.GetFileName(dir);
			// 走査から外すもの。3 実装で同じにする
			if (name == ".git" || name == "tmp" || name == "etc" || name == "node_modules") continue;

			foreach (string sub in Directory.GetDirectories(dir)) dirs.Push(sub);
			foreach (string f in Directory.GetFiles(dir))
			{
				string ext = Path.GetExtension(f).ToLowerInvariant();
				for (int i = 0; i < Exts.Length; i++)
				{
					if (ext == Exts[i]) { yield return f; break; }
				}
			}
		}
	}
}
