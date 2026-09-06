using System;
using System.IO;

namespace ConvertEncoding
{
	/// <summary>
	/// ファイルの文字コードと改行を変換する。
	///
	///     convert-encoding &lt;path&gt; --to &lt;指定&gt;[/&lt;改行&gt;] [--from &lt;形式&gt;] [--force]
	///     convert-encoding &lt;path&gt; --info
	/// </summary>
	internal static class Program
	{
		private const int ExitOk = 0;
		private const int ExitBadArgs = 1;
		private const int ExitNoFile = 2;
		private const int ExitUnknownEncoding = 3;
		private const int ExitUnmappable = 4;
		private const int ExitWriteFailed = 5;

		private static int Main(string[] args)
		{
			string path = null;
			string toText = null;
			string fromText = null;
			bool force = false;
			bool info = false;

			for (int i = 0; i < args.Length; i++)
			{
				string a = args[i];

				if (a == "--help" || a == "-h" || a == "/?")
				{
					PrintUsage();
					return ExitOk;
				}
				if (a == "--to")
				{
					if (i + 1 >= args.Length) { return Fail(ExitBadArgs, "--to に値がありません。"); }
					toText = args[++i];
					continue;
				}
				if (a == "--from")
				{
					if (i + 1 >= args.Length) { return Fail(ExitBadArgs, "--from に値がありません。"); }
					fromText = args[++i];
					continue;
				}
				if (a == "--force") { force = true; continue; }
				if (a == "--info") { info = true; continue; }

				if (a.StartsWith("-"))
				{
					return Fail(ExitBadArgs, string.Format("知らないオプションです: {0}", a));
				}

				if (path != null)
				{
					return Fail(ExitBadArgs, "ファイルは 1 つだけ指定してください。");
				}
				path = a;
			}

			if (path == null)
			{
				PrintUsage();
				return ExitBadArgs;
			}
			if (!info && toText == null)
			{
				return Fail(ExitBadArgs, "--to か --info を指定してください。");
			}

			if (!File.Exists(path))
			{
				return Fail(ExitNoFile, string.Format("ファイルが見つかりません: {0}", path));
			}

			byte[] source;
			try
			{
				source = File.ReadAllBytes(path);
			}
			catch (Exception ex)
			{
				return Fail(ExitNoFile, string.Format("ファイルを読めません: {0} ({1})", path, ex.Message));
			}

			// 変換元の文字コードを決める
			EncodingKind fromKind;
			if (fromText != null)
			{
				string err;
				if (!Spec.TryParseSource(fromText, out fromKind, out err))
				{
					return Fail(ExitBadArgs, err);
				}
			}
			else if (!Detector.TryDetect(source, out fromKind))
			{
				return Fail(ExitUnknownEncoding, string.Format(
					"文字コードを判定できません。--from で指定してください: {0}", path));
			}

			string text = Converter.Decode(source, fromKind);

			int crlf, lf, cr;
			Converter.CountEol(text, out crlf, out lf, out cr);
			string fromEol = Converter.DescribeEol(crlf, lf, cr);

			string name = Path.GetFileName(path);

			if (info)
			{
				Console.WriteLine(string.Format(
					"{0}  {1}  CRLF={2}  LF={3}  CR={4}  {5:N0} bytes",
					name, Spec.NameOf(fromKind), crlf, lf, cr, source.Length));
				return ExitOk;
			}

			TargetSpec spec;
			string parseError;
			if (!Spec.TryParseTarget(toText, out spec, out parseError))
			{
				return Fail(ExitBadArgs, parseError);
			}

			EncodingKind toKind = spec.Encoding.HasValue ? spec.Encoding.Value : fromKind;

			// 表現できない文字があれば、既定では何もせずに終える
			if (!force)
			{
				string bad;
				int codePoint;
				int index;
				if (Converter.TryFindUnmappable(text, toKind, out bad, out codePoint, out index))
				{
					int line = Converter.GetLineNumber(text, index);
					Console.Error.WriteLine(string.Format(
						"[NG] {0} で表現できない文字があります: {1} 行目の '{2}' (U+{3:X4})",
						Spec.NameOf(toKind), line, bad, codePoint));
					Console.Error.WriteLine("     --force を付けると ? に置き換えて続行します");
					return ExitUnmappable;
				}
			}

			string converted = spec.Eol.HasValue
				? Converter.NormalizeEol(text, spec.Eol.Value)
				: text;

			byte[] result = Converter.Encode(converted, toKind);

			string toEol = spec.Eol.HasValue
				? Spec.NameOf(spec.Eol.Value)
				: fromEol;

			if (Converter.SameBytes(source, result))
			{
				Console.WriteLine(string.Format(
					"{0}  {1}+{2}  変更なし", name, Spec.NameOf(fromKind), fromEol));
				return ExitOk;
			}

			try
			{
				WriteAtomic(path, result);
			}
			catch (Exception ex)
			{
				return Fail(ExitWriteFailed, string.Format("書き込みに失敗しました: {0}", ex.Message));
			}

			Console.WriteLine(string.Format(
				"{0}  {1}+{2} -> {3}+{4}  {5:N0} -> {6:N0} bytes",
				name,
				Spec.NameOf(fromKind), fromEol,
				Spec.NameOf(toKind), toEol,
				source.Length, result.Length));

			return ExitOk;
		}

