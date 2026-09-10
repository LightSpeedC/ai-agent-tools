using System;
using System.Collections.Generic;
using System.IO;
using System.Text;

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
			bool read = false;
			bool dump = false;
			int dumpOffset = 0;
			int dumpBytes = -1;   // -1 は末尾まで

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
				if (a == "--read") { read = true; continue; }
				if (a == "--dump") { dump = true; continue; }
				if (a == "--offset")
				{
					if (i + 1 >= args.Length) { return Fail(ExitBadArgs, "--offset に値がありません。"); }
					if (!int.TryParse(args[++i], out dumpOffset) || dumpOffset < 0)
					{
						return Fail(ExitBadArgs, "--offset には 0 以上の整数を指定してください。");
					}
					continue;
				}
				if (a == "--bytes")
				{
					if (i + 1 >= args.Length) { return Fail(ExitBadArgs, "--bytes に値がありません。"); }
					if (!int.TryParse(args[++i], out dumpBytes) || dumpBytes < 0)
					{
						return Fail(ExitBadArgs, "--bytes には 0 以上の整数を指定してください。");
					}
					continue;
				}

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
			bool expandHex = string.Equals(fromText, "hex", StringComparison.OrdinalIgnoreCase);

			if (!info && !read && !dump && !expandHex && toText == null)
			{
				return Fail(ExitBadArgs, "--to か --info か --read を指定してください。");
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

			// バイト列を 16 進で出す。文字コードの判定は通さない。
			// 判定できないファイルの中身も確かめられるようにするため
			if (dump)
			{
				WriteStdout(DumpHex(source, dumpOffset, dumpBytes));
				return ExitOk;
			}

			// 16 進テキストの展開。文字コードの判定は通さない。
			// 入力は ASCII で、展開した結果が妥当なバイト列である必要も無い
			// （判定できないバイト列を作るのが用途のため）
			if (expandHex)
			{
				if (toText != null)
				{
					return Fail(ExitBadArgs, "--from hex と --to は併用できません。展開だけを行います。");
				}
				if (read || info)
				{
					// --from hex は展開してファイルを書き換える操作。読むだけの --read/--info と
					// 併用すると、読むつもりで元ファイルを上書きしてしまう。
					return Fail(ExitBadArgs, "--from hex と --read/--info は併用できません（--from hex はファイルを書き換えます）。");
				}

				byte[] expanded;
				string hexError;
				if (!TryParseHex(source, out expanded, out hexError))
				{
					return Fail(ExitBadArgs, hexError);
				}

				if (Converter.SameBytes(source, expanded))
				{
					Console.WriteLine(string.Format("{0}  変更なし", Path.GetFileName(path)));
					return ExitOk;
				}

				try
				{
					WriteAtomic(path, expanded);
				}
				catch (Exception ex)
				{
					return Fail(ExitWriteFailed, string.Format("書き込みに失敗しました: {0}", ex.Message));
				}

				Console.WriteLine(string.Format(
					"{0}  16 進 -> バイト列  {1:N0} -> {2:N0} bytes",
					Path.GetFileName(path), source.Length, expanded.Length));
				return ExitOk;
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

			// 中身を読むだけ。SJIS のファイルは読み取りツールが文字化けさせるため、
			// ここで UTF-8 に直して標準出力へ流す
			if (read)
			{
				WriteStdout(text);
				return ExitOk;
			}

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

			// 文字コードが変わらず、単バイト安全な UTF-8 / SJIS のときは、
			// デコードを通さずバイト列のまま改行だけ置き換える。
			// CP932 の重複文字がデコード・エンコードで別のバイト列に化けるのを防ぐ
			if (toKind == fromKind && IsByteSafeForEol(toKind) && HasCorrectPreamble(source, toKind))
			{
				byte[] kept = spec.Eol.HasValue
					? Converter.NormalizeEolBytes(source, spec.Eol.Value)
					: source;

				string keptEol = spec.Eol.HasValue ? Spec.NameOf(spec.Eol.Value) : fromEol;

				if (Converter.SameBytes(source, kept))
				{
					Console.WriteLine(string.Format(
						"{0}  {1}+{2}  変更なし", name, Spec.NameOf(fromKind), fromEol));
					return ExitOk;
				}

				try
				{
					WriteAtomic(path, kept);
				}
				catch (Exception ex)
				{
					return Fail(ExitWriteFailed, string.Format("書き込みに失敗しました: {0}", ex.Message));
				}

				Console.WriteLine(string.Format(
					"{0}  {1}+{2} -> {1}+{3}  {4:N0} -> {5:N0} bytes",
					name, Spec.NameOf(fromKind), fromEol, keptEol, source.Length, kept.Length));
				return ExitOk;
			}

			// ここに来るのは再エンコードする経路（バイト保持パスは上で return 済み）。
			// 元の組として読めないバイトがあれば止める。best-fit で別の文字に化けたまま
			// 書き戻されるのを防ぐ（デコード方向の保証）。
			if (!force)
			{
				int undecodable;
				if (Converter.TryFindUndecodable(source, fromKind, out undecodable))
				{
					Console.Error.WriteLine(string.Format(
						"[NG] {0} として読めないバイトがあります（位置 {1}）",
						Spec.NameOf(fromKind), undecodable));
					Console.Error.WriteLine("     --from で組を指定するか、--force で ? として続行します");
					return ExitUnmappable;
				}
			}

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

		/// <summary>
		/// 16 進テキストをバイト列に直す。空白と改行は読み飛ばす。
		/// 「41 80 42」「418042」「行ごとに分かれた形」のいずれも受ける。
		/// </summary>
		private static bool TryParseHex(byte[] source, out byte[] result, out string error)
		{
			result = null;
			error = null;

			// 入力は 16 進なので ASCII しか現れない。BOM があれば取り除く
			int offset = 0;
			if (source.Length >= 3 && source[0] == 0xEF && source[1] == 0xBB && source[2] == 0xBF)
			{
				offset = 3;
			}
			string text = new UTF8Encoding(false).GetString(source, offset, source.Length - offset);

			List<byte> bytes = new List<byte>();
			int high = -1;

			for (int i = 0; i < text.Length; i++)
			{
				char c = text[i];
				if (c == ' ' || c == '\t' || c == '\r' || c == '\n') { continue; }

				int v = HexValue(c);
				if (v < 0)
				{
					error = string.Format(
						"16 進として読めない文字があります: {0} 文字目の '{1}'", i + 1, c);
					return false;
				}

				if (high < 0) { high = v; }
				else { bytes.Add((byte)((high << 4) | v)); high = -1; }
			}

			if (high >= 0)
			{
				error = "16 進の桁数が奇数です。2 桁で 1 バイトになります。";
				return false;
			}

			result = bytes.ToArray();
			return true;
		}

		/// <summary>
		/// バイト列のまま改行を置き換えてよい文字コードか。0x0A / 0x0D が
		/// 文字の途中に現れない単バイト安全なものだけ true。UTF-16 は
		/// 改行が 2 バイトになり複雑なので対象にしない（符号化が一意で
		/// デコード経路でもバイトが化けないため、そちらに任せる）。
		/// </summary>
		private static bool IsByteSafeForEol(EncodingKind kind)
		{
			return kind == EncodingKind.Utf8
				|| kind == EncodingKind.Utf8Bom
				|| kind == EncodingKind.Sjis;
		}

		/// <summary>
		/// バイト保持パスに入る前提が正しいかの確認。--from で組を強制指定した場合、
		/// 実際の先頭バイトが BOM の形になっていないことがある（BOM なしの UTF-8 に
		/// --from utf8bom を指定する等）。その状態のまま素通りさせると、
		/// BOM が付かないまま「変更なし」で終わってしまう。
		/// </summary>
		private static bool HasCorrectPreamble(byte[] source, EncodingKind kind)
		{
			byte[] pre = Converter.GetPreamble(kind);
			if (pre.Length == 0) return true;
			if (source.Length < pre.Length) return false;
			for (int i = 0; i < pre.Length; i++)
			{
				if (source[i] != pre[i]) return false;
			}
			return true;
		}

		/// <summary>
		/// バイト列を 16 進テキストにする。2 桁ずつ空白区切りで、16 バイトごとに改行。
		/// 末尾にも改行 1 つ。人が目で追いやすいように折り返す（16 は hexdump の慣例）。
		/// 空白も改行も --from hex が読み飛ばすため、折り返しても往復は保たれる。
		/// offset がファイルを超えたら空、bytes が超えたらある分だけ出す。
		/// </summary>
		private static string DumpHex(byte[] source, int offset, int count)
		{
			const int PerLine = 16;

			int start = (offset < source.Length) ? offset : source.Length;
			// start + count は int オーバーフローで負になりうる（巨大な --bytes）。long で計算する。
			int end;
			if (count < 0) { end = source.Length; }
			else
			{
				long e = (long)start + count;
				end = (e > source.Length) ? source.Length : (int)e;
			}

			StringBuilder sb = new StringBuilder();
			int col = 0;
			for (int i = start; i < end; i++)
			{
				if (col == PerLine) { sb.Append('\n'); col = 0; }
				if (col > 0) { sb.Append(' '); }
				sb.Append(source[i].ToString("X2"));
				col++;
			}
			// 中身があれば末尾に改行を 1 つ。空なら何も出さない
			if (sb.Length > 0) { sb.Append('\n'); }
			return sb.ToString();
		}

		private static int HexValue(char c)
		{
			if (c >= '0' && c <= '9') { return c - '0'; }
			if (c >= 'a' && c <= 'f') { return c - 'a' + 10; }
			if (c >= 'A' && c <= 'F') { return c - 'A' + 10; }
			return -1;
		}

		/// <summary>
		/// 標準出力へ UTF-8 で書く。Console.Write を使うと出力コードページに従って
		/// 変換されるため、ストリームへ直接バイト列を流す。BOM は付けない。
		/// </summary>
		private static void WriteStdout(string text)
		{
			byte[] bytes = new UTF8Encoding(false).GetBytes(text);
			using (Stream stdout = Console.OpenStandardOutput())
			{
				stdout.Write(bytes, 0, bytes.Length);
				stdout.Flush();
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
			Console.WriteLine("  convert-encoding <path> --read");
			Console.WriteLine("  convert-encoding <path> --from hex");
			Console.WriteLine("  convert-encoding <path> --dump [--offset <n>] [--bytes <m>]");
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
			Console.WriteLine("--read");
			Console.WriteLine("  中身を UTF-8 で標準出力へ出す。ファイルは書き換えません。");
			Console.WriteLine("  SJIS のファイルを読むときに使います。");
			Console.WriteLine();
			Console.WriteLine("--dump");
			Console.WriteLine("  中身を 16 進テキストで標準出力へ出す。ファイルは書き換えません。");
			Console.WriteLine("  --offset と --bytes で範囲を絞れます。出力は --from hex へ渡せます。");
			Console.WriteLine();
			Console.WriteLine("--from の指定");
			Console.WriteLine("  省略すると自動で判定します。改行は書けません。");
			Console.WriteLine("  " + Spec.DescribeSourceNames());
			Console.WriteLine("  hex を渡すと、中身を 16 進テキストとみなしてバイト列に展開します。");
			Console.WriteLine();
			Console.WriteLine("終了コード");
			Console.WriteLine("  0 成功  1 引数エラー  2 ファイル無し");
			Console.WriteLine("  3 文字コードを判定できない  4 表現できない文字がある  5 書き込み失敗");
		}
	}
}
