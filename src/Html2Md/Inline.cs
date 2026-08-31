using System;
using System.Collections.Generic;
using System.Text.RegularExpressions;

namespace Html2Md
{
	/// <summary>
	/// インライン要素（リンク・強調・コード・バッジ・画像）を Markdown の記法にする。
	///
	/// 強調はここでは確定させず、センチネルで囲むだけにする。** で書けるかは前後の文字で
	/// 決まり、その文字はブロックを組み立て終わるまで確定しないため。
	/// </summary>
	internal sealed class InlineConverter
	{
		/// <summary>バッジのクラス名 → Markdown で使う記号。ここに無い b-* は種類を表すラベル扱い。</summary>
		private static readonly Dictionary<string, string> BadgeMarks = new Dictionary<string, string>(StringComparer.Ordinal)
		{
			{ "b-ok", "✅" },
			{ "b-ng", "❌" },
			{ "b-warn", "⚠" },
			{ "b-none", "" }
		};

		/// <summary>コードスパンの退避先。ファイル単位で作り直す。</summary>
		private readonly List<string> codeSpans = new List<string>();

		/// <summary>相対リンクを解決する基準。変換中の HTML があるフォルダ。</summary>
		private string linkBaseDir = "";

		/// <summary>md-skip のページ（絶対パス）。ここへのリンクは .html のまま残す。</summary>
		private HashSet<string> mdSkipPages;

		public void Reset()
		{
			codeSpans.Clear();
		}

		/// <summary>リンクの置き換えに使う基準フォルダと、Markdown を生成しないページの一覧。</summary>
		public void SetLinkBase(string baseDir, HashSet<string> skipPages)
		{
			linkBaseDir = baseDir == null ? "" : baseDir;
			mdSkipPages = skipPages;
		}

		private string StoreCodeSpan(string text)
		{
			int i = codeSpans.Count;
			codeSpans.Add(text);
			return Emphasis.CodeSpan.ToString() + i.ToString() + Emphasis.CodeSpan.ToString();
		}

		/// <summary>退避したコードスパンを本文に戻す。</summary>
		public string RestoreCodeSpans(string text)
		{
			string t = text;
			for (int i = codeSpans.Count - 1; i >= 0; i--)
			{
				string key = Emphasis.CodeSpan.ToString() + i.ToString() + Emphasis.CodeSpan.ToString();
				t = t.Replace(key, codeSpans[i]);
			}
			return t;
		}

		/// <summary>
		/// バッジのクラスから記号を求める。バッジでなければ null。
		/// 記号が決まらない b-* は種類を表すラベルなので空文字（太字だけにする）。
		/// </summary>
		private static string GetBadgeMark(string[] classes)
		{
			bool isBadge = HtmlUtil.HasClass(classes, "badge");
			string mark = null;
			foreach (string c in classes)
			{
				if (!c.StartsWith("b-", StringComparison.Ordinal)) continue;
				string found;
				if (BadgeMarks.TryGetValue(c, out found))
				{
					mark = found;
					isBadge = true;
					break;
				}
				// b-esm のような種類のラベル
				isBadge = true;
				mark = "";
			}
			if (!isBadge) return null;
			return mark == null ? "" : mark;
		}

