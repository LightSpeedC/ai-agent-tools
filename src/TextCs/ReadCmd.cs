using System;
using System.Collections.Generic;
using System.Text;

namespace TextTool
{
	/// <summary>text read — 何であろうと読み、UTF-8 で見せる。◆ ヘッダに組・サイズ・更新日時・合言葉。</summary>
	internal static class ReadCmd
	{
		private static readonly HashSet<string> ValueOpts =
			new HashSet<string>(StringComparer.Ordinal) { "--from", "--lines" };

		public static int Run(string[] a)
		{
			Args args = Args.Parse(a, ValueOpts);
			if (args.Positional.Count < 1) { throw new ToolError(2, "読むファイルを指定してください。"); }
			string path = args.Positional[0];

			byte[] bytes = Files.ReadBytes(path);
			Combo combo = Files.Resolve(bytes, args.Get("--from"));
			string text = Codec.Decode(bytes, combo.Enc);
			List<Line> lines = Lines.Split(text);

			int a1 = 1, b1 = lines.Count;
			bool hasLines = args.Get("--lines") != null;
			if (hasLines) { ParseLines(args.Get("--lines"), lines.Count, out a1, out b1); }

			int cs = lines[a1 - 1].Start;
			// 全文（--lines 無し）は末尾改行も含めた全体をハッシュする。edit 側の
			// 全文 digest（text 全体）と範囲を合わせるため（末尾改行の有無で不一致になるのを防ぐ）。
			int ce = hasLines ? lines[b1 - 1].ContentEnd : text.Length;
			string rangeText = text.Substring(cs, ce - cs);
			string digest = Digest.Compute(rangeText, bytes.LongLength, Files.Mtime(path));

			StringBuilder head = new StringBuilder();
			head.Append("◆\"").Append(Files.Show(path)).Append("\" [")
				.Append(combo.Name()).Append("] size=").Append(bytes.LongLength)
				.Append(" mtime=").Append(Files.Mtime(path));
			if (hasLines) { head.Append(" lines=").Append(a1).Append("-").Append(b1); }
			head.Append(" digest=").Append(digest);

			if (args.Flag("--no-number", "--no-number"))
			{
				// 中身だけを別処理へ渡す用途。◆ ヘッダは出さない。
				int from = lines[a1 - 1].Start;
				int to = lines[b1 - 1].FullEnd;
				Io.OutRaw(text.Substring(from, to - from));
				return 0;
			}

			Io.Out(head.ToString());

			for (int i = a1; i <= b1; i++)
			{
				string num = i.ToString();
				if (num.Length < 6) { num = new string(' ', 6 - num.Length) + num; }
				Io.Out(num + ":\t" + Lines.Content(text, lines[i - 1]));
			}
			return 0;
		}

		public static void ParseLines(string spec, int count, out int a, out int b)
		{
			a = 1; b = count;
			int dash = spec.IndexOf('-');
			if (dash < 0) { throw new ToolError(2, "--lines は A-B の形で指定してください: " + spec); }
			if (!int.TryParse(spec.Substring(0, dash), out a) ||
				!int.TryParse(spec.Substring(dash + 1), out b))
			{
				throw new ToolError(2, "--lines の数が読めません: " + spec);
			}
			if (a < 1 || b < a || b > count)
			{
				throw new ToolError(2, string.Format(
					"--lines の範囲が不正です: {0}（全 {1} 行）", spec, count));
			}
		}
	}
}
