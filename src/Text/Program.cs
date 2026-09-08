using System;
using System.Collections.Generic;
using System.IO;
using System.Text;

namespace TextTool
{
	/// <summary>
	/// text — 文字コード対応テキスト・ツール一式。
	/// text read | find | edit | write のサブコマンドに振り分ける。
	/// 終了コード: 0 成功 / 1 find 一致なし / 2 エラー / 3 両方妥当で拒否 / 4 合言葉不一致。
	/// </summary>
	internal static class Program
	{
		public static int Main(string[] args)
		{
			// 非 Windows（将来 dotnet）で CP932 を使うには CodePages プロバイダの登録が要る。
			// .NET Framework の csc ビルドでは標準で 932 が使えるため、ここでは登録しない。

			Io.Init();

			if (args.Length == 0)
			{
				Io.Err("使い方: text <read|find|edit|write> ...");
				return 2;
			}

			string verb = args[0];
			string[] rest = new string[args.Length - 1];
			Array.Copy(args, 1, rest, 0, rest.Length);

			try
			{
				switch (verb)
				{
					case "read": return ReadCmd.Run(rest);
					case "find": return FindCmd.Run(rest);
					case "edit": return EditCmd.Run(rest);
					case "write": return WriteCmd.Run(rest);
					case "-h":
					case "--help":
						Io.Out("text <read|find|edit|write> — 文字コード対応のテキスト操作");
						return 0;
					default:
						Io.Err("不明なサブコマンドです: " + verb);
						return 2;
				}
			}
			catch (ToolError e)
			{
				Io.Err(e.Message);
				return e.Code;
			}
			catch (FileNotFoundException e)
			{
				Io.Err("ファイルが見つかりません: " + e.FileName);
				return 2;
			}
			catch (Exception e)
			{
				Io.Err("エラー: " + e.Message);
				return 2;
			}
		}
	}

	/// <summary>終了コード付きのエラー。</summary>
	internal sealed class ToolError : Exception
	{
		public readonly int Code;
		public ToolError(int code, string message) : base(message) { Code = code; }
	}

	/// <summary>標準出力は UTF-8 で出す。</summary>
	internal static class Io
	{
		private static Stream outStream;
		private static UTF8Encoding utf8;

		public static void Init()
		{
			utf8 = new UTF8Encoding(false);
			outStream = Console.OpenStandardOutput();
		}

		public static void Out(string s)
		{
			byte[] b = utf8.GetBytes(s + "\n");
			outStream.Write(b, 0, b.Length);
			outStream.Flush();
		}

		/// <summary>改行を付けずに出す。</summary>
		public static void OutRaw(string s)
		{
			byte[] b = utf8.GetBytes(s);
			outStream.Write(b, 0, b.Length);
			outStream.Flush();
		}

		public static void Err(string s)
		{
			Console.Error.WriteLine(s);
		}
	}

	/// <summary>簡易な引数パーサ。--name value / --flag / 位置引数。</summary>
	internal sealed class Args
	{
		private readonly Dictionary<string, string> opts =
			new Dictionary<string, string>(StringComparer.Ordinal);
		private readonly HashSet<string> flags = new HashSet<string>(StringComparer.Ordinal);
		private readonly List<string> positional = new List<string>();

		/// <summary>値を取るオプション名の集合を渡して解釈する。</summary>
		public static Args Parse(string[] a, HashSet<string> valueOpts)
		{
			Args r = new Args();
			int i = 0;
			while (i < a.Length)
			{
				string t = a[i];
				if (t.StartsWith("-", StringComparison.Ordinal) && t.Length > 1)
				{
					if (valueOpts.Contains(t))
					{
						if (i + 1 >= a.Length)
						{
							throw new ToolError(2, t + " に値がありません。");
						}
						r.opts[t] = a[i + 1];
						i += 2;
					}
					else
					{
						r.flags.Add(t);
						i++;
					}
				}
				else
				{
					r.positional.Add(t);
					i++;
				}
			}
			return r;
		}

