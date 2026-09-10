using System;
using System.Collections.Generic;
using System.IO;
using System.Text;
using System.Text.RegularExpressions;

namespace Html2Md
{
	/// <summary>
	/// 生成した Markdown と元の HTML を機械的に検査する。
	///
	/// リンクとクラス名の検査は、コードブロックとコードスパンの中を除く。
	/// HTML の書き方を説明する文書では、pre や code の中にコード例としてリンクが現れる。
	/// タグを実体参照でエスケープしても属性の中身は生のままなので、素朴に拾うと
	/// 存在しないファイルへのリンクとして誤検出する。
	/// </summary>
	internal static class Checks
	{
		/// <summary>検査の対象から pre と code の中身を落とす。</summary>
		public static string StripCodeAreas(string html)
		{
			string t = Regex.Replace(html, "(?s)<pre\\b.*?</pre>", "");
			t = Regex.Replace(t, "(?s)<code\\b[^>]*>.*?</code>", "");
			return t;
		}

		/// <summary>
		/// Markdown 側のリンク切れとアンカー切れ。
		/// expected には、この実行で生成する（または生成するはずだった）ファイルの絶対パスを渡す。
		/// --dry-run では実際には書き出さないため、これを実在扱いにしないと全部リンク切れになる。
		/// </summary>
		/// <summary>Markdown の見出し行から、GitHub のアンカーの一覧を作る。</summary>
		private static List<string> GetHeadingAnchors(string markdown)
		{
			List<string> heads = new List<string>();
			foreach (Match m in Regex.Matches(markdown, "(?m)^#{1,6}\\s+(.+)$"))
			{
				string h = Regex.Replace(m.Groups[1].Value, "<[^>]+>", "");
				h = Regex.Replace(h, "[*`]", "");
				heads.Add(HtmlUtil.GetAnchor(h));
			}
			return heads;
		}

		/// <summary>
		/// markdownByPath は、この実行で変換した他ページの Markdown（絶対パス → 本文）。
		/// 他ファイルへのアンカー付きリンクは、そのページの見出しから実在を確かめる。
		/// --dry-run では書き出さないため、ディスクではなくメモリ上の内容を使う。
		/// この実行に含まれないページ（既存の .md）はディスクから読む。
		/// </summary>
		public static List<string> TestMdLinks(ConvertResult result, HashSet<string> expected,
			Dictionary<string, string> markdownByPath)
		{
			string dir = Path.GetDirectoryName(result.MdPath);
			string md = result.Markdown;

			List<string> heads = GetHeadingAnchors(md);

			List<string> bad = new List<string>();
			// フェンスとコードスパンの中は対象にしない。
			// 書き方を説明する文書では ![](images/xxx.svg) のような例がコードとして現れる
			string body = Regex.Replace(md, "(?s)```.*?```", "");
			body = Regex.Replace(body, "`[^`\r\n]*`", "");
			foreach (Match m in Regex.Matches(body, "!?\\[[^\\]]*\\]\\(([^)]+)\\)"))
			{
				string link = m.Groups[1].Value;
				if (Regex.IsMatch(link, "^(https?:|mailto:|tel:)")) continue;
				if (link.StartsWith("#", StringComparison.Ordinal))
				{
					if (!heads.Contains(link.Substring(1))) bad.Add("アンカー先なし: " + link);
					continue;
				}
				string full = HtmlUtil.ResolveLink(dir, link);
				if (full == null) continue;

				bool inExpected = expected != null && expected.Contains(full);
				if (!inExpected && !File.Exists(full) && !Directory.Exists(full))
				{
					bad.Add("リンク切れ: " + link);
					continue;
				}

				// 他ファイルへのアンカーも、リンク先の見出しから実在を確かめる
				int hashIdx = link.IndexOf('#');
				if (hashIdx >= 0 && string.Equals(Path.GetExtension(full), ".md", StringComparison.OrdinalIgnoreCase))
				{
					string anchor = link.Substring(hashIdx + 1);
					string targetMd;
					if (markdownByPath == null || !markdownByPath.TryGetValue(full, out targetMd))
					{
						targetMd = File.Exists(full) ? File.ReadAllText(full, Encoding.UTF8) : null;
					}
					if (targetMd != null && !GetHeadingAnchors(targetMd).Contains(anchor))
					{
						bad.Add("他ファイルのアンカー先なし: " + link);
					}
				}
			}
			return bad;
		}

		/// <summary>
		/// HTML 側のリンクが .md を指していないか、参照先が実在するか。
		/// Markdown 側だけを検査すると、変換で .md になった分と区別できず見逃す。
		/// </summary>
		public static List<string> TestHtmlLinks(string htmlPath)
		{
			string html = File.ReadAllText(htmlPath, Encoding.UTF8);
			html = Regex.Replace(html, "(?s)<!--.*?-->", "");
			html = StripCodeAreas(html);
			string dir = Path.GetDirectoryName(htmlPath);

			List<string> bad = new List<string>();
			foreach (Match m in Regex.Matches(html, "href=\"([^\"]+)\""))
			{
				string href = m.Groups[1].Value;
				if (Regex.IsMatch(href, "^(https?:|mailto:|tel:|#)")) continue;
				if (Regex.IsMatch(href, "\\.md($|[#?])"))
				{
					bad.Add(".md を参照: " + href + "（HTML には常に .html と書く）");
					continue;
				}
				string full = HtmlUtil.ResolveLink(dir, href);
				if (full == null) continue;
				if (!File.Exists(full) && !Directory.Exists(full)) bad.Add("リンク切れ: " + href);
			}
			return bad;
		}

