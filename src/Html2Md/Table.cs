using System;
using System.Collections.Generic;
using System.Text;
using System.Text.RegularExpressions;

namespace Html2Md
{
	/// <summary>表・リスト・目次を Markdown にする。</summary>
	internal sealed class ListTableConverter
	{
		private readonly InlineConverter inline;

		public ListTableConverter(InlineConverter inlineConverter)
		{
			inline = inlineConverter;
		}

		private sealed class Cell
		{
			public string Text;
			public int ColSpan;
			public int RowSpan;
			public bool IsNum;
			public bool IsHead;
		}

		/// <summary>
		/// 表を Markdown のテーブルにする。
		/// Markdown にセル結合が無いため、rowspan / colspan は結合元に文字を置いて残りを空欄にする。
		/// 列全体が num のときだけ右寄せにする。
		/// </summary>
		public string ConvertTable(string tableHtml, Dictionary<string, string> anchors)
		{
			// thead があればその範囲の行をヘッダとみなす
			int headEnd = -1;
			Match mHead = Regex.Match(tableHtml, "(?s)<thead\\b[^>]*>.*?</thead>");
			if (mHead.Success) headEnd = mHead.Index + mHead.Length;

			List<List<Cell>> rows = new List<List<Cell>>();
			foreach (Match rm in Regex.Matches(tableHtml, "(?s)<tr\\b[^>]*>(.*?)</tr>"))
			{
				bool isHeadRow = (headEnd >= 0 && rm.Index < headEnd);
				List<Cell> cells = new List<Cell>();
				foreach (Match cm in Regex.Matches(rm.Groups[1].Value, "(?s)<(t[hd])\\b([^>]*)>(.*?)</\\1>"))
				{
					string attrs = cm.Groups[2].Value;
					string[] cellClasses = HtmlUtil.GetClassList("<td" + attrs + ">");
					Cell c = new Cell();
					// md-skip のセルは空セルにする（part/desc の省略時と同じ落とし方）。
					// colspan/rowspan の展開は列数がずれると崩れるため、行・列ごと削らない
					c.Text = HtmlUtil.HasClass(cellClasses, "md-skip") ? "" : inline.Convert(cm.Groups[3].Value, anchors, true);
					c.ColSpan = ParseSpan(attrs, "colspan");
					c.RowSpan = ParseSpan(attrs, "rowspan");
					c.IsNum = HtmlUtil.HasClass(cellClasses, "num");
					c.IsHead = isHeadRow || string.Equals(cm.Groups[1].Value, "th", StringComparison.OrdinalIgnoreCase);
					cells.Add(c);
				}
				if (cells.Count > 0) rows.Add(cells);
			}
			if (rows.Count == 0) return "";

			Dictionary<string, string> grid = new Dictionary<string, string>();
			Dictionary<int, int> numCount = new Dictionary<int, int>();
			Dictionary<int, int> dataCount = new Dictionary<int, int>();
			int maxCol = 0;
			int rowCount = 0;

			for (int r = 0; r < rows.Count; r++)
			{
				int c = 0;
				foreach (Cell cell in rows[r])
				{
					while (grid.ContainsKey(Key(r, c))) c++;
					for (int dr = 0; dr < cell.RowSpan; dr++)
					{
						for (int dc = 0; dc < cell.ColSpan; dc++)
						{
							int rr = r + dr;
							int cc = c + dc;
							grid[Key(rr, cc)] = (dr == 0 && dc == 0) ? cell.Text : "";
							if (rr + 1 > rowCount) rowCount = rr + 1;
						}
					}
					// 数値列の判定はヘッダを除いたデータ行だけで行う
					if (!cell.IsHead)
					{
						Increment(dataCount, c);
						if (cell.IsNum) Increment(numCount, c);
					}
					c += cell.ColSpan;
					if (c > maxCol) maxCol = c;
				}
			}
			if (maxCol == 0 || rowCount == 0) return "";

			string[] sep = new string[maxCol];
			for (int c = 0; c < maxCol; c++)
			{
				int n = Get(numCount, c);
				int d = Get(dataCount, c);
				sep[c] = (n > 0 && n == d) ? "---:" : "---";
			}

			List<string> lines = new List<string>();
			for (int r = 0; r < rowCount; r++)
			{
				string[] cols = new string[maxCol];
				for (int c = 0; c < maxCol; c++)
				{
					string v;
					cols[c] = grid.TryGetValue(Key(r, c), out v) ? v : "";
				}
				lines.Add("| " + string.Join(" | ", cols) + " |");
				if (r == 0) lines.Add("|" + string.Join("|", sep) + "|");
			}
			return string.Join("\n", lines.ToArray());
		}

