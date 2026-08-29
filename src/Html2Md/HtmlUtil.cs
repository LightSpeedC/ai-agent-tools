using System;
using System.Collections.Generic;
using System.Globalization;
using System.Text.RegularExpressions;

namespace Html2Md
{
	/// <summary>
	/// HTML の文字列を扱う共通処理。
	/// 正規表現だけで解析するため、対象は自分たちで書いた整形済みの HTML に限る。
	/// </summary>
	internal static class HtmlUtil
	{
		/// <summary>実体参照を文字に戻す。&amp;amp; は他を壊さないよう最後に処理する。</summary>
		public static string DecodeEntities(string text)
		{
			if (string.IsNullOrEmpty(text)) return "";
			string t = text;
			t = t.Replace("&nbsp;", " ");
			t = t.Replace("&lt;", "<");
			t = t.Replace("&gt;", ">");
			t = t.Replace("&quot;", "\"");
			t = t.Replace("&apos;", "'");
			t = t.Replace("&laquo;", "«");
			t = t.Replace("&raquo;", "»");
			t = t.Replace("&mdash;", "—");
			t = t.Replace("&ndash;", "–");
			t = t.Replace("&hellip;", "…");
			t = t.Replace("&times;", "×");
			t = t.Replace("&rarr;", "→");
			t = t.Replace("&larr;", "←");
			t = t.Replace("&copy;", "©");
			t = Regex.Replace(t, "&#(\\d+);", m =>
			{
				int code;
				if (!int.TryParse(m.Groups[1].Value, out code)) return m.Value;
				return char.ConvertFromUtf32(code);
			});
			t = Regex.Replace(t, "&#x([0-9a-fA-F]+);", m =>
			{
				int code;
				if (!int.TryParse(m.Groups[1].Value, NumberStyles.HexNumber, CultureInfo.InvariantCulture, out code)) return m.Value;
				return char.ConvertFromUtf32(code);
			});
			t = t.Replace("&amp;", "&");
			return t;
		}

		/// <summary>開きタグの class 属性を空白で分割して返す。</summary>
		public static string[] GetClassList(string openTag)
		{
			if (string.IsNullOrEmpty(openTag)) return new string[0];
			Match m = Regex.Match(openTag, "^<[^>]*?\\sclass=\"([^\"]*)\"");
			if (!m.Success) return new string[0];
			return m.Groups[1].Value.Split(new char[] { ' ', '\t', '\r', '\n' }, StringSplitOptions.RemoveEmptyEntries);
		}

		public static bool HasClass(string[] classes, string name)
		{
			foreach (string c in classes)
			{
				if (string.Equals(c, name, StringComparison.Ordinal)) return true;
			}
			return false;
		}

		/// <summary>開きタグから属性値を取り出す。見つからなければ空文字。</summary>
		public static string GetAttr(string openTag, string name)
		{
			if (string.IsNullOrEmpty(openTag)) return "";
			Match m = Regex.Match(openTag, "\\s" + Regex.Escape(name) + "=\"([^\"]*)\"");
			if (!m.Success) return "";
			return m.Groups[1].Value;
		}

		/// <summary>タグと実体参照を落として素のテキストにする（アンカー計算・突き合わせ用）。</summary>
		public static string GetPlainText(string html)
		{
			if (string.IsNullOrEmpty(html)) return "";
			string t = Regex.Replace(html, "<[^>]+>", " ");
			t = DecodeEntities(t);
			t = Regex.Replace(t, "\\s+", " ");
			return t.Trim();
		}

		/// <summary>
		/// GitHub の見出しアンカーを見出しテキストから求める。
		/// 小文字化 → 記号を落とす → 空白 1 文字をハイフン 1 個にする。
		/// </summary>
		public static string GetAnchor(string heading)
		{
			if (string.IsNullOrEmpty(heading)) return "";
			string a = heading.Trim().ToLowerInvariant();
			a = Regex.Replace(a, "[^\\p{L}\\p{N}\\p{M}\\s_-]", "");
			a = Regex.Replace(a.Trim(), "\\s", "-");
			return a;
		}

