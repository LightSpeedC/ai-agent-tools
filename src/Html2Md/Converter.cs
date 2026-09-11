using System;
using System.Collections.Generic;
using System.IO;
using System.Text;
using System.Text.RegularExpressions;

namespace Html2Md
{
	/// <summary>1 ファイルを変換する間だけ持ち回る状態。</summary>
	internal sealed class ConvertContext
	{
		public Dictionary<string, string> Anchors = new Dictionary<string, string>(StringComparer.Ordinal);
		public string ImagesDir = "";
		public string BasePrefix = "";
		public int FigIndex;
		public List<string> Images = new List<string>();
		public bool InTitlebar;
		public bool InSection;
		public bool HasMinibar;
		public int ChapterNo;
		public bool Write;
		/// <summary>style から読んだ CSS 変数。SVG の var() を解決するのに使う。</summary>
		public Dictionary<string, Dictionary<string, string>> CssVars;
		/// <summary>いま処理している章のクラス（chNN）。章の外では空文字。</summary>
		public string ChapterClass = "";
	}

	/// <summary>変換した結果。</summary>
	internal sealed class ConvertResult
	{
		public string HtmlPath;
		public string MdPath;
		public string Markdown;
		public List<string> Images = new List<string>();
	}

	/// <summary>HTML を Markdown にする。</summary>
	internal sealed class Converter
	{
		/// <summary>callout の追加クラス → GitHub アラートの種別。</summary>
		private static readonly Dictionary<string, string> CalloutKinds = new Dictionary<string, string>(StringComparer.Ordinal)
		{
			{ "callout-note", "NOTE" },
			{ "callout-tip", "TIP" },
			{ "callout-important", "IMPORTANT" },
			{ "callout-warning", "WARNING" },
			{ "callout-caution", "CAUTION" }
		};

		/// <summary>
		/// ブロックとして扱うタグ。ここに無いタグは走査で飛ばされ、中身が地の文になる。
		///
		/// dt・dd・summary を個別に挙げているのは、親（dl・details）だけを挙げると
		/// 中身がまとめて 1 段落になり、項目の境目が消えるため。
		/// </summary>
		private const string BlockTags =
			"<(section|figure|footer|blockquote|div|nav|table|main|article|aside|header|address"
			+ "|details|summary|dl|dt|dd|hr|h1|h2|h3|h4|h5|h6|p|ul|ol|pre|svg|a)\\b";

		private readonly InlineConverter inline = new InlineConverter();
		private readonly ListTableConverter listTable;

		/// <summary>この実行で .md が生成されるページ（絶対パス）。ここへのリンクだけ .md にする。</summary>
		public HashSet<string> ConvertedPages;

		/// <summary>ページごとの見出しアンカーマップ（絶対パス → id → アンカー）。他ファイルへのアンカー付きリンクの張り替えに使う。</summary>
		public Dictionary<string, Dictionary<string, string>> CrossFileAnchors;

		public Converter()
		{
			listTable = new ListTableConverter(inline);
		}