		/// <summary>
		/// 同じフォルダに一時ファイルを作ってから置き換える。
		/// 書き込みの途中で失敗しても元のファイルが壊れない。
		/// </summary>
		private static void WriteAtomic(string path, byte[] bytes)
		{
			string dir = Path.GetDirectoryName(Path.GetFullPath(path));
			string temp = Path.Combine(dir, Path.GetFileName(path) + "." + Guid.NewGuid().ToString("N") + ".tmp");

			File.WriteAllBytes(temp, bytes);
			try
			{
				File.Replace(temp, path, null);
			}
			catch (PlatformNotSupportedException)
			{
				// FAT32 など File.Replace が使えない場合
				File.Copy(temp, path, true);
				File.Delete(temp);
			}
		}

		private static int Fail(int code, string message)
		{
			Console.Error.WriteLine("[NG] " + message);
			return code;
		}

		private static void PrintUsage()
		{
			Console.WriteLine("ファイルの文字コードと改行を変換します。");
			Console.WriteLine();
			Console.WriteLine("  convert-encoding <path> --to <指定>[/<改行>] [--from <形式>] [--force]");
			Console.WriteLine("  convert-encoding <path> --info");
			Console.WriteLine();
			Console.WriteLine("--to の指定");
			Console.WriteLine("  ps1            UTF-8 BOM 付き ＋ CRLF");
			Console.WriteLine("  cmd  bat       SJIS ＋ CRLF");
			Console.WriteLine("  reg            UTF-16 LE ＋ BOM ＋ CRLF");
			Console.WriteLine("  html           UTF-8 BOM 付き ＋ LF");
			Console.WriteLine("  utf8  utf8bom  sjis  utf16le  utf16be");
			Console.WriteLine("                 文字コードだけを変える。改行は入力のまま");
			Console.WriteLine("  /lf  /crlf     改行を上書きする。単独で書くと改行だけ変える");
			Console.WriteLine();
			Console.WriteLine("--from の指定");
			Console.WriteLine("  省略すると自動で判定します。改行は書けません。");
			Console.WriteLine("  " + Spec.DescribeSourceNames());
			Console.WriteLine();
			Console.WriteLine("終了コード");
			Console.WriteLine("  0 成功  1 引数エラー  2 ファイル無し");
			Console.WriteLine("  3 文字コードを判定できない  4 表現できない文字がある  5 書き込み失敗");
		}
	}
}