		/// <summary>リンク先の拡張子を .md に差し替える。アンカーとクエリは保つ。</summary>
		public static string ConvertLinkTarget(string href)
		{
			if (string.IsNullOrEmpty(href)) return "";
			if (Regex.IsMatch(href, "^(https?:|mailto:|tel:|#)")) return href;
			return Regex.Replace(href, "\\.html(?=$|[#?])", ".md");
		}

		/// <summary>
		/// start 位置から始まるタグの、対応する閉じタグまでを丸ごと返す（同名タグの入れ子に対応）。
		/// タグ名の直後の文字を確かめるので、&lt;p&gt; が &lt;pre&gt; に一致することはない。
		/// </summary>
		public static string GetTagBlock(string html, int start, string tag)
		{
			string open = "<" + tag;
			string close = "</" + tag + ">";
			int depth = 0;
			int i = start;
			while (i < html.Length)
			{
				int no = html.IndexOf(open, i, StringComparison.OrdinalIgnoreCase);
				int nc = html.IndexOf(close, i, StringComparison.OrdinalIgnoreCase);
				if (nc < 0) return html.Substring(start);
				if (no >= 0 && no < nc)
				{
					char after = (no + open.Length < html.Length) ? html[no + open.Length] : ' ';
					if (after == '>' || after == '/' || char.IsWhiteSpace(after)) depth++;
					i = no + open.Length;
					continue;
				}
				depth--;
				i = nc + close.Length;
				if (depth <= 0) return html.Substring(start, i - start);
			}
			return html.Substring(start);
		}

		/// <summary>ブロックの中身（開きタグと閉じタグの間）を返す。</summary>
		public static string GetInnerHtml(string block, string tag)
		{
			int i = block.IndexOf('>');
			int j = block.LastIndexOf("</" + tag + ">", StringComparison.OrdinalIgnoreCase);
			if (i < 0 || j < 0 || j <= i) return "";
			return block.Substring(i + 1, j - i - 1);
		}

		/// <summary>ブロックの先頭の開きタグを返す。</summary>
		public static string GetOpenTag(string block)
		{
			int i = block.IndexOf('>');
			if (i < 0) return block;
			return block.Substring(0, i + 1);
		}

		/// <summary>相対リンクを絶対パスに直す。外部リンク・アンカーだけの場合は null。</summary>
		public static string ResolveLink(string baseDir, string href)
		{
			if (string.IsNullOrEmpty(href)) return null;
			if (Regex.IsMatch(href, "^(https?:|mailto:|tel:)")) return null;
			if (href.StartsWith("#")) return null;
			string target = href.Split('#')[0];
			if (target.Length == 0) return null;
			target = target.Replace('/', '\\');
			try
			{
				return System.IO.Path.GetFullPath(System.IO.Path.Combine(baseDir, target));
			}
			catch (Exception)
			{
				return null;
			}
		}

		/// <summary>コメント・style・script・head を落とす。</summary>
		public static string StripNonContent(string html)
		{
			string t = Regex.Replace(html, "(?s)<!--.*?-->", "");
			t = Regex.Replace(t, "(?s)<style\\b[^>]*>.*?</style>", "");
			t = Regex.Replace(t, "(?s)<script\\b[^>]*>.*?</script>", "");
			t = Regex.Replace(t, "(?s)<head\\b[^>]*>.*?</head>", "");
			return t;
		}

		/// <summary>body の中身を取り出す。body が無ければ全体を返す。</summary>
		public static string ExtractBody(string html)
		{
			int bs = html.IndexOf("<body", StringComparison.OrdinalIgnoreCase);
			if (bs < 0) return html;
			bs = html.IndexOf('>', bs) + 1;
			int be = html.IndexOf("</body>", StringComparison.OrdinalIgnoreCase);
			if (be < 0) be = html.Length;
			return html.Substring(bs, be - bs);
		}
	}
}
