using System;
using System.Collections.Generic;
using System.Globalization;
using System.Text;

namespace TextTool
{
	/// <summary>文字コードの種類。</summary>
	internal enum EncKind
	{
		Utf8,
		Utf8Bom,
		Sjis,
		Utf16Le,
		Utf16Be
	}

	/// <summary>改行の種類。</summary>
	internal enum EolKind
	{
		Lf,
		CrLf,
		Cr,
		None
	}

	/// <summary>組（文字コード＋改行）と、判定が曖昧だったか。</summary>
	internal sealed class Combo
	{
		public EncKind Enc;
		public EolKind Eol;
		public bool Ambiguous;   // UTF-8 と SJIS の両方で妥当（非 ASCII）

		public string Name()
		{
			return Names.Enc(Enc) + "/" + Names.Eol(Eol);
		}
	}

	/// <summary>名前（すべて小文字）と、--from / --to の解釈。</summary>
	internal static class Names
	{
		public static string Enc(EncKind k)
		{
			switch (k)
			{
				case EncKind.Utf8: return "utf8";
				case EncKind.Utf8Bom: return "utf8bom";
				case EncKind.Sjis: return "sjis";
				case EncKind.Utf16Le: return "utf16le";
				case EncKind.Utf16Be: return "utf16be";
				default: return "?";
			}
		}

		public static string Eol(EolKind k)
		{
			switch (k)
			{
				case EolKind.CrLf: return "crlf";
				case EolKind.Lf: return "lf";
				case EolKind.Cr: return "cr";
				default: return "none";
			}
		}

		private static readonly Dictionary<string, EncKind> EncMap =
			new Dictionary<string, EncKind>(StringComparer.OrdinalIgnoreCase)
			{
				{ "utf8", EncKind.Utf8 },
				{ "utf8bom", EncKind.Utf8Bom },
				{ "sjis", EncKind.Sjis },
				{ "utf16le", EncKind.Utf16Le },
				{ "utf16be", EncKind.Utf16Be }
			};

		// 用途名（convert-encoding と同じ語彙）。--to で組が決まる。
		private static readonly Dictionary<string, EncKind> ProfileEnc =
			new Dictionary<string, EncKind>(StringComparer.OrdinalIgnoreCase)
			{
				{ "cmd", EncKind.Sjis }, { "bat", EncKind.Sjis },
				{ "ps1", EncKind.Utf8Bom }, { "html", EncKind.Utf8Bom },
				{ "reg", EncKind.Utf16Le }, { "utf8", EncKind.Utf8 }
			};

		private static readonly Dictionary<string, EolKind> ProfileEol =
			new Dictionary<string, EolKind>(StringComparer.OrdinalIgnoreCase)
			{
				{ "cmd", EolKind.CrLf }, { "bat", EolKind.CrLf },
				{ "ps1", EolKind.CrLf }, { "html", EolKind.Lf },
				{ "reg", EolKind.CrLf }, { "utf8", EolKind.Lf }
			};

		/// <summary>--from &lt;組&gt;。文字コードだけを受ける。</summary>
		public static bool TryFrom(string text, out EncKind kind, out string error)
		{
			kind = EncKind.Utf8;
			error = null;
			if (string.IsNullOrEmpty(text)) { error = "--from に値がありません。"; return false; }
			if (EncMap.TryGetValue(text, out kind)) { return true; }
			error = "--from に指定できない名前です: " + text
				+ " ／ 使える名前: utf8 utf8bom sjis utf16le utf16be";
			return false;
		}

		/// <summary>--to &lt;用途&gt;。用途名から組（enc＋eol）を決める。</summary>
		public static bool TryTo(string text, out EncKind enc, out EolKind eol, out string error)
		{
			enc = EncKind.Utf8; eol = EolKind.Lf; error = null;
			if (string.IsNullOrEmpty(text)) { error = "--to に値がありません。"; return false; }
			if (ProfileEnc.TryGetValue(text, out enc)) { eol = ProfileEol[text]; return true; }
			error = "--to に指定できない用途名です: " + text
				+ " ／ 使える用途名: cmd bat ps1 html reg utf8";
			return false;
		}
	}

