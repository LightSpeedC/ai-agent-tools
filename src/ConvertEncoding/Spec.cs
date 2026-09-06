using System;
using System.Collections.Generic;

namespace ConvertEncoding
{
	/// <summary>文字コードの種類。</summary>
	internal enum EncodingKind
	{
		Utf8,
		Utf8Bom,
		Sjis,
		Utf16Le,
		Utf16Be
	}

	/// <summary>改行の種類。</summary>
	internal enum EolKind
	{
		Lf,
		CrLf
	}

	/// <summary>
	/// --to に指定された内容。null は「変えない」を表す。
	/// </summary>
	internal sealed class TargetSpec
	{
		public EncodingKind? Encoding { get; set; }
		public EolKind? Eol { get; set; }
	}

	/// <summary>
	/// 用途名・文字コード名・改行名の対応。
	/// </summary>
	internal static class Spec
	{
		/// <summary>
		/// 用途名。ファイルの種類ごとに文字コードと改行の両方が決まる。
		/// 新しい種類を足すときは、ここへ 1 行加えるだけでよい。
		/// </summary>
		private static readonly Dictionary<string, TargetSpec> Profiles =
			new Dictionary<string, TargetSpec>(StringComparer.OrdinalIgnoreCase)
			{
				{ "ps1",  Make(EncodingKind.Utf8Bom, EolKind.CrLf) },
				{ "cmd",  Make(EncodingKind.Sjis,    EolKind.CrLf) },
				{ "bat",  Make(EncodingKind.Sjis,    EolKind.CrLf) },
				{ "reg",  Make(EncodingKind.Utf16Le, EolKind.CrLf) },
				{ "html", Make(EncodingKind.Utf8Bom, EolKind.Lf)   }
			};

		private static readonly Dictionary<string, EncodingKind> Encodings =
			new Dictionary<string, EncodingKind>(StringComparer.OrdinalIgnoreCase)
			{
				{ "utf8",    EncodingKind.Utf8    },
				{ "utf8bom", EncodingKind.Utf8Bom },
				{ "sjis",    EncodingKind.Sjis    },
				{ "utf16le", EncodingKind.Utf16Le },
				{ "utf16be", EncodingKind.Utf16Be }
			};

		private static readonly Dictionary<string, EolKind> Eols =
			new Dictionary<string, EolKind>(StringComparer.OrdinalIgnoreCase)
			{
				{ "lf",   EolKind.Lf   },
				{ "crlf", EolKind.CrLf }
			};

		private static TargetSpec Make(EncodingKind enc, EolKind eol)
		{
			TargetSpec s = new TargetSpec();
			s.Encoding = enc;
			s.Eol = eol;
			return s;
		}

		/// <summary>
		/// --to の値を解釈する。「用途名」「文字コード」「/改行」およびその組み合わせを受ける。
		/// </summary>
		public static bool TryParseTarget(string text, out TargetSpec spec, out string error)
		{
			spec = null;
			error = null;

			if (string.IsNullOrEmpty(text))
			{
				error = "--to に値がありません。";
				return false;
			}

			string head = text;
			string tail = null;
			int slash = text.IndexOf('/');
			if (slash >= 0)
			{
				head = text.Substring(0, slash);
				tail = text.Substring(slash + 1);
			}

			TargetSpec result = new TargetSpec();

			// 前半は空でもよい（"/crlf" のように改行だけ指定する形）
			if (head.Length > 0)
			{
				TargetSpec profile;
				if (Profiles.TryGetValue(head, out profile))
				{
					result.Encoding = profile.Encoding;
					result.Eol = profile.Eol;
				}
				else
				{
					EncodingKind enc;
					if (!Encodings.TryGetValue(head, out enc))
					{
						error = string.Format(
							"--to に指定できない名前です: {0}{1}使える名前: {2}",
							head, Environment.NewLine, DescribeTargetNames());
						return false;
					}
					result.Encoding = enc;
				}
			}

			// 後半があれば改行を上書きする
			if (tail != null)
			{
				EolKind eol;
				if (!Eols.TryGetValue(tail, out eol))
				{
					error = string.Format(
						"改行の指定が正しくありません: {0}{1}使える名前: lf crlf",
						tail, Environment.NewLine);
					return false;
				}
				result.Eol = eol;
			}

			if (result.Encoding == null && result.Eol == null)
			{
				error = "--to の指定が空です。";
				return false;
			}

			spec = result;
			return true;
		}

		/// <summary>
		/// --from の値を解釈する。文字コードだけを受け、改行の指定は認めない。
		/// 用途名も受け付ける（--to と同じ語彙で書けるようにするため）。
		/// </summary>
		public static bool TryParseSource(string text, out EncodingKind kind, out string error)
		{
			kind = EncodingKind.Utf8;
			error = null;

			if (string.IsNullOrEmpty(text))
			{
				error = "--from に値がありません。";
				return false;
			}

			if (text.IndexOf('/') >= 0)
			{
				error = "--from に改行は指定できません。読み込みでは改行を区別しません。";
				return false;
			}

			TargetSpec profile;
			if (Profiles.TryGetValue(text, out profile))
			{
				kind = profile.Encoding.Value;
				return true;
			}

			if (Encodings.TryGetValue(text, out kind))
			{
				return true;
			}

			error = string.Format(
				"--from に指定できない名前です: {0}{1}使える名前: {2}",
				text, Environment.NewLine, DescribeSourceNames());
			return false;
		}

		public static string DescribeTargetNames()
		{
			return "用途名 ps1 cmd bat reg html ／ 文字コード utf8 utf8bom sjis utf16le utf16be"
				+ " ／ 改行を足すときは /lf /crlf";
		}

		public static string DescribeSourceNames()
		{
			return "utf8 utf8bom sjis utf16le utf16be（用途名 ps1 cmd bat reg html も可）";
		}

		/// <summary>表示用の名前。</summary>
		public static string NameOf(EncodingKind kind)
		{
			switch (kind)
			{
				case EncodingKind.Utf8: return "UTF8";
				case EncodingKind.Utf8Bom: return "UTF8BOM";
				case EncodingKind.Sjis: return "SJIS";
				case EncodingKind.Utf16Le: return "UTF16LE";
				case EncodingKind.Utf16Be: return "UTF16BE";
				default: return "?";
			}
		}

		public static string NameOf(EolKind eol)
		{
			return eol == EolKind.CrLf ? "CRLF" : "LF";
		}
	}
}
