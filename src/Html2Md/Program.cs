using System;
using System.Collections.Generic;
using System.IO;
using System.Text;

namespace Html2Md
{
	/// <summary>
	/// HTML ドキュメントから Markdown を生成する（プロジェクト共通）。
	///
	/// HTML を正とし、Markdown はこのツールの生成物として扱う。
	/// 内容を更新するときは HTML を直してこのツールを再実行する。
	/// 生成された .md を直接編集しても次回実行で上書きされる。
	/// </summary>
	internal static class Program
	{
		private const string Usage =
			"HTML → Markdown 変換\n" +
			"\n" +
			"  html2md.exe [オプション]\n" +
			"\n" +
			"    --root <パス>     対象のプロジェクトフォルダ（既定: カレントフォルダ）\n" +
			"    --dir <名前>      探索するフォルダ。複数回指定できる（既定: notes）\n" +
			"    --no-readme       ルート直下の README.html を対象から外す\n" +
			"    --dry-run         書き出さず、変換結果と検査結果だけを表示する\n" +
			"    --help            この説明を表示する\n" +
			"\n" +
			"  終了コード  0=指摘なし  1=指摘あり  2=引数や対象の誤り\n";

		private static int Main(string[] args)
		{
			string root = null;
			List<string> dirs = new List<string>();
			bool noReadme = false;
			bool dryRun = false;

			for (int i = 0; i < args.Length; i++)
			{
				string a = args[i];
				switch (a)
				{
					case "--root":
						if (i + 1 >= args.Length) return Fail("--root にフォルダを指定してください。");
						root = args[++i];
						break;
					case "--dir":
						if (i + 1 >= args.Length) return Fail("--dir にフォルダ名を指定してください。");
						dirs.Add(args[++i]);
						break;
					case "--no-readme":
						noReadme = true;
						break;
					case "--dry-run":
						dryRun = true;
						break;
					case "--help":
					case "-h":
					case "/?":
						Console.WriteLine(Usage);
						return 0;
					default:
						return Fail("知らないオプションです: " + a);
				}
			}

			if (string.IsNullOrEmpty(root)) root = Directory.GetCurrentDirectory();
			if (!Directory.Exists(root)) return Fail("フォルダが見つかりません: " + root);
			root = Path.GetFullPath(root);
			if (dirs.Count == 0) dirs.Add("notes");

			Console.WriteLine();
			Console.WriteLine("=== HTML → Markdown 変換 ===");
			if (dryRun) Console.WriteLine("（--dry-run: ファイルは書き出しません）");
			Console.WriteLine("対象ルート: " + root);
			Console.WriteLine("探索フォルダ: " + string.Join(", ", dirs.ToArray()) + (noReadme ? "" : " と README.html"));

			List<string> targets = CollectTargets(root, dirs, noReadme);
			if (targets.Count == 0)
			{
				Console.WriteLine();
				Console.WriteLine("変換対象の HTML が見つかりませんでした。");
				return 2;
			}

			Converter converter = new Converter();
			List<ConvertResult> results = new List<ConvertResult>();

			Console.WriteLine();
			foreach (string t in targets)
			{
				ConvertResult res;
				try
				{
					res = converter.ConvertFile(t, !dryRun);
				}
				catch (Exception ex)
				{
					Console.WriteLine("[" + Rel(root, t) + "]");
					Console.WriteLine("    ★変換に失敗しました: " + ex.Message);
					return 2;
				}
				int lines = res.Markdown.Split('\n').Length;
				int size = Encoding.UTF8.GetByteCount(res.Markdown);
				Console.WriteLine("[" + Rel(root, t) + "]");
				Console.WriteLine(string.Format("    -> {0}  ({1} 行 / {2:N1} KB)",
					Rel(root, res.MdPath), lines, size / 1024.0));
				if (res.Images.Count > 0)
				{
					List<string> shown = new List<string>();
					foreach (string img in res.Images) shown.Add("images/" + img);
					Console.WriteLine("    画像: " + string.Join(", ", shown.ToArray()));
				}
				results.Add(res);
			}

			// この実行で生成するファイル。--dry-run では書き出さないので、
			// これを実在扱いにしないと相互リンクと画像が全部リンク切れになる
			HashSet<string> expected = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
			foreach (ConvertResult r in results)
			{
				expected.Add(Path.GetFullPath(r.MdPath));
				string imgDir = Path.Combine(Path.GetDirectoryName(r.MdPath), "images");
				foreach (string img in r.Images) expected.Add(Path.GetFullPath(Path.Combine(imgDir, img)));
			}

			Console.WriteLine();
			Console.WriteLine("=== 検査 ===");
			int problems = 0;
			int warnings = 0;

			foreach (ConvertResult r in results)
			{
				Console.WriteLine("[" + Rel(root, r.HtmlPath) + "]");

				List<string> htmlBad = Checks.TestHtmlLinks(r.HtmlPath);
				if (htmlBad.Count > 0)
				{
					problems += htmlBad.Count;
					foreach (string b in htmlBad) Console.WriteLine("    ★HTML 側: " + b);
				}
				else
				{
					Console.WriteLine("    HTML 側のリンク: すべて .html で参照先も実在");
				}

				List<string> mdBad = Checks.TestMdLinks(r, expected);
				if (mdBad.Count > 0)
				{
					problems += mdBad.Count;
					foreach (string b in mdBad) Console.WriteLine("    ★Markdown 側: " + b);
				}
				else
				{
					Console.WriteLine("    Markdown 側のリンク: リンク切れ・アンカー切れなし");
				}

				List<string> extra = Checks.TestExtraText(r);
				if (extra.Count > 0)
				{
					problems += extra.Count;
					Console.WriteLine(string.Format("    ★HTML に無い文言 {0} 件:", extra.Count));
					foreach (string e in extra) Console.WriteLine("        " + e);
				}
				else
				{
					Console.WriteLine("    HTML に無い文言なし");
				}

				string dateNg = Checks.TestUpdatedDate(r.HtmlPath);
				if (dateNg.Length > 0)
				{
					warnings++;
					Console.WriteLine("    ▲" + dateNg);
				}
			}

			Console.WriteLine();
			if (problems > 0)
			{
				Console.WriteLine(string.Format("=== 変換完了。{0} 件の指摘あり ===", problems));
				if (warnings > 0) Console.WriteLine(string.Format("（ほかに警告 {0} 件）", warnings));
				return 1;
			}
			if (warnings > 0)
			{
				Console.WriteLine(string.Format("=== 変換完了。警告 {0} 件（指摘なし） ===", warnings));
			}
			else
			{
				Console.WriteLine("=== 変換完了。指摘なし ===");
			}
			Console.WriteLine();
			Console.WriteLine("生成した Markdown が GitHub で意図どおりに表示されるかは check-markdown で確かめる。");
			return 0;
		}

