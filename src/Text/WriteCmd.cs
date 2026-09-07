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

			File.WriteAllBytes(path, result);
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
				return Codec.Decode(b, c.Enc);
			}
			if (Console.IsInputRedirected)
			{
				using (Stream s = Console.OpenStandardInput())
				using (MemoryStream ms = new MemoryStream())
				{
					byte[] buf = new byte[8192];
					int n;
					while ((n = s.Read(buf, 0, buf.Length)) > 0) { ms.Write(buf, 0, n); }
					byte[] all = ms.ToArray();
					Combo c = Detector.Detect(all);
					return Codec.Decode(all, c.Enc);
				}
			}
			if (args.Positional.Count >= 2) { return args.Positional[1]; }
			throw new ToolError(2, "書き込む中身を --in <path> か標準入力、または第 2 引数で渡してください。");
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