		/// <summary>インライン要素を変換する。inTable のときはセル区切りを壊さないようにする。</summary>
		public string Convert(string html, Dictionary<string, string> anchors, bool inTable)
		{
			if (string.IsNullOrEmpty(html)) return "";
			string s = html;

			// セル内に置かれたコードブロックは 1 行のコード表記に落とす
			s = Regex.Replace(s, "(?s)<pre\\b[^>]*>\\s*<code\\b[^>]*>(.*?)</code>\\s*</pre>", m =>
			{
				string code = HtmlUtil.DecodeEntities(Regex.Replace(m.Groups[1].Value, "<[^>]+>", ""));
				code = Regex.Replace(code, "\\r?\\n", " ").Replace("`", "'");
				return StoreCodeSpan("`" + code.Trim() + "`");
			});

			// コードスパンは退避する（中身を他の変換の対象から外すため）
			s = Regex.Replace(s, "(?s)<code\\b[^>]*>(.*?)</code>", m =>
			{
				string code = HtmlUtil.DecodeEntities(Regex.Replace(m.Groups[1].Value, "<[^>]+>", ""));
				return StoreCodeSpan("`" + code + "`");
			});

			// バッジは色でしか区別していないので、記号＋太字の文字情報に落とす。
			// 記号は太字の外に置く（内側に入れると ** が開かない）
			s = Regex.Replace(s, "(?s)<span\\b([^>]*)>(.*?)</span>", m =>
			{
				string[] classes = HtmlUtil.GetClassList("<span" + m.Groups[1].Value + ">");
				string inner = m.Groups[2].Value;
				string mark = GetBadgeMark(classes);
				if (mark == null) return inner;
				string text = HtmlUtil.GetPlainText(inner);
				if (text.Length == 0) return "";
				string body = Emphasis.StrongBegin + text + Emphasis.StrongEnd.ToString();
				// バッジは CSS の余白で本文と離れていたので、空白 1 個を補って続く文と分ける
				if (mark.Length > 0) return mark + " " + body + " ";
				return body + " ";
			});

			// 画像
			s = Regex.Replace(s, "<img\\b([^>]*?)/?>", m =>
			{
				string tag = "<img" + m.Groups[1].Value + ">";
				string src = HtmlUtil.GetAttr(tag, "src");
				if (src.Length == 0) return "";
				string alt = HtmlUtil.DecodeEntities(HtmlUtil.GetAttr(tag, "alt"));
				return "![" + alt + "](" + src + ")";
			});

			// リンク: 拡張子を .md に置き換え、ページ内アンカーは見出しアンカーへ張り替える
			s = Regex.Replace(s, "(?s)<a\\b([^>]*)>(.*?)</a>", m =>
			{
				string tag = "<a" + m.Groups[1].Value + ">";
				string href = HtmlUtil.GetAttr(tag, "href");
				string text = Regex.Replace(m.Groups[2].Value, "<[^>]+>", "");
				text = Regex.Replace(HtmlUtil.DecodeEntities(text), "\\s+", " ").Trim();
				if (href.Length == 0) return text;
				if (href.StartsWith("#", StringComparison.Ordinal))
				{
					string key = href.Substring(1);
					string mapped;
					if (anchors != null && anchors.TryGetValue(key, out mapped)) href = "#" + mapped;
				}
				else
				{
					href = HtmlUtil.ConvertLinkTarget(href, linkBaseDir, mdSkipPages);
				}
				return "[" + text + "](" + href + ")";
			});

			// 強調はセンチネルで囲むだけにして、記法は最終段で決める
			s = Regex.Replace(s, "(?s)<(strong|b)\\b[^>]*>(.*?)</\\1>", m =>
			{
				string inner = m.Groups[2].Value;
				if (HtmlUtil.GetPlainText(inner).Length == 0) return "";
				return Emphasis.StrongBegin + inner + Emphasis.StrongEnd.ToString();
			});
			s = Regex.Replace(s, "(?s)<(em|i)\\b[^>]*>(.*?)</\\1>", m =>
			{
				string inner = m.Groups[2].Value;
				if (HtmlUtil.GetPlainText(inner).Length == 0) return "";
				return Emphasis.EmBegin + inner + Emphasis.EmEnd.ToString();
			});

			// <br> はタグ除去で消えないよう退避する
			s = Regex.Replace(s, "<br\\s*/?>", Emphasis.Break.ToString());

			// 残ったタグを落とす
			s = Regex.Replace(s, "<[^>]+>", "");
			s = HtmlUtil.DecodeEntities(s);
			s = Regex.Replace(s, "\\s+", " ");

			// <br> はタグのまま出す。表の中と外で表現を揃える
			s = s.Replace(Emphasis.Break.ToString(), "<br>");

			if (inTable)
			{
				// セル区切りとの衝突を避ける
				s = s.Replace("|", "\\|");
			}
			return s.Trim();
		}
	}
}