		public ConvertResult ConvertFile(string htmlPath, bool write)
		{
			inline.Reset();

			string html = File.ReadAllText(htmlPath, Encoding.UTF8);
			// style は次の行で落ちるので、その前に CSS 変数を読む
			Dictionary<string, Dictionary<string, string>> cssVars = HtmlUtil.BuildCssVars(html);
			html = HtmlUtil.StripNonContent(html);
			string body = HtmlUtil.ExtractBody(html);

			bool hasMinibar = Regex.IsMatch(body, "<div\\b[^>]*class=\"[^\"]*\\bminibar\\b");
			string dir = Path.GetDirectoryName(htmlPath);
			string baseName = Path.GetFileNameWithoutExtension(htmlPath);
			inline.SetLinkBase(dir, ConvertedPages, CrossFileAnchors);

			ConvertContext ctx = new ConvertContext();
			ctx.Anchors = BuildAnchorMap(body);
			ctx.ImagesDir = Path.Combine(dir, "images");
			ctx.BasePrefix = baseName;
			ctx.HasMinibar = hasMinibar;
			ctx.Write = write;
			ctx.CssVars = cssVars;

			List<string> blocks = ConvertBlocks(body, ctx);
			string md = string.Join("\n\n", blocks.ToArray());

			// コードスパンを戻したあとで強調の記法を決める（前後の文字を見て判定するため）
			md = inline.RestoreCodeSpans(md);
			md = Emphasis.Resolve(md);

			md = Regex.Replace(md, "[ \t]+\n", "\n");
			md = Regex.Replace(md, "\n{3,}", "\n\n");
			md = md.TrimEnd() + "\n";
			md = Regex.Replace(md, "\\r?\\n", "\r\n");

			string mdPath = Path.ChangeExtension(htmlPath, ".md");
			if (write) File.WriteAllText(mdPath, md, new UTF8Encoding(false));

			ConvertResult r = new ConvertResult();
			r.HtmlPath = htmlPath;
			r.MdPath = mdPath;
			r.Markdown = md;
			r.Images = ctx.Images;
			return r;
		}

		/// <summary>
		/// 他ファイルへのアンカー付きリンクを張り替えるための事前パス用。
		/// 読み込み済みの HTML から、このファイルの見出しアンカーマップだけを作る
		/// （本変換はしない。全対象ファイルぶんを先に集めてから ConvertFile に渡す）。
		/// </summary>
		public static Dictionary<string, string> BuildAnchorsFromHtml(string html)
		{
			html = HtmlUtil.StripNonContent(html);
			string body = HtmlUtil.ExtractBody(html);
			return BuildAnchorMap(body);
		}

		/// <summary>
		/// section の id → 生成後の見出しアンカー（目次のリンク張り替え用）。
		///
		/// section を 1 つずつ切り出して中の h1 を探す。正規表現で
		/// &lt;section&gt;〜&lt;h1&gt; をまとめて拾うと、h1 を持たない
		/// &lt;section class="toc"&gt; が次の章の h1 まで飲み込み、
		/// 最初の章の id が登録されないまま章番号だけ進む。
		/// </summary>
		private static Dictionary<string, string> BuildAnchorMap(string body)
		{
			Dictionary<string, string> map = new Dictionary<string, string>(StringComparer.Ordinal);
			int no = 0;
			int i = 0;
			while (true)
			{
				Match m = Regex.Match(body.Substring(i), "<section\\b");
				if (!m.Success) break;
				int start = i + m.Index;
				HtmlUtil.Block block = HtmlUtil.GetBlock(body, start, "section");
				i = start + block.Outer.Length;

				Match h1 = Regex.Match(block.Outer, "(?s)<h1\\b[^>]*>(.*?)</h1>");
				if (!h1.Success) continue;   // 目次など h1 を持たない section は章に数えない
				no++;
				string id = HtmlUtil.GetAttr(HtmlUtil.GetOpenTag(block.Outer), "id");
				if (id.Length == 0) continue;
				string title = HtmlUtil.GetPlainText(h1.Groups[1].Value);
				map[id] = HtmlUtil.GetAnchor(no.ToString() + ". " + title);
			}
			// h2 / h3 に id が振られている場合も拾う
			foreach (Match m in Regex.Matches(body, "(?s)<h([23])\\b([^>]*)>(.*?)</h\\1>"))
			{
				string id = HtmlUtil.GetAttr("<h" + m.Groups[1].Value + m.Groups[2].Value + ">", "id");
				if (id.Length == 0 || map.ContainsKey(id)) continue;
				map[id] = HtmlUtil.GetAnchor(HtmlUtil.GetPlainText(m.Groups[3].Value));
			}
			return map;
		}