		/// <summary>
		/// 比較用に記号を落とす。Markdown 側と HTML 側に同じ処理をかけること。
		/// 片方だけで落とすと、コード例に含まれる * や \ や &lt;strong&gt; が差分に見えて誤検出する。
		/// </summary>
		private static string Normalize(string s)
		{
			string t = s;
			// 記法そのものがコード例として本文に現れることがあるので、両側で同じ扱いにする。
			// 画像は元が SVG なら HTML の本文に対応が無いため、両側から落とす
			t = Regex.Replace(t, "!\\[[^\\]]*\\]\\([^)]*\\)", "");
			t = Regex.Replace(t, "\\[([^\\]]*)\\]\\([^)]*\\)", "$1");
			// タグのまま出すもの。属性を持つものがあるので開きタグは属性まで含めて落とす
			t = Regex.Replace(t, "</?(?:strong|em|br|del|ins|sup|sub|mark|kbd|abbr|small|q|cite|time|details|summary)\\b[^>]*>", "");
			t = t.Replace("\\|", "|");
			// 記法の記号（* ` | ~）とパス区切りの \ は、どちらの側に現れても落とす
			t = Regex.Replace(t, "[*`|~\\\\]", "");
			// 色分けの代替として認めた記号
			t = Regex.Replace(t, "[✅❌⚠⬜✖―]", "");
			t = t.Replace("️", "");   // 異体字セレクタ
			t = Regex.Replace(t, "\\s", "");
			return t;
		}

		/// <summary>Markdown の 1 行から、記法と色分けの代替記号を落として比較用の文字列にする。</summary>
		private static string CompareText(string line)
		{
			string s = line;
			s = Regex.Replace(s, "^\\s*>\\s*\\[!\\w+\\]\\s*$", "");
			s = Regex.Replace(s, "^\\s*>\\s?", "");
			s = Regex.Replace(s, "^\\s*#{1,6}\\s*", "");
			s = Regex.Replace(s, "^\\s*[-+]\\s+", "");
			s = Regex.Replace(s, "^\\s*\\d+\\.\\s+", "");
			return Normalize(s);
		}

		/// <summary>
		/// Markdown 側にしか存在しない文言が無いか。
		/// 変換は記法の置き換えだけを行い、文言は HTML と同一にする決まりのため、
		/// HTML の可視テキストに無い文字列が現れたら付け足しとみなす。
		/// </summary>
		public static List<string> TestExtraText(ConvertResult result)
		{
			string html = File.ReadAllText(result.HtmlPath, Encoding.UTF8);
			html = HtmlUtil.StripNonContent(html);

			// aria-label は属性なのでタグ除去で消える。画像の alt と突き合わせるため足す
			StringBuilder labels = new StringBuilder();
			foreach (Match m in Regex.Matches(html, "aria-label=\"([^\"]*)\""))
			{
				labels.Append(HtmlUtil.DecodeEntities(m.Groups[1].Value));
			}
			// data-columns も属性。chapters の表見出しはここにしか無い文言なので同じく足す
			// （カンマは Markdown 側の見出し行に出ないため、比較前に落としておく）
			foreach (Match m in Regex.Matches(html, "data-columns=\"([^\"]*)\""))
			{
				labels.Append(HtmlUtil.DecodeEntities(m.Groups[1].Value).Replace(",", ""));
			}
			string plain = Normalize(HtmlUtil.GetPlainText(html) + labels.ToString());

			List<string> extra = new List<string>();
			bool inFence = false;
			int lineNo = 0;
			foreach (string line in Regex.Split(result.Markdown, "\\r?\\n"))
			{
				lineNo++;
				// callout の中のコードフェンスは "> ```" の形になる。
				// 引用記号を外してから判定しないとフェンスの内外を取り違える
				string lineHead = Regex.Replace(line.TrimStart(), "^>\\s?", "").TrimStart();
				if (lineHead.StartsWith("```", StringComparison.Ordinal))
				{
					inFence = !inFence;
					continue;
				}
				if (inFence) continue;
				if (line.Trim().Length == 0) continue;
				// 表の区切り行は記法そのもの
				if (Regex.IsMatch(line, "^\\s*\\|?[\\s:|-]+\\|?\\s*$")) continue;

				string c = CompareText(line);
				// 章見出しに付けた連番は HTML に無いので落とす
				c = Regex.Replace(c, "^\\d+\\.", "");
				if (c.Length < 2) continue;
				if (!plain.Contains(c))
				{
					string head = line.Trim();
					if (head.Length > 90) head = head.Substring(0, 90) + "…";
					extra.Add(lineNo.ToString() + " 行目: " + head);
				}
			}
			return extra;
		}

		/// <summary>
		/// HTML の更新日が、ファイルの最終更新時刻より古くないか。
		/// 体裁だけの変更では更新日を変えない決まりのため、警告に留める。
		/// </summary>
		public static string TestUpdatedDate(string htmlPath)
		{
			string html = File.ReadAllText(htmlPath, Encoding.UTF8);
			Match m = Regex.Match(html, "作成:\\s*([\\d-]+)\\s*/\\s*更新:\\s*([\\d-]+)");
			if (!m.Success) return "作成日・更新日の記載が見つかりません";

			string written = m.Groups[2].Value;
			DateTime parsed;
			if (!DateTime.TryParseExact(written, "yyyy-MM-dd",
				System.Globalization.CultureInfo.InvariantCulture,
				System.Globalization.DateTimeStyles.None, out parsed))
			{
				return "更新日の書式が不正です: " + written;
			}

			DateTime mtime = File.GetLastWriteTime(htmlPath).Date;
			if (parsed < mtime)
			{
				return string.Format(
					"更新日が古い可能性: ヘッダ {0} / ファイル更新 {1}（体裁だけの変更ならこのままでよい）",
					written, mtime.ToString("yyyy-MM-dd"));
			}
			return "";
		}
	}
}
