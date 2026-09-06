using System;
using System.Collections.Generic;
using System.Text;

namespace ConvertEncoding
{
	/// <summary>
	/// デコード・エンコード・改行の変換。
	/// </summary>
	internal static class Converter
	{
		private static readonly byte[] Utf8Preamble = new byte[] { 0xEF, 0xBB, 0xBF };
		private static readonly byte[] Utf16LePreamble = new byte[] { 0xFF, 0xFE };
		private static readonly byte[] Utf16BePreamble = new byte[] { 0xFE, 0xFF };
		private static readonly byte[] NoPreamble = new byte[0];

		/// <summary>BOM を書き出さない素の Encoding。</summary>
		private static Encoding GetRaw(EncodingKind kind)
		{
			switch (kind)
			{
				case EncodingKind.Utf8:
				case EncodingKind.Utf8Bom:
					return new UTF8Encoding(false);
				case EncodingKind.Sjis:
					return Encoding.GetEncoding(932);
				case EncodingKind.Utf16Le:
					return new UnicodeEncoding(false, false);
				case EncodingKind.Utf16Be:
					return new UnicodeEncoding(true, false);
				default:
					throw new ArgumentOutOfRangeException("kind");
			}
		}

		/// <summary>表現できない文字があれば例外を投げる Encoding。</summary>
		private static Encoding GetStrict(EncodingKind kind)
		{
			EncoderFallback ef = EncoderFallback.ExceptionFallback;
			DecoderFallback df = DecoderFallback.ExceptionFallback;

			switch (kind)
			{
				case EncodingKind.Utf8:
				case EncodingKind.Utf8Bom:
					return Encoding.GetEncoding("utf-8", ef, df);
				case EncodingKind.Sjis:
					return Encoding.GetEncoding(932, ef, df);
				case EncodingKind.Utf16Le:
					return Encoding.GetEncoding("utf-16", ef, df);
				case EncodingKind.Utf16Be:
					return Encoding.GetEncoding("unicodeFFFE", ef, df);
				default:
					throw new ArgumentOutOfRangeException("kind");
			}
		}

		public static byte[] GetPreamble(EncodingKind kind)
		{
			switch (kind)
			{
				case EncodingKind.Utf8Bom: return Utf8Preamble;
				case EncodingKind.Utf16Le: return Utf16LePreamble;
				case EncodingKind.Utf16Be: return Utf16BePreamble;
				default: return NoPreamble;
			}
		}

		/// <summary>
		/// バイト列を文字列にする。先頭に BOM があれば取り除く。
		/// utf8 指定でも BOM 付きのファイルを読めるようにしている。
		/// </summary>
		public static string Decode(byte[] bytes, EncodingKind kind)
		{
			int offset = 0;

			if (kind == EncodingKind.Utf8 || kind == EncodingKind.Utf8Bom)
			{
				if (StartsWith(bytes, Utf8Preamble)) { offset = Utf8Preamble.Length; }
			}
			else if (kind == EncodingKind.Utf16Le)
			{
				if (StartsWith(bytes, Utf16LePreamble)) { offset = Utf16LePreamble.Length; }
			}
			else if (kind == EncodingKind.Utf16Be)
			{
				if (StartsWith(bytes, Utf16BePreamble)) { offset = Utf16BePreamble.Length; }
			}

			return GetRaw(kind).GetString(bytes, offset, bytes.Length - offset);
		}

		/// <summary>文字列をバイト列にする。必要なら BOM を先頭に付ける。</summary>
		public static byte[] Encode(string text, EncodingKind kind)
		{
			byte[] body = GetRaw(kind).GetBytes(text);
			byte[] pre = GetPreamble(kind);
			if (pre.Length == 0) { return body; }

			byte[] result = new byte[pre.Length + body.Length];
			Buffer.BlockCopy(pre, 0, result, 0, pre.Length);
			Buffer.BlockCopy(body, 0, result, pre.Length, body.Length);
			return result;
		}