		private static string Key(int r, int c)
		{
			return r.ToString() + "," + c.ToString();
		}

		private static int ParseSpan(string attrs, string name)
		{
			Match m = Regex.Match(attrs, name + "=\"(\\d+)\"");
			if (!m.Success) return 1;
			int v;
			if (!int.TryParse(m.Groups[1].Value, out v) || v < 1) return 1;
			return v;
		}

		private static void Increment(Dictionary<int, int> map, int key)
		{
			int v;
			map.TryGetValue(key, out v);
			map[key] = v + 1;
		}

		private static int Get(Dictionary<int, int> map, int key)
		{
			int v;
			map.TryGetValue(key, out v);
			return v;
		}

		/// <summary>リストを変換する。入れ子は 4 空白ずつ字下げする。</summary>
		public string ConvertList(string listHtml, string tag, Dictionary<string, string> anchors, int depth)
		{
			// リストの中身。閉じられていない場合も末尾までを中身とする
			string inner = HtmlUtil.GetBlock(listHtml, 0, tag).Inner;
			string indent = new string(' ', 4 * depth);
			List<string> outLines = new List<string>();
			int n = 0;
			int i = 0;

			while (true)
			{
				Match m = Regex.Match(inner.Substring(i), "<li\\b");
				if (!m.Success) break;
				int start = i + m.Index;
				HtmlUtil.Block block = HtmlUtil.GetBlock(inner, start, "li");
				i = start + block.Outer.Length;

				string[] liClasses = HtmlUtil.GetClassList(HtmlUtil.GetOpenTag(block.Outer));
				if (HtmlUtil.HasClass(liClasses, "md-skip")) continue;

				string liInner = block.Inner;

				// 入れ子のリストを取り出してから、残りを 1 行のテキストにする
				List<string[]> nested = new List<string[]>();
				while (true)
				{
					Match nm = Regex.Match(liInner, "<(ul|ol)\\b");
					if (!nm.Success) break;
					string nTag = nm.Groups[1].Value.ToLowerInvariant();
					string nBlock = HtmlUtil.GetBlock(liInner, nm.Index, nTag).Outer;
					nested.Add(new string[] { nTag, nBlock });
					liInner = liInner.Remove(nm.Index, nBlock.Length);
				}

				string text = inline.Convert(liInner, anchors, false);
				text = Regex.Replace(text, "\\s*\\r?\\n\\s*", " ");
				if (text.Length == 0 && nested.Count == 0) continue;
				n++;
				if (string.Equals(tag, "ol", StringComparison.Ordinal))
				{
					outLines.Add(indent + n.ToString() + ". " + text);
				}
				else
				{
					outLines.Add(indent + "- " + text);
				}

				foreach (string[] nst in nested)
				{
					string sub = ConvertList(nst[1], nst[0], anchors, depth + 1);
					if (sub.Length > 0) outLines.Add(sub);
				}
			}
			return string.Join("\n", outLines.ToArray());
		}

		/// <summary>目次を、生成後の見出しアンカーに向けた番号付きリストにする。</summary>
		public string ConvertToc(string tocHtml, Dictionary<string, string> anchors)
		{
			List<string> outLines = new List<string>();
			int n = 0;
			foreach (Match li in Regex.Matches(tocHtml, "(?s)<li\\b[^>]*>(.*?)</li>"))
			{
				Match a = Regex.Match(li.Groups[1].Value, "(?s)<a\\b[^>]*href=\"#([^\"]+)\"[^>]*>(.*?)</a>");
				if (!a.Success) continue;
				n++;
				string id = a.Groups[1].Value;
				string text = inline.Convert(a.Groups[2].Value, anchors, false);
				string anchor;
				if (!anchors.TryGetValue(id, out anchor)) anchor = id;
				outLines.Add(n.ToString() + ". [" + text + "](#" + anchor + ")");
			}
			return string.Join("\n", outLines.ToArray());
		}

