using System;
using System.Globalization;
using System.Text.RegularExpressions;

namespace Html2Md
{
	/// <summary>
	/// 強調を ** で書くかタグで書くかを決める。
	///
	/// CommonMark は区切り記号の前後の文字を見て開閉を判定する。** は語中にも置けるため、
	/// 開きが成立しないのは「内容の先頭が句読点で、その手前が通常文字」の場合、
	/// 閉じが成立しないのは「内容の末尾が句読点で、その直後が通常文字」の場合だけ。
	/// どちらかが成立しないと ** が記号のまま表示されるので、その箇所はタグで出す。
	///
	/// 変換の途中では判定できない。前後の文字は他の要素の変換が終わるまで確定しないため、
	/// いったんセンチネルで囲んでおき、本文が組み上がってから内側から順に確定させる。
	/// </summary>
	internal static class Emphasis
	{
		/// <summary>強調の開始。本文に現れない制御文字を使う</summary>
		public const char StrongBegin = '\u0001';
		public const char StrongEnd = '\u0002';
		public const char EmBegin = '\u0003';
		public const char EmEnd = '\u0004';
		/// <summary>タグ除去で消えないよう &lt;br&gt; を退避する</summary>
		public const char Break = '\u0005';
		/// <summary>取り消し線。~~ も ** と同じ前後判定を受けるため記法を最終段で決める</summary>
		public const char DelBegin = (char)6;
		public const char DelEnd = (char)8;
		/// <summary>
		/// 退避した文字列の閉じ。開きと別の文字にする。
		///
		/// 両端を同じ文字にすると、あるキーの閉じ・本文の数字・次のキーの開きが並んだときに
		/// 偽のキーができる。2&lt;sup&gt;10&lt;/sup&gt; が別の退避内容に置き換わっていた。
		///
		/// センチネルに使えるのは \s にマッチしない制御文字だけ。本文は最後に空白を
		/// まとめるため、\t \n \v \f \r（9〜13）を使うとキーが空白に置き換わって壊れる。
		/// </summary>
		public const char StoreEnd = (char)14;
		/// <summary>退避した文字列の開き（中身を他の変換の対象から外す）</summary>
		public const char CodeSpan = '\u0007';

		/// <summary>センチネルのペア（内側にセンチネルを含まないもの）</summary>
		private const string InnermostPair = @"[\x01\x03\x06]([^\x01-\x04\x06\x08]*)[\x02\x04\x08]";

		/// <summary>強調の種類。開きと閉じで一致しなければ記法にしない。</summary>
		private const int KindNone = 0;
		private const int KindStrong = 1;
		private const int KindEm = 2;
		private const int KindDel = 3;

		private static int KindOfBegin(char c)
		{
			if (c == StrongBegin) return KindStrong;
			if (c == EmBegin) return KindEm;
			if (c == DelBegin) return KindDel;
			return KindNone;
		}

		private static int KindOfEnd(char c)
		{
			if (c == StrongEnd) return KindStrong;
			if (c == EmEnd) return KindEm;
			if (c == DelEnd) return KindDel;
			return KindNone;
		}

		private static string MarkOf(int kind)
		{
			if (kind == KindStrong) return "**";
			if (kind == KindEm) return "*";
			return "~~";
		}

		private static string TagOf(int kind)
		{
			if (kind == KindStrong) return "strong";
			if (kind == KindEm) return "em";
			return "del";
		}

		/// <summary>CommonMark が句読点として扱う文字か（Unicode の P 系と S 系）。</summary>
		public static bool IsPunct(char c)
		{
			switch (CharUnicodeInfo.GetUnicodeCategory(c))
			{
				case UnicodeCategory.ConnectorPunctuation:
				case UnicodeCategory.DashPunctuation:
				case UnicodeCategory.OpenPunctuation:
				case UnicodeCategory.ClosePunctuation:
				case UnicodeCategory.InitialQuotePunctuation:
				case UnicodeCategory.FinalQuotePunctuation:
				case UnicodeCategory.OtherPunctuation:
				case UnicodeCategory.MathSymbol:
				case UnicodeCategory.CurrencySymbol:
				case UnicodeCategory.ModifierSymbol:
				case UnicodeCategory.OtherSymbol:
					return true;
				default:
					return false;
			}
		}

		/// <summary>text の start から length 文字を ** で囲めるか。</summary>
		public static bool CanEmphasize(string text, int start, int length)
		{
			if (length <= 0) return false;
			// 行頭・行末は空白として扱う（CommonMark の規定）
			char before = (start > 0) ? text[start - 1] : ' ';
			char after = (start + length < text.Length) ? text[start + length] : ' ';
			char first = text[start];
			char last = text[start + length - 1];

			// 開き側
			if (char.IsWhiteSpace(first)) return false;
			if (IsPunct(first) && !(char.IsWhiteSpace(before) || IsPunct(before))) return false;

			// 閉じ側
			if (char.IsWhiteSpace(last)) return false;
			if (IsPunct(last) && !(char.IsWhiteSpace(after) || IsPunct(after))) return false;

			return true;
		}

		/// <summary>センチネルで囲んだ強調を、内側から順に ** かタグに確定させる。</summary>
		public static string Resolve(string text)
		{
			string t = text;
			while (true)
			{
				Match m = Regex.Match(t, InnermostPair);
				if (!m.Success) break;

				int openKind = KindOfBegin(t[m.Index]);
				int closeKind = KindOfEnd(t[m.Index + m.Length - 1]);
				string inner = m.Groups[1].Value.Trim();
				string prefix = t.Substring(0, m.Index);
				string suffix = t.Substring(m.Index + m.Length);

				if (inner.Length == 0)
				{
					t = prefix + suffix;
					continue;
				}

				// 記号を挟まない状態で前後の文字を見る。
				// 開きと閉じの種類が食い違うときは、記法にせずタグで出す。
				bool ok = (openKind == closeKind)
					&& CanEmphasize(prefix + inner + suffix, prefix.Length, inner.Length);

				string rep;
				if (ok)
				{
					string mark = MarkOf(openKind);
					rep = mark + inner + mark;
				}
				else
				{
					string tag = TagOf(openKind);
					rep = "<" + tag + ">" + inner + "</" + tag + ">";
				}
				t = prefix + rep + suffix;
			}
			return t;
		}
	}
}
