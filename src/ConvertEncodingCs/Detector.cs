namespace ConvertEncoding
{
	/// <summary>
	/// バイト列から文字コードを判定する。
	/// </summary>
	internal static class Detector
	{
		/// <summary>
		/// BOM を見たあと、UTF-8 と SJIS の両方で検査してから決める。
		/// 片方だけ妥当ならそれに決める。両方妥当で非 ASCII を含むものは
		/// 読んだ文字の自然さで見分け（DecideAmbiguous）、それでも決まらなければ
		/// false を返し、呼び出し側は何も書き換えずに終える。
		///
		/// 先に UTF-8 を試して確定させると、半角カタカナ（例: C2 B1 は
		/// UTF-8 で「±」、SJIS で「ﾂｱ」）が UTF-8 と誤認され、SJIS の
		/// つもりで置いたファイルの文字が失われる。
		/// </summary>
		public static bool TryDetect(byte[] bytes, out EncodingKind kind)
		{
			kind = EncodingKind.Utf8;

			if (StartsWith(bytes, 0xEF, 0xBB, 0xBF)) { kind = EncodingKind.Utf8Bom; return true; }
			if (StartsWith(bytes, 0xFF, 0xFE)) { kind = EncodingKind.Utf16Le; return true; }
			if (StartsWith(bytes, 0xFE, 0xFF)) { kind = EncodingKind.Utf16Be; return true; }

			bool u8 = IsValidUtf8(bytes);
			bool sj = IsValidSjis(bytes);

			if (u8 && sj)
			{
				// 純 ASCII はどちらに解釈しても変換結果のバイト列が同じ。
				// UTF-8 で確定してよい。非 ASCII を含むなら読んだ文字の自然さで見分ける
				if (IsAscii(bytes)) { kind = EncodingKind.Utf8; return true; }
				int d = DecideAmbiguous(bytes);
				if (d == 1) { kind = EncodingKind.Utf8; return true; }
				if (d == 2) { kind = EncodingKind.Sjis; return true; }
				return false;
			}

			if (u8) { kind = EncodingKind.Utf8; return true; }
			if (sj) { kind = EncodingKind.Sjis; return true; }

			return false;
		}

		// ---- 両方で成立するときの見分け（i260929-01）。TypeScript 版（src/lib/detector.ts）と合わせる

		// JIS 第一水準の漢字（SJIS の先頭 88〜98）。初めて要るときに作る
		private static System.Collections.Generic.HashSet<char> level1;

		// 読めない組は U+FFFD にする（TypeScript の TextDecoder と揃える。既定の '?' だと ASCII として数えから漏れる）
		private static System.Text.Encoding Sjis()
		{
			return System.Text.Encoding.GetEncoding(932, System.Text.EncoderFallback.ReplacementFallback, new System.Text.DecoderReplacementFallback("�"));
		}

		private static System.Collections.Generic.HashSet<char> Level1Kanji()
		{
			if (level1 != null) { return level1; }
			System.Text.Encoding sjis = Sjis();
			var set = new System.Collections.Generic.HashSet<char>();
			byte[] pair = new byte[2];
			for (int a = 0x88; a <= 0x98; a++)
			{
				for (int t = 0x40; t <= 0xFC; t++)
				{
					if (t == 0x7F) { continue; }
					pair[0] = (byte)a; pair[1] = (byte)t;
					string ch = sjis.GetString(pair);
					if (ch.Length == 1 && ch[0] != '�') { set.Add(ch[0]); }
				}
			}
			level1 = set;
			return set;
		}

		/// <summary>よく使う文字か。UTF-8 で読んだ側にも SJIS で読んだ側にも同じ物差しを当てる</summary>
		private static bool IsCommonChar(char ch)
		{
			if (ch >= 'ぁ' && ch <= 'ゖ') { return true; }   // ひらがな
			if (ch >= 'ァ' && ch <= 'ー') { return true; }   // カタカナ・長音
			if (ch >= '　' && ch <= '〃') { return true; }   // 全角空白・、。〃
			if (ch >= '！' && ch <= '～') { return true; }   // 全角英数
			if (ch >= '｡' && ch <= 'ﾟ') { return true; }   // 半角カナ
			return Level1Kanji().Contains(ch);
		}

		/// <summary>非 ASCII の文字のうち、よく使う文字の割合。非 ASCII が無ければ 0</summary>
		private static double CommonRatio(string s)
		{
			int n = 0;
			int ok = 0;
			for (int i = 0; i < s.Length; i++)
			{
				char ch = s[i];
				if (ch < 0x80) { continue; }
				n++;
				// サロゲートペアは 1 文字と数え、よく使う文字には入れない
				if (char.IsHighSurrogate(ch) && i + 1 < s.Length && char.IsLowSurrogate(s[i + 1])) { i++; continue; }
				if (IsCommonChar(ch)) { ok++; }
			}
			return n == 0 ? 0 : (double)ok / n;
		}

		/// <summary>
		/// UTF-8 と SJIS の両方で成立し非 ASCII を含むバイト列を、読んだ文字の自然さで見分ける。
		/// 1 = UTF-8、2 = SJIS、0 = 決まらない。しきい値は計画書 i260929-01 の第 2 章
		/// </summary>
		private static int DecideAmbiguous(byte[] bytes)
		{
			double nu = CommonRatio(new System.Text.UTF8Encoding(false, false).GetString(bytes));
			double ns = CommonRatio(Sjis().GetString(bytes));
			if (nu >= 0.75 && nu > ns) { return 1; }
			if (ns >= 0.9 && nu <= 0.1) { return 2; }
			return 0;
		}

		private static bool IsAscii(byte[] b)
		{
			for (int i = 0; i < b.Length; i++)
			{
				if (b[i] > 0x7F) { return false; }
			}
			return true;
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
