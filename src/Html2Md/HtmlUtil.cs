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

		/// <summary>
		/// リンク先の拡張子を .md に差し替える。アンカーとクエリは保つ。
		///
		/// md-skip のページは Markdown が生成されないため、.md に置き換えると
		/// 存在しないファイルを指す。そのページへのリンクだけ .html のまま残す。
		/// </summary>
		public static string ConvertLinkTarget(string href, string baseDir, HashSet<string> mdSkipPages)
		{
			if (string.IsNullOrEmpty(href)) return "";
			if (Regex.IsMatch(href, "^(https?:|mailto:|tel:|#)")) return href;
			if (mdSkipPages != null && mdSkipPages.Count > 0 && !string.IsNullOrEmpty(baseDir))
			{
				string full = ResolveLink(baseDir, href);
				if (full != null && mdSkipPages.Contains(full)) return href;
			}
			return Regex.Replace(href, "\\.html(?=$|[#?])", ".md");
		}

		/// <summary>切り出したブロックと、その中身。</summary>
		public sealed class Block
		{
			/// <summary>開きタグから閉じタグまで（閉じタグが無ければ末尾まで）</summary>
			public string Outer;
			/// <summary>開きタグと閉じタグの間（閉じタグが無ければ開きタグより後ろ全部）</summary>
			public string Inner;
		}

		/// <summary>
		/// start 位置から始まるタグのブロックと中身を切り出す（同名タグの入れ子に対応）。
		/// タグ名の直後の文字を確かめるので、&lt;p&gt; が &lt;pre&gt; に一致することはない。
		///
		/// 中身の範囲はここで一緒に決める。ブロック全体を返して呼び出し側で
		/// 閉じタグを探し直すと、子要素の閉じタグを自分のものと取り違える。
		/// 閉じられていない要素（書き込み途中のログ HTML 等）では最後の子要素が失われていた。
		/// </summary>
		public static Block GetBlock(string html, int start, string tag)
		{
			string open = "<" + tag;
			string close = "</" + tag + ">";
			int contentStart = html.IndexOf('>', start);
			contentStart = (contentStart < 0) ? html.Length : contentStart + 1;

			int depth = 0;
			int i = start;
			while (i < html.Length)
			{
				int no = html.IndexOf(open, i, StringComparison.OrdinalIgnoreCase);
				int nc = html.IndexOf(close, i, StringComparison.OrdinalIgnoreCase);
				// 閉じタグが無い。末尾までをブロックとし、中身も末尾までとする
				if (nc < 0) return MakeBlock(html.Substring(start), html.Substring(contentStart));
				if (no >= 0 && no < nc)
				{
					char after = (no + open.Length < html.Length) ? html[no + open.Length] : ' ';
					if (after == '>' || after == '/' || char.IsWhiteSpace(after)) depth++;
					i = no + open.Length;
					continue;
				}
				depth--;
				i = nc + close.Length;
				if (depth <= 0)
				{
					// nc がこのブロックに対応する閉じタグ
					int len = nc - contentStart;
					string inner = (len > 0) ? html.Substring(contentStart, len) : "";
					return MakeBlock(html.Substring(start, i - start), inner);
				}
			}
			return MakeBlock(html.Substring(start), html.Substring(contentStart));
		}

		private static Block MakeBlock(string outer, string inner)
		{
			Block b = new Block();
			b.Outer = outer;
			b.Inner = inner;
			return b;
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

		/// <summary>
		/// ページ全体を Markdown に出さない指定があるか。
		/// &lt;meta name="md-skip"&gt; を head に置いたページは変換しない。
		///
		/// details / summary で畳んだ課題一覧のように、Markdown にすると
		/// 構造が失われる HTML がある。クラスの md-skip は要素単位なので、
		/// ページ単位の指定をこちらで受ける。
		/// </summary>
		public static bool IsMdSkipPage(string html)
		{
			return Regex.IsMatch(html, "<meta\\b[^>]*\\sname=\"md-skip\"", RegexOptions.IgnoreCase);
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