	/// <summary>バイト列から組を判定する。</summary>
	internal static class Detector
	{
		/// <summary>
		/// BOM → UTF-8 厳密妥当 → SJIS の順で決める。
		/// UTF-8 と SJIS の両方で妥当かつ非 ASCII のときは Ambiguous を立てる
		/// （read/find は UTF-8 に倒し、edit/write は拒否する）。
		/// </summary>
		public static Combo Detect(byte[] b)
		{
			Combo c = new Combo();

			if (StartsWith(b, 0xEF, 0xBB, 0xBF)) { c.Enc = EncKind.Utf8Bom; }
			else if (StartsWith(b, 0xFF, 0xFE)) { c.Enc = EncKind.Utf16Le; }
			else if (StartsWith(b, 0xFE, 0xFF)) { c.Enc = EncKind.Utf16Be; }
			else
			{
				bool u8 = IsValidUtf8(b);
				bool sj = IsValidSjis(b);
				if (u8 && sj)
				{
					c.Enc = EncKind.Utf8;
					if (!IsAscii(b)) { c.Ambiguous = true; }
				}
				else if (u8) { c.Enc = EncKind.Utf8; }
				else if (sj) { c.Enc = EncKind.Sjis; }
				else { c.Enc = EncKind.Sjis; }   // どちらでもない。生バイトを保つ
			}

			c.Eol = EolOf(b, c.Enc);
			return c;
		}

		/// <summary>UTF-16 でないのに NUL を含めばバイナリとみなす。</summary>
		public static bool LooksBinary(byte[] b, EncKind enc)
		{
			if (enc == EncKind.Utf16Le || enc == EncKind.Utf16Be) { return false; }
			for (int i = 0; i < b.Length; i++) { if (b[i] == 0x00) { return true; } }
			return false;
		}

		/// <summary>改行はデコード後の文字で見る（UTF-16 はバイトでは正しく数えられない）。</summary>
		public static EolKind EolOf(byte[] b, EncKind enc)
		{
			string s = Codec.Decode(b, enc);
			bool crlf = false, lf = false, cr = false;
			for (int i = 0; i < s.Length; i++)
			{
				if (s[i] == '\r')
				{
					if (i + 1 < s.Length && s[i + 1] == '\n') { crlf = true; i++; }
					else { cr = true; }
				}
				else if (s[i] == '\n') { lf = true; }
			}
			if (crlf) { return EolKind.CrLf; }
			if (lf) { return EolKind.Lf; }
			if (cr) { return EolKind.Cr; }
			return EolKind.None;
		}

		private static bool IsAscii(byte[] b)
		{
			for (int i = 0; i < b.Length; i++) { if (b[i] > 0x7F) { return false; } }
			return true;
		}

		private static bool StartsWith(byte[] b, params byte[] pre)
		{
			if (b.Length < pre.Length) { return false; }
			for (int i = 0; i < pre.Length; i++) { if (b[i] != pre[i]) { return false; } }
			return true;
		}

		public static bool IsValidUtf8(byte[] b)
		{
			int i = 0;
			while (i < b.Length)
			{
				byte c = b[i];
				if (c <= 0x7F) { i++; continue; }
				int len, min;
				if (c >= 0xC2 && c <= 0xDF) { len = 2; min = 0x80; }
				else if (c >= 0xE0 && c <= 0xEF) { len = 3; min = 0x800; }
				else if (c >= 0xF0 && c <= 0xF4) { len = 4; min = 0x10000; }
				else { return false; }
				if (i + len > b.Length) { return false; }
				int cp = c & (0xFF >> (len + 1));
				for (int k = 1; k < len; k++)
				{
					byte cc = b[i + k];
					if (cc < 0x80 || cc > 0xBF) { return false; }
					cp = (cp << 6) | (cc & 0x3F);
				}
				if (cp < min) { return false; }
				if (cp > 0x10FFFF) { return false; }
				if (cp >= 0xD800 && cp <= 0xDFFF) { return false; }
				i += len;
			}
			return true;
		}

		public static bool IsValidSjis(byte[] b)
		{
			int i = 0;
			while (i < b.Length)
			{
				byte c = b[i];
				if (c <= 0x7F) { i++; continue; }
				if (c >= 0xA1 && c <= 0xDF) { i++; continue; }
				if ((c >= 0x81 && c <= 0x9F) || (c >= 0xE0 && c <= 0xFC))
				{
					if (i + 1 >= b.Length) { return false; }
					byte d = b[i + 1];
					if (d < 0x40 || d > 0xFC || d == 0x7F) { return false; }
					i += 2;
					continue;
				}
				return false;
			}
			return true;
		}
	}