		/// <summary>
		/// 見出しの記号を決める。章（section 内の h1）は h2 相当に下げる。
		/// ミニタイトルバーを使う構成では minibar が章の区切りになるので、配下をもう 1 段下げる。
		///
		/// 章の外の見出し（目次・索引の案内など）は章と同じ立場なので 1 段上げる。
		/// h2 だけを上げると h2 が ## で h3 が #### になり、### が抜ける。
		/// </summary>
		private static string HeadingMark(ConvertContext ctx, int htmlLevel)
		{
			int shift = ctx.HasMinibar ? 2 : 1;
			int level = htmlLevel + shift;
			if (!ctx.InSection && htmlLevel >= 2) level--;
			if (level > 6) level = 6;
			return new string('#', level) + " ";
		}

		/// <summary>
		/// ブロック要素で囲まれていない地の文を 1 段落として足す。
		/// 空白だけなら何もしない。
		///
		/// これが無いと &lt;div&gt;テキスト&lt;/div&gt; のように p で囲まなかった文が、
		/// 警告も出ずに出力から消える。
		/// </summary>
		private void AddInlineText(string html, ConvertContext ctx, List<string> outBlocks)
		{
			if (string.IsNullOrEmpty(html)) return;
			string text = inline.Convert(html, ctx.Anchors, false);
			if (text.Length > 0) outBlocks.Add(text);
		}

		/// <summary>
		/// 定義リストを箇条書きにする。dt が項目、dd はその下に 4 字下げてぶら下げる。
		/// Markdown に定義リストは無いため、足す記号が - だけで済む形を選んだ。
		/// dt を太字にしない。** は HTML に無い装飾になる。
		/// </summary>
		private void ConvertDefList(string inner, ConvertContext ctx, List<string> outBlocks)
		{
			List<string> lines = new List<string>();
			int i = 0;

			while (true)
			{
				Match m = Regex.Match(inner.Substring(i), "<(dt|dd)\\b");
				if (!m.Success) break;
				int start = i + m.Index;
				string tag = m.Groups[1].Value.ToLowerInvariant();
				HtmlUtil.Block block = HtmlUtil.GetBlock(inner, start, tag);
				i = start + block.Outer.Length;

				// md-skip は dt・dd のどちらでも、その要素 1 つだけを落とす。
				// dt を落としたときに dd も連れて消す形にはしない（消す範囲を
				// HTML 側で選べなくなる。ぶら下げたい分は dd 側にも付ける）
				string[] classes = HtmlUtil.GetClassList(HtmlUtil.GetOpenTag(block.Outer));
				if (HtmlUtil.HasClass(classes, "md-skip")) continue;

				string text = inline.Convert(block.Inner, ctx.Anchors, false);
				// 項目の中で改行すると箇条書きが切れる
				text = Regex.Replace(text, "\\s*\\r?\\n\\s*", " ").Trim();
				if (text.Length == 0) continue;
				lines.Add((tag == "dd" ? "    - " : "- ") + text);
			}

			if (lines.Count > 0) outBlocks.Add(string.Join("\n", lines.ToArray()));
		}