		/// <summary>
		/// class="chapters" のリストを、data-columns の 3 列見出しを持つ表にする。
		/// タグ対応仕様の決着 10 を参照。data-columns が無い・列数が 3 でなければ
		/// エラーで止める（黙って見出しの無い表を出さない）。
		/// part / desc は行ごとに省略でき、その列は空セルになる。
		/// </summary>
		public string ConvertChapters(string ulHtml, Dictionary<string, string> anchors)
		{
			// ulHtml は開きタグから始まる（block.Outer）。開きタグ部分から属性を取る
			int openEnd = ulHtml.IndexOf('>');
			string openTag = (openEnd >= 0) ? ulHtml.Substring(0, openEnd + 1) : ulHtml;
			string columnsAttr = HtmlUtil.GetAttr(openTag, "data-columns");
			if (columnsAttr.Length == 0)
			{
				throw new InvalidOperationException(
					"class=\"chapters\" には data-columns が必須です（例: data-columns=\"部,タイトル,内容\"）。" +
					"表の見出しは HTML に書かれた文言しか使えません。");
			}
			string[] headers = columnsAttr.Split(',');
			if (headers.Length != 3)
			{
				throw new InvalidOperationException(
					"data-columns は 3 列で指定してください（part, ttl, desc に対応）: " + columnsAttr);
			}

			string inner = HtmlUtil.GetBlock(ulHtml, 0, "ul").Inner;
			List<string[]> rows = new List<string[]>();
			int i = 0;
			while (true)
			{
				Match m = Regex.Match(inner.Substring(i), "<li\\b");
				if (!m.Success) break;
				int start = i + m.Index;
				HtmlUtil.Block block = HtmlUtil.GetBlock(inner, start, "li");
				i = start + block.Outer.Length;
				string liInner = block.Inner;

				string part = ExtractSpanText(liInner, "part", anchors);
				string desc = ExtractSpanText(liInner, "desc", anchors);

				// ttl は生のまま取り出し、a で囲む href があれば合成 <a> にして inline.Convert に
				// 通す。ほかのリンクと同じ経路（.md 置換・他ファイルのアンカー張り替え）を通すため。
				// ここで自前に "[text](href)" を組み立てると、その経路を素通りしてしまう。
				//
				// href は「ttl を囲む a」からだけ取る。li 内の最初の a を無条件に使うと、
				// desc 側だけにリンクがあるケースでも ttl が誤ってリンク化される
				string ttlRaw = ExtractSpanRaw(liInner, "ttl");
				string ttl;
				string href = "";
				foreach (Match aTag in Regex.Matches(liInner, "(?s)<a\\b([^>]*)>.*?</a>"))
				{
					if (Regex.IsMatch(aTag.Value, "class\\s*=\\s*\"[^\"]*\\bttl\\b[^\"]*\""))
					{
						href = HtmlUtil.GetAttr("<a" + aTag.Groups[1].Value + ">", "href");
						break;
					}
				}
				if (href.Length > 0 && ttlRaw.Length > 0)
				{
					ttl = inline.Convert("<a href=\"" + href + "\">" + ttlRaw + "</a>", anchors, true);
				}
				else
				{
					ttl = inline.Convert(ttlRaw, anchors, true);
				}
				ttl = Regex.Replace(ttl, "\\s*\\r?\\n\\s*", " ");

				if (part.Length == 0 && ttl.Length == 0 && desc.Length == 0) continue;
				rows.Add(new string[] { part, ttl, desc });
			}
			if (rows.Count == 0) return "";

			List<string> lines = new List<string>();
			lines.Add("| " + string.Join(" | ", headers) + " |");
			lines.Add("|---|---|---|");
			foreach (string[] row in rows)
			{
				lines.Add("| " + string.Join(" | ", row) + " |");
			}
			return string.Join("\n", lines.ToArray());
		}

		private string ExtractSpanText(string html, string className, Dictionary<string, string> anchors)
		{
			string raw = ExtractSpanRaw(html, className);
			if (raw.Length == 0) return "";
			string text = inline.Convert(raw, anchors, true);
			return Regex.Replace(text, "\\s*\\r?\\n\\s*", " ");
		}

		/// <summary>指定クラスの span の中身を、変換せず生の HTML のまま返す。</summary>
		private string ExtractSpanRaw(string html, string className)
		{
			foreach (Match m in Regex.Matches(html, "(?s)<span\\b([^>]*)>(.*?)</span>"))
			{
				if (HtmlUtil.HasClass(HtmlUtil.GetClassList("<span" + m.Groups[1].Value + ">"), className))
				{
					return m.Groups[2].Value;
				}
			}
			return "";
		}
	}
}