		public string Get(string name) { string v; return opts.TryGetValue(name, out v) ? v : null; }
		public bool Has(string name) { return flags.Contains(name) || opts.ContainsKey(name); }
		public bool Flag(string a, string b) { return flags.Contains(a) || flags.Contains(b); }
		public List<string> Positional { get { return positional; } }
	}

	/// <summary>ファイルの読み・組の判定・行範囲・splice をまとめる。</summary>
	internal static class Files
	{
		public static byte[] ReadBytes(string path)
		{
			if (!File.Exists(path)) { throw new ToolError(2, "ファイルがありません: " + Show(path)); }
			return File.ReadAllBytes(path);
		}

		/// <summary>組を決める。--from があれば判定を上書き。</summary>
		public static Combo Resolve(byte[] bytes, string from)
		{
			if (!string.IsNullOrEmpty(from))
			{
				EncKind k; string err;
				if (!Names.TryFrom(from, out k, out err)) { throw new ToolError(2, err); }
				Combo c = new Combo();
				c.Enc = k;
				c.Eol = Detector.EolOf(bytes, k);
				return c;
			}
			return Detector.Detect(bytes);
		}

		/// <summary>文字インデックス → 元バイト列でのオフセット。</summary>
		public static int ByteOffset(byte[] original, string decoded, int charIndex, EncKind enc)
		{
			int pre = Codec.PreambleLen(original, enc);
			if (charIndex <= 0) { return pre; }
			byte[] prefix = Codec.EncodeRaw(decoded.Substring(0, charIndex), enc);
			return pre + prefix.Length;
		}

		/// <summary>[csChar, ceChar) を newText に置き換えたバイト列を作る（元バイトを保つ）。</summary>
		public static byte[] Splice(byte[] original, string decoded, EncKind enc,
			int csChar, int ceChar, string newText)
		{
			int bStart = ByteOffset(original, decoded, csChar, enc);
			int bEnd = ByteOffset(original, decoded, ceChar, enc);
			byte[] mid = Codec.EncodeRaw(newText, enc);

			int tail = original.Length - bEnd;
			byte[] result = new byte[bStart + mid.Length + tail];
			Buffer.BlockCopy(original, 0, result, 0, bStart);
			Buffer.BlockCopy(mid, 0, result, bStart, mid.Length);
			Buffer.BlockCopy(original, bEnd, result, bStart + mid.Length, tail);
			return result;
		}

		/// <summary>
		/// 一時ファイルに書いてから置き換える。途中で中断してもファイルが壊れない。
		/// 新規ファイル（置換先が無い）にも対応する。
		/// </summary>
		public static void WriteAtomic(string path, byte[] bytes)
		{
			string full = Path.GetFullPath(path);
			string dir = Path.GetDirectoryName(full);
			string temp = Path.Combine(dir, Path.GetFileName(full) + "." + Guid.NewGuid().ToString("N") + ".tmp");
			File.WriteAllBytes(temp, bytes);
			try
			{
				if (File.Exists(path)) { File.Replace(temp, path, null); }
				else { File.Move(temp, path); }
			}
			catch (PlatformNotSupportedException)
			{
				// FAT32 など File.Replace が使えない場合
				File.Copy(temp, path, true);
				File.Delete(temp);
			}
		}

		/// <summary>更新日時（ローカル）を yymmdd-hhmmss-ccc で。</summary>
		public static string Mtime(string path)
		{
			return Digest.Mtime(File.GetLastWriteTime(path));
		}

		/// <summary>表示用にユーザープロファイルを ~ に伏せる。</summary>
		public static string Show(string path)
		{
			string home = Environment.GetFolderPath(Environment.SpecialFolder.UserProfile);
			string p = path.Replace('\\', '/');
			if (!string.IsNullOrEmpty(home))
			{
				string h = home.Replace('\\', '/');
				if (p.StartsWith(h, StringComparison.OrdinalIgnoreCase))
				{
					p = "~" + p.Substring(h.Length);
				}
			}
			return p;
		}
	}
}