		/// <summary>
		/// 折りたたみはタグのまま出す。GitHub が解釈するため畳みが効く。
		/// summary の後ろと閉じる前に空行を置く。空行が無いと中身が HTML として読まれ、
		/// Markdown の記法が効かない。
		///
		/// md-flat が付いていれば、畳まずに summary を見出し・中身をその配下の本文にする
		/// （タグ対応仕様の決着 12）。1 件ずつ参照する資料は、畳みより見出しが要る。
		/// </summary>
		private void ConvertDetails(string inner, string[] classes, ConvertContext ctx, List<string> outBlocks)
		{
			string summaryText = "";
			Match sm = Regex.Match(inner, "(?is)<summary\\b[^>]*>(.*?)</summary>");
			if (sm.Success)
			{
				summaryText = inline.Convert(sm.Groups[1].Value, ctx.Anchors, false);
				summaryText = Regex.Replace(summaryText, "\\s*\\r?\\n\\s*", " ").Trim();
				inner = inner.Remove(sm.Index, sm.Length);
			}

			List<string> sub = ConvertBlocks(inner, ctx);

			if (HtmlUtil.HasClass(classes, "md-flat"))
			{
				// 見出しに出す分は本文と同じ扱いなので、強調の記法は最終段の判定に任せる。
				// 段は「その位置の h2」に揃える（章の中なら ###）
				if (summaryText.Length > 0) outBlocks.Add(HeadingMark(ctx, 2) + summaryText);
				outBlocks.AddRange(sub);
				return;
			}

			List<string> d = new List<string>();
			d.Add("<details>");
			// summary の行は HTML ブロックの中なので ** が効かない。強調はタグで確定させる
			d.Add("<summary>" + Emphasis.ResolveAsTags(summaryText) + "</summary>");
			foreach (string b in sub)
			{
				d.Add("");
				d.Add(b);
			}
			d.Add("");
			d.Add("</details>");
			outBlocks.Add(string.Join("\n", d.ToArray()));
		}