	/// <summary>デコード・エンコード。BOM の付け外しを扱う。</summary>
	internal static class Codec
	{
		private static readonly byte[] Utf8Pre = new byte[] { 0xEF, 0xBB, 0xBF };
		private static readonly byte[] Utf16LePre = new byte[] { 0xFF, 0xFE };
		private static readonly byte[] Utf16BePre = new byte[] { 0xFE, 0xFF };
		private static readonly byte[] NoPre = new byte[0];

		private static Encoding Raw(EncKind k)
		{
			switch (k)
			{
				case EncKind.Utf8:
				case EncKind.Utf8Bom: return new UTF8Encoding(false);
				case EncKind.Sjis: return Encoding.GetEncoding(932);
				case EncKind.Utf16Le: return new UnicodeEncoding(false, false);
				case EncKind.Utf16Be: return new UnicodeEncoding(true, false);
				default: throw new ArgumentOutOfRangeException("k");
			}
		}

		public static byte[] Preamble(EncKind k)
		{
			switch (k)
			{
				case EncKind.Utf8Bom: return Utf8Pre;
				case EncKind.Utf16Le: return Utf16LePre;
				case EncKind.Utf16Be: return Utf16BePre;
				default: return NoPre;
			}
		}

		public static string Decode(byte[] b, EncKind k)
		{
			int off = 0;
			byte[] pre = Preamble(k == EncKind.Utf8 ? EncKind.Utf8Bom : k);
			if (k == EncKind.Utf8 || k == EncKind.Utf8Bom) { pre = Utf8Pre; }
			if (StartsWith(b, pre) && pre.Length > 0) { off = pre.Length; }
			return Raw(k).GetString(b, off, b.Length - off);
		}

		/// <summary>文字列をバイト列に。BOM は付けない（呼び出し側の splice 用）。</summary>
		public static byte[] EncodeRaw(string s, EncKind k)
		{
			return Raw(k).GetBytes(s);
		}

		/// <summary>表現できない文字があれば例外を投げる Encoding。</summary>
		private static Encoding Strict(EncKind k)
		{
			EncoderFallback ef = EncoderFallback.ExceptionFallback;
			DecoderFallback df = DecoderFallback.ExceptionFallback;
			switch (k)
			{
				case EncKind.Utf8:
				case EncKind.Utf8Bom: return Encoding.GetEncoding("utf-8", ef, df);
				case EncKind.Sjis: return Encoding.GetEncoding(932, ef, df);
				case EncKind.Utf16Le: return Encoding.GetEncoding("utf-16", ef, df);
				case EncKind.Utf16Be: return Encoding.GetEncoding("unicodeFFFE", ef, df);
				default: throw new ArgumentOutOfRangeException("k");
			}
		}

		/// <summary>
		/// 変換先で表現できない文字を 1 つ探す。見つかれば true。
		/// 絵文字などサロゲートペアは CharUnknownHigh / Low に分かれて渡される。
		/// </summary>
		public static bool TryFindUnmappable(string text, EncKind kind, out string ch, out int codePoint)
		{
			ch = null; codePoint = 0;
			try
			{
				Strict(kind).GetBytes(text);
				return false;
			}
			catch (EncoderFallbackException e)
			{
				if (e.CharUnknownHigh != '\0')
				{
					codePoint = char.ConvertToUtf32(e.CharUnknownHigh, e.CharUnknownLow);
					ch = char.ConvertFromUtf32(codePoint);
				}
				else
				{
					codePoint = e.CharUnknown;
					ch = e.CharUnknown.ToString();
				}
				return true;
			}
		}

		/// <summary>プリアンブル込みでエンコード（全書き用）。</summary>
		public static byte[] EncodeFull(string s, EncKind k)
		{
			byte[] body = Raw(k).GetBytes(s);
			byte[] pre = Preamble(k);
			if (pre.Length == 0) { return body; }
			byte[] r = new byte[pre.Length + body.Length];
			Buffer.BlockCopy(pre, 0, r, 0, pre.Length);
			Buffer.BlockCopy(body, 0, r, pre.Length, body.Length);
			return r;
		}

