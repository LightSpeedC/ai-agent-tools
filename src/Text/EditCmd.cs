using System;
using System.Collections.Generic;

namespace TextTool
{
	/// <summary>text edit — 判定 → 部分置換 → 元の組のまま書き戻す。合言葉で競合を検知。</summary>
	internal static class EditCmd
	{
		private static readonly HashSet<string> ValueOpts =
			new HashSet<string>(StringComparer.Ordinal)
			{ "--from", "--lines", "--digest", "--old", "--old-file", "--new", "--new-file" };

		public static int Run(string[] a)
		{
			Args args = Args.Parse(a, ValueOpts);
			if (args.Positional.Count < 1) { throw new ToolError(2, "編集するファイルを指定してください。"); }
			string path = args.Positional[0];

			byte[] bytes = Files.ReadBytes(path);
			Combo combo = Files.Resolve(bytes, args.Get("--from"));
			if (combo.Ambiguous)
			{
				throw new ToolError(3,
					"UTF-8 と SJIS の両方で妥当で組を決められません。--from で明示してください: " + Files.Show(path));
			}
			string text = Codec.Decode(bytes, combo.Enc);
			List<Line> lines = Lines.Split(text);
			string eol = EolStr(combo.Eol);

			// 置き換える中身
			string newText = ReadContent(args.Get("--new"), args.Get("--new-file"), "--new");
			if (newText == null) { throw new ToolError(2, "--new か --new-file で置き換える中身を指定してください。"); }
			newText = Normalize(newText, eol);

			// スコープ（--lines）
			bool hasLines = args.Get("--lines") != null;
			int a1 = 1, b1 = lines.Count;
			if (hasLines) { ReadCmd.ParseLines(args.Get("--lines"), lines.Count, out a1, out b1); }
			int scopeStart = lines[a1 - 1].Start;
			int scopeEnd = lines[b1 - 1].ContentEnd;

			// 合言葉の照合（スコープ範囲、--lines 無しは全体）
			string digestArg = args.Get("--digest");
			if (digestArg != null)
			{
				int ds = hasLines ? scopeStart : 0;
				int de = hasLines ? scopeEnd : text.Length;
				string got = Digest.Compute(text.Substring(ds, de - ds), bytes.LongLength, Files.Mtime(path));
				if (!string.Equals(got, digestArg, StringComparison.OrdinalIgnoreCase))
				{
					throw new ToolError(4, string.Format(
						"合言葉が一致しません（別の人が更新した可能性）。渡された {0} / いまの {1}。read し直してください。",
						digestArg, got));
				}
			}

			// 置換対象の特定
			int cs, ce;
			string oldText = ReadContent(args.Get("--old"), args.Get("--old-file"), "--old");
			if (oldText != null)
			{
				oldText = Normalize(oldText, eol);
				string scope = text.Substring(scopeStart, scopeEnd - scopeStart);
				int idx = scope.IndexOf(oldText, StringComparison.Ordinal);
				if (idx < 0) { throw new ToolError(2, "--old に一致する箇所がありません。"); }
				if (scope.IndexOf(oldText, idx + 1, StringComparison.Ordinal) >= 0)
				{
					throw new ToolError(2, "--old が複数箇所に一致します。--lines で範囲を絞ってください。");
				}
				cs = scopeStart + idx;
				ce = cs + oldText.Length;
			}
			else if (hasLines)
			{
				cs = scopeStart; ce = scopeEnd;   // 行範囲まるごと
			}
			else
			{
				throw new ToolError(2, "--lines か --old で置換対象を指定してください。");
			}

			string badCh; int badCp;
			if (Codec.TryFindUnmappable(newText, combo.Enc, out badCh, out badCp))
			{
				throw new ToolError(5, string.Format(
					"{0} で表現できない文字です: '{1}' (U+{2:X4})。置換内容を見直してください。",
					Names.Enc(combo.Enc), badCh, badCp));
			}

			byte[] result = Files.Splice(bytes, text, combo.Enc, cs, ce, newText);

			if (SameBytes(result, bytes))
			{
				Io.Out("変更なし: " + Files.Show(path));
				return 0;
			}

			Files.WriteAtomic(path, result);
			Io.Out("置換しました: " + Files.Show(path) + " [" + combo.Name() + "]");
			return 0;
		}

		private static string ReadContent(string inline, string file, string label)
		{
			if (inline != null && file != null)
			{
				throw new ToolError(2, label + " と " + label + "-file は同時に指定できません。");
			}
			if (inline != null) { return inline; }
			if (file != null)
			{
				byte[] b = Files.ReadBytes(file);
				Combo c = Detector.Detect(b);
				if (c.Ambiguous)
				{
					throw new ToolError(3,
						"UTF-8 と SJIS の両方で妥当で組を決められません（" + label + "-file）: " + Files.Show(file));
				}
				return Codec.Decode(b, c.Enc);
			}
			return null;
		}

		private static string EolStr(EolKind k)
		{
			switch (k)
			{
				case EolKind.CrLf: return "\r\n";
				case EolKind.Lf: return "\n";
				case EolKind.Cr: return "\r";
				default: return null;
			}
		}

		private static string Normalize(string s, string eol)
		{
			if (eol == null) { return s; }
			string lf = s.Replace("\r\n", "\n").Replace("\r", "\n");
			if (eol == "\n") { return lf; }
			return lf.Replace("\n", eol);
		}

		private static bool SameBytes(byte[] x, byte[] y)
		{
			if (x.Length != y.Length) { return false; }
			for (int i = 0; i < x.Length; i++) { if (x[i] != y[i]) { return false; } }
			return true;
		}
	}
}