		private List<string> ConvertBlocks(string html, ConvertContext ctx)
		{
			List<string> outBlocks = new List<string>();
			if (string.IsNullOrEmpty(html)) return outBlocks;

			Dictionary<string, string> anchors = ctx.Anchors;
			int i = 0;

			while (true)
			{
				Match m = Regex.Match(html.Substring(i), BlockTags);
				if (!m.Success)
				{
					// 最後のブロックより後ろに残ったテキスト
					AddInlineText(html.Substring(i), ctx, outBlocks);
					break;
				}
				int start = i + m.Index;
				// ブロックの手前に地の文がある場合、それも 1 段落として出す。
				// <div>テキスト<p>段落</p></div> のようにブロックと混在していても落とさない
				AddInlineText(html.Substring(i, m.Index), ctx, outBlocks);
				string tag = m.Groups[1].Value.ToLowerInvariant();
				HtmlUtil.Block block = HtmlUtil.GetBlock(html, start, tag);
				i = start + block.Outer.Length;
				string openTag = HtmlUtil.GetOpenTag(block.Outer);
				string[] classes = HtmlUtil.GetClassList(openTag);

				if (HtmlUtil.HasClass(classes, "md-skip")) continue;

				switch (tag)
				{
					case "section":
						{
							// 章のクラスは配下の SVG が var() を解決するのに使う。
							// 入れ子があっても壊れないよう、元の値に戻す
							string prevClass = ctx.ChapterClass;
							string found = HtmlUtil.FindChapterClass(classes);
							if (found.Length > 0) ctx.ChapterClass = found;
							ctx.InSection = true;
							outBlocks.AddRange(ConvertBlocks(block.Inner, ctx));
							ctx.InSection = false;
							ctx.ChapterClass = prevClass;
						}
						break;

					case "footer":
					case "nav":
					// 文書構造のタグ。中身をそのまま処理する
					case "main":
					case "article":
					case "aside":
					case "header":
					case "address":
					// details の外に単独で置かれた summary。中身を段落として出す
					case "summary":
					// dl の外に単独で置かれた dt・dd も同じ
					case "dt":
					case "dd":
						outBlocks.AddRange(ConvertBlocks(block.Inner, ctx));
						break;

					case "hr":
						outBlocks.Add("---");
						break;

					case "dl":
						ConvertDefList(block.Inner, ctx, outBlocks);
						break;

					case "details":
						ConvertDetails(block.Inner, classes, ctx, outBlocks);
						break;

					case "blockquote":
						{
							List<string> sub = ConvertBlocks(block.Inner, ctx);
							List<string> q = new List<string>();
							bool first = true;
							foreach (string b in sub)
							{
								if (!first) q.Add(">");
								first = false;
								foreach (string line in b.Split('\n')) q.Add(("> " + line).TrimEnd());
							}
							if (q.Count > 0) outBlocks.Add(string.Join("\n", q.ToArray()));
						}
						break;

					case "div":
						ConvertDiv(block, classes, ctx, outBlocks);
						break;

					case "figure":
						{
							Match svgM = Regex.Match(block.Outer, "(?s)<svg\\b.*?</svg>");
							if (svgM.Success)
							{
								SvgExporter.Result info = SvgExporter.Export(svgM.Value, ctx);
								outBlocks.Add("![" + info.Label + "](images/" + info.FileName + ")");
							}
							Match capM = Regex.Match(block.Outer, "(?s)<figcaption\\b[^>]*>(.*?)</figcaption>");
							if (capM.Success)
							{
								string cap = inline.Convert(capM.Groups[1].Value, anchors, false);
								if (cap.Length > 0) outBlocks.Add(cap);
							}
						}
						break;

					case "svg":
						{
							SvgExporter.Result info = SvgExporter.Export(block.Outer, ctx);
							outBlocks.Add("![" + info.Label + "](images/" + info.FileName + ")");
						}
						break;

					case "table":
						{
							// caption は表の見出し。Markdown に記法が無いので表の直前の段落にする
							Match tabCap = Regex.Match(block.Outer, "(?s)<caption\\b[^>]*>(.*?)</caption>");
							if (tabCap.Success)
							{
								string cap = inline.Convert(tabCap.Groups[1].Value, anchors, false);
								if (cap.Length > 0) outBlocks.Add(cap);
							}
							string t = listTable.ConvertTable(block.Outer, anchors);
							if (t.Length > 0) outBlocks.Add(t);
						}
						break;

					case "h1":
						{
							string text = inline.Convert(block.Inner, anchors, false);
							if (ctx.InTitlebar)
							{
								// タイトルバーの h1 は文書のタイトル
								if (text.Length > 0) outBlocks.Add("# " + text);
							}
							else
							{
								ctx.ChapterNo++;
								outBlocks.Add(HeadingMark(ctx, 1) + ctx.ChapterNo.ToString() + ". " + text);
							}
						}
						break;

					case "h2":
						{
							string text = inline.Convert(block.Inner, anchors, false);
							if (text.Length == 0) break;
							outBlocks.Add(HeadingMark(ctx, 2) + text);
						}
						break;

					case "h3":
					case "h4":
					case "h5":
					case "h6":
						{
							int level = int.Parse(tag.Substring(1));
							string text = inline.Convert(block.Inner, anchors, false);
							if (text.Length > 0) outBlocks.Add(HeadingMark(ctx, level) + text);
						}
						break;

					case "p":
						{
							string text = inline.Convert(block.Inner, anchors, false);
							if (text.Length == 0) break;
							// タイトルバー内の作成日・更新日は引用行にする
							// 日付のクラス名は date に統一したが、meta を使っている既存プロジェクトも受ける
							bool isMeta = HtmlUtil.HasClass(classes, "date") || HtmlUtil.HasClass(classes, "meta");
							if (isMeta || (ctx.InTitlebar && text.StartsWith("📅", StringComparison.Ordinal)))
							{
								outBlocks.Add("> " + Regex.Replace(text, "\\s*\\r?\\n\\s*", " "));
							}
							else
							{
								outBlocks.Add(text);
							}
						}
						break;

					case "ul":
						{
							string items = HtmlUtil.HasClass(classes, "chapters")
								? listTable.ConvertChapters(block.Outer, anchors)
								: listTable.ConvertList(block.Outer, "ul", anchors, 0);
							if (items.Length > 0) outBlocks.Add(items);
						}
						break;

					case "ol":
						{
							string items = HtmlUtil.HasClass(classes, "toc")
								? listTable.ConvertToc(block.Outer, anchors)
								: listTable.ConvertList(block.Outer, "ol", anchors, 0);
							if (items.Length > 0) outBlocks.Add(items);
						}
						break;

					case "pre":
						outBlocks.Add(ConvertPre(block.Inner));
						break;

					case "a":
						{
							// 段落の外に単独で置かれたリンク（.doclink など）
							string text = inline.Convert(block.Outer, anchors, false);
							if (text.Length > 0) outBlocks.Add(text);
						}
						break;
				}
			}

			List<string> cleaned = new List<string>();
			foreach (string b in outBlocks)
			{
				if (!string.IsNullOrEmpty(b)) cleaned.Add(b);
			}
			return cleaned;
		}