		/// <summary>変換対象を集める。ルート直下の README.html と、指定フォルダ配下の *.html。</summary>
		private static List<string> CollectTargets(string root, List<string> dirs, bool noReadme)
		{
			List<string> targets = new List<string>();
			if (!noReadme)
			{
				string readme = Path.Combine(root, "README.html");
				if (File.Exists(readme)) targets.Add(readme);
			}
			foreach (string d in dirs)
			{
				string full = Path.Combine(root, d);
				if (!Directory.Exists(full)) continue;
				string[] found = Directory.GetFiles(full, "*.html", SearchOption.AllDirectories);
				Array.Sort(found, StringComparer.OrdinalIgnoreCase);
				foreach (string f in found)
				{
					// index.html は README.html へのリダイレクト専用なので変換しない
					if (string.Equals(Path.GetFileName(f), "index.html", StringComparison.OrdinalIgnoreCase)) continue;
					if (!targets.Contains(f)) targets.Add(f);
				}
			}
			return targets;
		}

		private static string Rel(string root, string path)
		{
			if (path.StartsWith(root, StringComparison.OrdinalIgnoreCase))
			{
				return path.Substring(root.Length).TrimStart('\\', '/');
			}
			return path;
		}

		private static int Fail(string message)
		{
			Console.Error.WriteLine(message);
			Console.Error.WriteLine();
			Console.Error.WriteLine(Usage);
			return 2;
		}
	}
}
