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
					Cell c = new Cell();
					c.Text = inline.Convert(cm.Groups[3].Value, anchors, true);
					c.ColSpan = ParseSpan(attrs, "colspan");
					c.RowSpan = ParseSpan(attrs, "rowspan");
					c.IsNum = HtmlUtil.HasClass(HtmlUtil.GetClassList("<td" + attrs + ">"), "num");
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
	}
}