		private void ConvertDiv(HtmlUtil.Block block, string[] classes, ConvertContext ctx, List<string> outBlocks)
		{
			Dictionary<string, string> anchors = ctx.Anchors;

			if (HtmlUtil.HasClass(classes, "callout"))
			{
				string kind = "NOTE";
				foreach (string c in classes)
				{
					string found;
					if (CalloutKinds.TryGetValue(c, out found)) kind = found;
				}
				List<string> sub = ConvertBlocks(block.Inner, ctx);
				List<string> q = new List<string>();
				q.Add("> [!" + kind + "]");
				foreach (string b in sub)
				{
					foreach (string line in b.Split('\n')) q.Add(("> " + line).TrimEnd());
				}
				outBlocks.Add(string.Join("\n", q.ToArray()));
				return;
			}

			if (HtmlUtil.HasClass(classes, "titlebar"))
			{
				ctx.InTitlebar = true;
				outBlocks.AddRange(ConvertBlocks(block.Inner, ctx));
				ctx.InTitlebar = false;
				return;
			}

			if (HtmlUtil.HasClass(classes, "minibar"))
			{
				string text = inline.Convert(block.Inner, anchors, false);
				if (text.Length > 0) outBlocks.Add("## " + text);
				return;
			}

			if (HtmlUtil.HasClass(classes, "toc"))
			{
				Match h = Regex.Match(block.Outer, "(?s)<h2\\b[^>]*>(.*?)</h2>");
				if (h.Success)
				{
					outBlocks.Add("## " + inline.Convert(h.Groups[1].Value, anchors, false));
				}
				string items = listTable.ConvertToc(block.Outer, anchors);
				if (items.Length > 0) outBlocks.Add(items);
				return;
			}

			// 日付のクラス名は date に統一したが、meta を使っている既存プロジェクトも受ける
			if (HtmlUtil.HasClass(classes, "date") || HtmlUtil.HasClass(classes, "meta"))
			{
				// タイトルバー内の作成日・更新日は引用行にする
				string text = inline.Convert(block.Inner, anchors, false);
				if (text.Length > 0) outBlocks.Add("> " + Regex.Replace(text, "\\s*\\r?\\n\\s*", " "));
				return;
			}

			// .wrap や .inner のような位置合わせだけのラッパは中身をそのまま処理する
			outBlocks.AddRange(ConvertBlocks(block.Inner, ctx));
		}

		private static string ConvertPre(string blockInner)
		{
			string inner = blockInner;
			string lang = "";
			Match codeM = Regex.Match(inner, "(?s)<code\\b([^>]*)>(.*?)</code>");
			if (codeM.Success)
			{
				foreach (string c in HtmlUtil.GetClassList("<code" + codeM.Groups[1].Value + ">"))
				{
					if (c.StartsWith("language-", StringComparison.Ordinal))
					{
						lang = c.Substring("language-".Length);
					}
				}
				inner = codeM.Groups[2].Value;
			}
			string code = HtmlUtil.DecodeEntities(Regex.Replace(inner, "<[^>]+>", ""));
			code = code.Replace("\r\n", "\n");
			// 前後の空行だけを落とす（行頭のインデントは保つ）
			code = Regex.Replace(code, "\\A(\\s*\n)+", "");
			code = Regex.Replace(code, "(\n\\s*)+\\z", "");
			return "```" + lang + "\n" + code + "\n```";
		}
	}
}