		/// <summary>
		/// 変換先で表現できない文字を 1 つ探す。見つかれば true。
		/// 例外は最初の 1 文字で止まるため、直して再実行すると次が出る。
		///
		/// 絵文字などサロゲートペアの文字は CharUnknown に入らず、
		/// CharUnknownHigh と CharUnknownLow に分かれて渡される。
		/// </summary>
		public static bool TryFindUnmappable(string text, EncodingKind kind,
			out string ch, out int codePoint, out int index)
		{
			ch = null;
			codePoint = 0;
			index = -1;

			try
			{
				GetStrict(kind).GetBytes(text);
				return false;
			}
			catch (EncoderFallbackException ex)
			{
				index = ex.Index;

				if (ex.CharUnknownHigh != '\0')
				{
					codePoint = char.ConvertToUtf32(ex.CharUnknownHigh, ex.CharUnknownLow);
					ch = new string(new char[] { ex.CharUnknownHigh, ex.CharUnknownLow });
				}
				else
				{
					codePoint = ex.CharUnknown;
					ch = ex.CharUnknown.ToString();
				}
				return true;
			}
		}

		/// <summary>
		/// 改行を揃える。いったんすべて LF に落としてから目的の改行にする。
		/// CR 単独（旧 Mac 形式）もこの順で拾える。
		/// </summary>
		public static string NormalizeEol(string text, EolKind eol)
		{
			string s = text.Replace("\r\n", "\n").Replace("\r", "\n");
			if (eol == EolKind.CrLf) { s = s.Replace("\n", "\r\n"); }
			return s;
		}

		/// <summary>
		/// バイト列のまま改行を揃える。UTF-8 と SJIS でだけ使う。
		/// この 2 つは 0x0A / 0x0D が文字の途中に現れない（SJIS の 2 バイト目は
		/// 0x40 以上、UTF-8 の続きバイトは 0x80 以上）ため、バイトを見て
		/// 置き換えても文字を壊さない。デコードを通さないので、CP932 の
		/// 重複文字が別のバイト列に化けることも起きない。
		/// </summary>
		public static byte[] NormalizeEolBytes(byte[] src, EolKind eol)
		{
			List<byte> outBytes = new List<byte>(src.Length);
			bool crlf = (eol == EolKind.CrLf);

			int i = 0;
			while (i < src.Length)
			{
				byte b = src[i];
				if (b == 0x0D)
				{
					// CR または CRLF。次が LF ならまとめて 1 つの改行として扱う
					if (i + 1 < src.Length && src[i + 1] == 0x0A) { i++; }
					i++;
					if (crlf) { outBytes.Add(0x0D); outBytes.Add(0x0A); } else { outBytes.Add(0x0A); }
				}
				else if (b == 0x0A)
				{
					i++;
					if (crlf) { outBytes.Add(0x0D); outBytes.Add(0x0A); } else { outBytes.Add(0x0A); }
				}
				else
				{
					outBytes.Add(b);
					i++;
				}
			}
			return outBytes.ToArray();
		}

		/// <summary>改行の数を数える。表示と判定に使う。</summary>
		public static void CountEol(string text, out int crlf, out int lf, out int cr)
		{
			crlf = 0;
			lf = 0;
			cr = 0;

			for (int i = 0; i < text.Length; i++)
			{
				char c = text[i];
				if (c == '\r')
				{
					if (i + 1 < text.Length && text[i + 1] == '\n') { crlf++; i++; }
					else { cr++; }
				}
				else if (c == '\n')
				{
					lf++;
				}
			}
		}

		/// <summary>改行の状態を 1 語で表す。</summary>
		public static string DescribeEol(int crlf, int lf, int cr)
		{
			int kinds = 0;
			if (crlf > 0) { kinds++; }
			if (lf > 0) { kinds++; }
			if (cr > 0) { kinds++; }

			if (kinds == 0) { return "改行なし"; }
			if (kinds > 1) { return "混在"; }
			if (crlf > 0) { return "CRLF"; }
			if (lf > 0) { return "LF"; }
			return "CR";
		}

		public static int GetLineNumber(string text, int index)
		{
			int line = 1;
			int last = Math.Min(index, text.Length);
			for (int i = 0; i < last; i++)
			{
				if (text[i] == '\n') { line++; }
			}
			return line;
		}

		public static bool SameBytes(byte[] a, byte[] b)
		{
			if (a.Length != b.Length) { return false; }
			for (int i = 0; i < a.Length; i++)
			{
				if (a[i] != b[i]) { return false; }
			}
			return true;
		}

		private static bool StartsWith(byte[] bytes, byte[] prefix)
		{
			if (bytes.Length < prefix.Length) { return false; }
			for (int i = 0; i < prefix.Length; i++)
			{
				if (bytes[i] != prefix[i]) { return false; }
			}
			return true;
		}
	}
}
