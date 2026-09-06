namespace ConvertEncoding
{
	/// <summary>
	/// バイト列から文字コードを判定する。
	/// </summary>
	internal static class Detector
	{
		/// <summary>
		/// 判定の順序は BOM → UTF-8 → SJIS。
		/// どれにも当たらなければ false を返し、呼び出し側は何も書き換えずに終える。
		/// </summary>
		public static bool TryDetect(byte[] bytes, out EncodingKind kind)
		{
			kind = EncodingKind.Utf8;

			if (StartsWith(bytes, 0xEF, 0xBB, 0xBF)) { kind = EncodingKind.Utf8Bom; return true; }
			if (StartsWith(bytes, 0xFF, 0xFE)) { kind = EncodingKind.Utf16Le; return true; }
			if (StartsWith(bytes, 0xFE, 0xFF)) { kind = EncodingKind.Utf16Be; return true; }

			// 純 ASCII はここで UTF-8 と判定される。SJIS として解釈しても
			// 変換結果のバイト列は同じになるため、実害は無い
			if (IsValidUtf8(bytes)) { kind = EncodingKind.Utf8; return true; }
			if (IsValidSjis(bytes)) { kind = EncodingKind.Sjis; return true; }

			return false;
		}

		private static bool StartsWith(byte[] bytes, params byte[] prefix)
		{
			if (bytes.Length < prefix.Length) { return false; }
			for (int i = 0; i < prefix.Length; i++)
			{
				if (bytes[i] != prefix[i]) { return false; }
			}
			return true;
		}

		/// <summary>
		/// UTF-8 の並びとして成立するか。
		/// 過剰な長さの符号化（overlong）とサロゲート域は不正として弾く。
		/// ここを通すと SJIS のファイルが UTF-8 と誤判定される場面が増える。
		/// </summary>
		public static bool IsValidUtf8(byte[] b)
		{
			int i = 0;
			while (i < b.Length)
			{
				byte c = b[i];
				if (c <= 0x7F) { i++; continue; }

				int len;
				int min;
				if (c >= 0xC2 && c <= 0xDF) { len = 2; min = 0x80; }
				else if (c >= 0xE0 && c <= 0xEF) { len = 3; min = 0x800; }
				else if (c >= 0xF0 && c <= 0xF4) { len = 4; min = 0x10000; }
				else { return false; }   // 0xC0 0xC1 0xF5〜0xFF は UTF-8 に現れない

				if (i + len > b.Length) { return false; }

				int cp = c & (0xFF >> (len + 1));
				for (int k = 1; k < len; k++)
				{
					byte cc = b[i + k];
					if (cc < 0x80 || cc > 0xBF) { return false; }
					cp = (cp << 6) | (cc & 0x3F);
				}

				if (cp < min) { return false; }                       // overlong
				if (cp > 0x10FFFF) { return false; }
				if (cp >= 0xD800 && cp <= 0xDFFF) { return false; }   // サロゲート

				i += len;
			}
			return true;
		}

		/// <summary>
		/// CP932 の並びとして成立するか。
		/// </summary>
		public static bool IsValidSjis(byte[] b)
		{
			int i = 0;
			while (i < b.Length)
			{
				byte c = b[i];
				if (c <= 0x7F) { i++; continue; }
				if (c >= 0xA1 && c <= 0xDF) { i++; continue; }   // 半角カナ

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
}
