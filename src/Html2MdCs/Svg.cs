using System;
using System.Collections.Generic;
using System.IO;
using System.Text;
using System.Text.RegularExpressions;

namespace Html2Md
{
	/// <summary>
	/// インライン SVG を独立ファイルに切り出す。
	/// GitHub は Markdown 内のインライン SVG をサニタイズで除去するため、
	/// images/ に書き出して画像参照にする。
	/// </summary>
	internal static class SvgExporter
	{
		public sealed class Result
		{
			public string FileName;
			public string Label;
		}

		public static Result Export(string svgHtml, ConvertContext ctx)
		{
			Match open = Regex.Match(svgHtml, "(?s)^<svg\\b([^>]*)>");
			string openTag = open.Success ? open.Value : "<svg>";

			ctx.FigIndex++;
			string id = HtmlUtil.GetAttr(openTag, "id");
			string fileName = (id.Length > 0)
				? id + ".svg"
				: string.Format("{0}-fig{1:d2}.svg", ctx.BasePrefix, ctx.FigIndex);

			string body = open.Success ? svgHtml.Substring(open.Length) : svgHtml;
			body = Regex.Replace(body, "(?s)</svg>\\s*$", "");

			// var(--accent) は切り出した先では解決されず、色が失われる。
			// 章のクラスの定義を先に見て、無ければ :root を見て静的に埋める
			body = HtmlUtil.ResolveCssVars(body, ctx.CssVars, ctx.ChapterClass);

			// 切り出したあとの id はファイル単位で一意ならよいので、短い名前に振り直す
			List<string> ids = new List<string>();
			foreach (Match m in Regex.Matches(body, "\\sid=\"([^\"]+)\""))
			{
				if (!ids.Contains(m.Groups[1].Value)) ids.Add(m.Groups[1].Value);
			}
			int k = 0;
			foreach (string old in ids)
			{
				k++;
				string neo = "i" + k.ToString();
				body = Regex.Replace(body, "\\sid=\"" + Regex.Escape(old) + "\"", " id=\"" + neo + "\"");
				body = Regex.Replace(body, "url\\(#" + Regex.Escape(old) + "\\)", "url(#" + neo + ")");
				body = Regex.Replace(body, "href=\"#" + Regex.Escape(old) + "\"", "href=\"#" + neo + "\"");
			}

			// 単体ファイルとして開けるよう xmlns と width / height を付ける
			string viewBox = HtmlUtil.GetAttr(openTag, "viewBox");
			string label = HtmlUtil.GetAttr(openTag, "aria-label");
			string font = HtmlUtil.GetAttr(openTag, "font-family");
			string w = "";
			string h = "";
			Match vb = Regex.Match(viewBox, "^\\s*[\\d.\\-]+\\s+[\\d.\\-]+\\s+([\\d.]+)\\s+([\\d.]+)\\s*$");
			if (vb.Success)
			{
				w = vb.Groups[1].Value;
				h = vb.Groups[2].Value;
			}

			StringBuilder attrs = new StringBuilder();
			attrs.Append("xmlns=\"http://www.w3.org/2000/svg\"");
			if (viewBox.Length > 0) attrs.Append(" viewBox=\"").Append(viewBox).Append("\"");
			if (w.Length > 0 && h.Length > 0)
			{
				attrs.Append(" width=\"").Append(w).Append("\" height=\"").Append(h).Append("\"");
			}
			attrs.Append(" role=\"img\"");
			if (label.Length > 0) attrs.Append(" aria-label=\"").Append(label).Append("\"");
			if (font.Length > 0) attrs.Append(" font-family=\"").Append(font).Append("\"");

			// 透過のままだとダークモードで文字が読めないので白背景を敷く。
			// defs の直後に入れて、グラデーション定義より後ろに来るようにする
			string bg = "\t<rect width=\"100%\" height=\"100%\" fill=\"#ffffff\"/>";
			int defsEnd = body.IndexOf("</defs>", StringComparison.OrdinalIgnoreCase);
			if (defsEnd >= 0)
			{
				int cut = defsEnd + "</defs>".Length;
				body = body.Substring(0, cut) + "\n" + bg + body.Substring(cut);
			}
			else
			{
				body = "\n" + bg + body;
			}

			string svg = "<svg " + attrs.ToString() + ">" + body + "</svg>";
			// 改行は .md と揃えて LF にする
			svg = Regex.Replace(svg, "\\r\\n?", "\n");
			if (!svg.EndsWith("\n")) svg += "\n";

			if (ctx.Write)
			{
				if (!Directory.Exists(ctx.ImagesDir)) Directory.CreateDirectory(ctx.ImagesDir);
				File.WriteAllText(Path.Combine(ctx.ImagesDir, fileName), svg, new UTF8Encoding(false));
			}
			ctx.Images.Add(fileName);

			Result r = new Result();
			r.FileName = fileName;
			r.Label = HtmlUtil.DecodeEntities(label);
			return r;
		}
	}
}
