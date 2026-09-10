using System;
using System.Collections.Generic;
using System.IO;

namespace TextTool
{
	/// <summary>text write — 指定した組（--to）または既存の組（--keep）で全文を書く。</summary>
	internal static class WriteCmd
	{
		private static readonly HashSet<string> ValueOpts =
			new HashSet<string>(StringComparer.Ordinal) { "--to", "--in", "--from" };

		public static int Run(string[] a)
		{
			Args args = Args.Parse(a, ValueOpts);
			if (args.Positional.Count < 1) { throw new ToolError(2, "書くファイルを指定してください。"); }
			string path = args.Positional[0];

			EncKind enc; EolKind eol;
			string to = args.Get("--to");
			bool keep = args.Flag("--keep", "--keep");

			if (to != null)
			{
				string err;
				if (!Names.TryTo(to, out enc, out eol, out err)) { throw new ToolError(2, err); }
			}
			else if (keep)
			{
				if (!File.Exists(path)) { throw new ToolError(2, "--keep は既存ファイルが要ります: " + Files.Show(path)); }
				byte[] cur = Files.ReadBytes(path);
				Combo c = Files.Resolve(cur, args.Get("--from"));
				if (c.Ambiguous)
				{
					throw new ToolError(3, "既存ファイルの組を決められません。--from で明示してください: " + Files.Show(path));
				}
				enc = c.Enc; eol = c.Eol;
			}
			else
			{
				throw new ToolError(2, "--to <用途> か --keep を指定してください。");
			}

			string content = ReadContent(args);
			string eolStr = EolStr(eol);
			if (eolStr != null)
			{
				content = content.Replace("\r\n", "\n").Replace("\r", "\n");
				if (eolStr != "\n") { content = content.Replace("\n", eolStr); }
			}

			string badCh; int badCp;
			if (Codec.TryFindUnmappable(content, enc, out badCh, out badCp))
			{
				throw new ToolError(5, string.Format(
					"{0} で表現できない文字です: '{1}' (U+{2:X4})。書き込む中身を見直してください。",
					Names.Enc(enc), badCh, badCp));
			}

			byte[] result = Codec.EncodeFull(content, enc);

			if (File.Exists(path))
			{
				byte[] old = File.ReadAllBytes(path);
				if (SameBytes(old, result))
				{
					Io.Out("変更なし: " + Files.Show(path));
					return 0;
				}
			}

			Files.WriteAtomic(path, result);
			Io.Out("書きました: " + Files.Show(path) + " [" + Names.Enc(enc) + "/" + Names.Eol(eol) + "]");
			return 0;
		}

		private static string ReadContent(Args args)
		{
			string inFile = args.Get("--in");
			if (inFile != null)
			{
				byte[] b = Files.ReadBytes(inFile);
				Combo c = Detector.Detect(b);
				if (c.Ambiguous)
				{
					throw new ToolError(3,
						"UTF-8 と SJIS の両方で妥当で組を決められません（--in）: " + Files.Show(inFile));
				}
				return Codec.Decode(b, c.Enc);
			}
			// 第 2 引数は標準入力より優先する。エージェントのシェルは stdin が
			// 常にリダイレクト状態のため、引数を先に見ないと空の stdin で上書きしてしまう。
			if (args.Positional.Count >= 2) { return args.Positional[1]; }
			if (Console.IsInputRedirected)
			{
				using (Stream s = Console.OpenStandardInput())
				using (MemoryStream ms = new MemoryStream())
				{
					byte[] buf = new byte[8192];
					int n;
					while ((n = s.Read(buf, 0, buf.Length)) > 0) { ms.Write(buf, 0, n); }
					byte[] all = ms.ToArray();
					// 空の標準入力で 0 バイト上書きしない。中身があるときだけ採用する。
					if (all.Length > 0)
					{
						Combo c = Detector.Detect(all);
						if (c.Ambiguous)
						{
							throw new ToolError(3, "UTF-8 と SJIS の両方で妥当で組を決められません（標準入力）。");
						}
						return Codec.Decode(all, c.Enc);
					}
				}
			}
			throw new ToolError(2, "書き込む中身を --in <path>、第 2 引数、または（空でない）標準入力で渡してください。");
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

		private static bool SameBytes(byte[] x, byte[] y)
		{
			if (x.Length != y.Length) { return false; }
			for (int i = 0; i < x.Length; i++) { if (x[i] != y[i]) { return false; } }
			return true;
		}
	}
}