		/// <summary>先頭にプリアンブルがあれば、その長さ（無ければ 0）。</summary>
		public static int PreambleLen(byte[] b, EncKind k)
		{
			byte[] pre = Preamble(k);
			if (k == EncKind.Utf8) { pre = Utf8Pre; }
			return (pre.Length > 0 && StartsWith(b, pre)) ? pre.Length : 0;
		}

		private static bool StartsWith(byte[] b, byte[] pre)
		{
			if (pre.Length == 0 || b.Length < pre.Length) { return false; }
			for (int i = 0; i < pre.Length; i++) { if (b[i] != pre[i]) { return false; } }
			return true;
		}
	}

	/// <summary>合言葉（digest）＝ 行範囲ハッシュ ＋ サイズ ＋ 更新日時ミリ秒。</summary>
	internal static class Digest
	{
		/// <summary>更新日時の表記 yymmdd-hhmmss-ccc（ローカル時刻）。</summary>
		public static string Mtime(DateTime local)
		{
			return local.ToString("yyMMdd-HHmmss-fff", CultureInfo.InvariantCulture);
		}

		/// <summary>
		/// 範囲テキスト（改行を LF に正規化）＋ サイズ ＋ 更新日時 から 8 hex。
		/// 暗号強度は不要なので CRC32。1 対 1 の突き合わせなので 32 bit で足りる。
		/// </summary>
		public static string Compute(string rangeText, long size, string mtime)
		{
			string norm = rangeText.Replace("\r\n", "\n").Replace("\r", "\n");
			StringBuilder sb = new StringBuilder();
			sb.Append(norm).Append('\x1f').Append(size).Append('\x1f').Append(mtime);
			byte[] bytes = new UTF8Encoding(false).GetBytes(sb.ToString());
			uint crc = Crc32(bytes);
			return crc.ToString("x8", CultureInfo.InvariantCulture);
		}

		private static uint[] table;

		private static uint Crc32(byte[] data)
		{
			if (table == null)
			{
				table = new uint[256];
				for (uint n = 0; n < 256; n++)
				{
					uint c = n;
					for (int k = 0; k < 8; k++)
					{
						c = ((c & 1) != 0) ? (0xEDB88320u ^ (c >> 1)) : (c >> 1);
					}
					table[n] = c;
				}
			}
			uint crc = 0xFFFFFFFFu;
			for (int i = 0; i < data.Length; i++)
			{
				crc = table[(crc ^ data[i]) & 0xFF] ^ (crc >> 8);
			}
			return crc ^ 0xFFFFFFFFu;
		}
	}

	/// <summary>1 行の範囲（デコード後の文字インデックス）。</summary>
	internal struct Line
	{
		public int Start;        // 行頭
		public int ContentEnd;   // 改行の直前
		public int FullEnd;      // 次の行頭（改行を含む）
	}

	/// <summary>デコード済み文字列を行に割る。</summary>
	internal static class Lines
	{
		public static List<Line> Split(string s)
		{
			List<Line> list = new List<Line>();
			int start = 0;
			int i = 0;
			while (i < s.Length)
			{
				char ch = s[i];
				if (ch == '\n')
				{
					Line ln = new Line();
					ln.Start = start; ln.ContentEnd = i; ln.FullEnd = i + 1;
					list.Add(ln);
					i++; start = i;
				}
				else if (ch == '\r')
				{
					int nl = (i + 1 < s.Length && s[i + 1] == '\n') ? i + 2 : i + 1;
					Line ln = new Line();
					ln.Start = start; ln.ContentEnd = i; ln.FullEnd = nl;
					list.Add(ln);
					i = nl; start = i;
				}
				else { i++; }
			}
			// 末尾に改行が無い最後の行
			if (start < s.Length || list.Count == 0)
			{
				Line ln = new Line();
				ln.Start = start; ln.ContentEnd = s.Length; ln.FullEnd = s.Length;
				list.Add(ln);
			}
			return list;
		}

		/// <summary>行の内容（改行を除く）。</summary>
		public static string Content(string s, Line ln)
		{
			return s.Substring(ln.Start, ln.ContentEnd - ln.Start);
		}
	}
}
