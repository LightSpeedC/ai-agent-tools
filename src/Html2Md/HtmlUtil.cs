using System;
using System.Collections.Generic;
using System.Globalization;
using System.Text;
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
		/// 置き換えるのは、この実行で .md が生成されるページへのリンクだけ。
		/// 探索フォルダの外にある HTML や md-skip のページを .md で指すと、
		/// 存在しないファイルを指すことになる。
		/// </summary>
		public static string ConvertLinkTarget(string href, string baseDir, HashSet<string> convertedPages)
		{
			if (string.IsNullOrEmpty(href)) return "";
			if (Regex.IsMatch(href, "^(https?:|mailto:|tel:|#)")) return href;
			// 対象が分からないときは従来どおり全部置き換える（単体で呼ばれた場合）
			if (convertedPages == null || string.IsNullOrEmpty(baseDir))
			{
				return Regex.Replace(href, "\\.html(?=$|[#?])", ".md");
			}
			string full = ResolveLink(baseDir, href);
			if (full == null || !convertedPages.Contains(full)) return href;
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

		/// <summary>
		/// style から CSS 変数を読む。返すのは「セレクタの鍵 → 変数名 → 値」。
		/// :root は空文字の鍵で持ち、章のクラスは chNN の鍵で持つ。
		///
		/// SVG を単体ファイルに切り出すと var() が解決されず色が失われるため、
		/// 切り出すときに静的に埋める。@media の中と JS による上書きは対象外。
		/// </summary>
		public static Dictionary<string, Dictionary<string, string>> BuildCssVars(string html)
		{
			Dictionary<string, Dictionary<string, string>> map =
				new Dictionary<string, Dictionary<string, string>>(StringComparer.Ordinal);

			foreach (Match st in Regex.Matches(html, "(?s)<style\\b[^>]*>(.*?)</style>"))
			{
				string css = Regex.Replace(st.Groups[1].Value, "(?s)/\\*.*?\\*/", "");
				css = StripAtBlocks(css);
				foreach (Match rule in Regex.Matches(css, "([^{}]+)\\{([^{}]*)\\}"))
				{
					string decl = rule.Groups[2].Value;
					if (decl.IndexOf("--", StringComparison.Ordinal) < 0) continue;

					List<string> keys = new List<string>();
					foreach (string one in rule.Groups[1].Value.Split(','))
					{
						string sel = one.Trim();
						if (string.Equals(sel, ":root", StringComparison.Ordinal)) keys.Add("");
						else
						{
							Match c = Regex.Match(sel, "^\\.(ch\\d+)$");
							if (c.Success) keys.Add(c.Groups[1].Value);
						}
					}
					if (keys.Count == 0) continue;

					foreach (Match d in Regex.Matches(decl, "(--[\\w-]+)\\s*:\\s*([^;]+)"))
					{
						string name = d.Groups[1].Value;
						string val = d.Groups[2].Value.Trim();
						foreach (string key in keys)
						{
							if (!map.ContainsKey(key)) map[key] = new Dictionary<string, string>(StringComparer.Ordinal);
							map[key][name] = val;
						}
					}
				}
			}
			return map;
		}

		/// <summary>
		/// @media や @supports のブロックを中身ごと落とす。
		/// 入れ子があるため、括弧を数えて終端を決める。
		/// </summary>
		private static string StripAtBlocks(string css)
		{
			StringBuilder sb = new StringBuilder();
			int i = 0;
			while (true)
			{
				int at = css.IndexOf('@', i);
				if (at < 0) { sb.Append(css, i, css.Length - i); break; }
				int brace = css.IndexOf('{', at);
				if (brace < 0) { sb.Append(css, i, css.Length - i); break; }
				sb.Append(css, i, at - i);
				int depth = 0;
				int end = -1;
				for (int q = brace; q < css.Length; q++)
				{
					if (css[q] == '{') depth++;
					else if (css[q] == '}') { depth--; if (depth == 0) { end = q; break; } }
				}
				if (end < 0) break;
				i = end + 1;
			}
			return sb.ToString();
		}

		/// <summary>
		/// var(--x) と var(--x, 既定値) を実際の値に置き換える。
		/// 章のクラスの定義を先に見て、無ければ :root を見る。どちらにも無ければ
		/// 既定値、それも無ければ元の記述を残す。
		///
		/// 正規表現で括るとフォールバックに hsl(...) のような括弧が入ったときに
		/// 途中で切れるため、括弧を数えて取り出す。
		/// </summary>
		public static string ResolveCssVars(string s, Dictionary<string, Dictionary<string, string>> vars, string chapterClass)
		{
			if (vars == null || vars.Count == 0 || string.IsNullOrEmpty(s)) return s;
			if (s.IndexOf("var(", StringComparison.OrdinalIgnoreCase) < 0) return s;

			StringBuilder sb = new StringBuilder();
			int i = 0;
			while (true)
			{
				int p = s.IndexOf("var(", i, StringComparison.OrdinalIgnoreCase);
				if (p < 0) { sb.Append(s, i, s.Length - i); break; }
				sb.Append(s, i, p - i);

				int brace = p + 3;
				int depth = 0;
				int end = -1;
				for (int q = brace; q < s.Length; q++)
				{
					if (s[q] == '(') depth++;
					else if (s[q] == ')') { depth--; if (depth == 0) { end = q; break; } }
				}
				if (end < 0) { sb.Append(s, p, s.Length - p); break; }

				string inner = s.Substring(brace + 1, end - brace - 1);
				sb.Append(ResolveOneVar(inner, vars, chapterClass, s.Substring(p, end - p + 1)));
				i = end + 1;
			}
			return sb.ToString();
		}

		private static string ResolveOneVar(string inner, Dictionary<string, Dictionary<string, string>> vars,
			string chapterClass, string original)
		{
			int comma = inner.IndexOf(',');
			string name = ((comma < 0) ? inner : inner.Substring(0, comma)).Trim();
			string fallback = (comma < 0) ? "" : inner.Substring(comma + 1).Trim();

			string found = null;
			Dictionary<string, string> table;
			if (!string.IsNullOrEmpty(chapterClass) && vars.TryGetValue(chapterClass, out table))
			{
				table.TryGetValue(name, out found);
			}
			if (found == null && vars.TryGetValue("", out table))
			{
				table.TryGetValue(name, out found);
			}
			if (found != null) return ResolveCssVars(found, vars, chapterClass);
			if (fallback.Length > 0) return ResolveCssVars(fallback, vars, chapterClass);
			return original;
		}

		/// <summary>クラスの一覧から章のクラス（chNN）を返す。無ければ空文字。</summary>
		public static string FindChapterClass(string[] classes)
		{
			if (classes == null) return "";
			foreach (string c in classes)
			{
				if (Regex.IsMatch(c, "^ch\\d+$")) return c;
			}
			return "";
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
