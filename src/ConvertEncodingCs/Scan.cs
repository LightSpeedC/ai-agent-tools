using System;
using System.Collections.Generic;
using System.IO;
using System.Text;

namespace ConvertEncoding
{
	/// <summary>1 ファイルを見た結果。</summary>
	internal sealed class ScanEntry
	{
		/// <summary>表示に使う名前。フォルダを渡したときはそこからの相対パス（区切りは /）。</summary>
		public string Display;
		public EncodingKind Kind;
		public int CrLf;
		public int Lf;
		public int Cr;
		public long Size;

		/// <summary>純 ASCII（utf8 と sjis でバイト列が同じ）。</summary>
		public bool Ascii;

		/// <summary>あるべき組の呼び名。拡張子をそのまま使う（ps1・cmd・ts・txt）。</summary>
		public string RuleName;
		public EncodingKind WantKind;

		/// <summary>あるべき改行。null は「定めていないので問わない」。</summary>
		public EolKind? WantEol;

		/// <summary>文字コードが規約と違う。</summary>
		public bool EncBad;
		/// <summary>改行が規約と違う（混在・単独 CR を含む）。</summary>
		public bool EolBad;

		public bool Bad { get { return EncBad || EolBad; } }
	}

	/// <summary>
	/// フォルダの下を再帰して、1 ファイルずつ文字コードと改行を見る。
	/// 書き込みは行わない（--info ・ --check の土台）。
	/// </summary>
	internal static class Scan
	{
		/// <summary>既定で見ないフォルダ。生成物と一時物。</summary>
		private static readonly string[] DefaultExcludeDirs =
			new string[] { "tmp", "etc", "node_modules", ".git" };

		/// <summary>
		/// 改行を LF と定めている拡張子。自分たちが書くものを挙げる。
		/// ここにも下の switch にも無い拡張子（txt・log・csv 等）は
		/// <strong>改行を問わない</strong>。.gitattributes の「* text=auto eol=lf」で
		/// git に入る時点で LF に正規化されるため、作業ツリーの改行まで縛る実益が薄い
		/// （手で CRLF にした txt が毎回違反に出てしまう）。
		/// 文字コードは git が変換しないので、そちらは拡張子によらず見る。
		/// </summary>
		private static readonly string[] LfExtensions = new string[]
		{
			"md", "js", "mjs", "cjs", "ts", "tsx", "jsx", "json", "jsonc",
			"css", "scss", "cs", "go", "rs", "py", "rb", "java", "sql",
			"yml", "yaml", "toml", "sh", "svg", "xml", "gitignore", "editorconfig"
		};

		/// <summary>
		/// 拡張子ごとのあるべき組。文字コードは、ここに無いものを
		/// 「BOM 無し UTF-8」として見る（.editorconfig の [*]）。
		/// 改行は LfExtensions と下の switch に挙げたものだけを見る。
		/// </summary>
		public static void RuleFor(string path, out string name, out EncodingKind kind, out EolKind? eol)
		{
			string ext = Path.GetExtension(path);
			if (ext == null) { ext = ""; }
			ext = ext.TrimStart('.').ToLowerInvariant();

			// 呼び名は拡張子そのもの。用途名を別に持つと、用途名の無い
			// ts・md を「既定」と呼ぶことになり、何に対する規約か読めなくなる
			name = (ext.Length > 0) ? ext : "既定";

			switch (ext)
			{
				case "ps1":
					kind = EncodingKind.Utf8Bom; eol = EolKind.CrLf; return;
				case "cmd":
				case "bat":
					kind = EncodingKind.Sjis; eol = EolKind.CrLf; return;
				case "reg":
					kind = EncodingKind.Utf16Le; eol = EolKind.CrLf; return;
				case "html":
				case "htm":
					kind = EncodingKind.Utf8Bom; eol = EolKind.Lf; return;
				default:
					kind = EncodingKind.Utf8;
					eol = ContainsName(LfExtensions, ext) ? (EolKind?)EolKind.Lf : null;
					return;
			}
		}

		/// <summary>
		/// フォルダの下のファイルを集める。見ないもの（既定のフォルダ・先頭 _ ・
		/// 読めないもの・バイナリ）はここで落とす。
		/// </summary>
		public static List<ScanEntry> Walk(string root, List<string> include, List<string> exclude, List<string> excludeDirs)
		{
			List<string> skipDirs = new List<string>(DefaultExcludeDirs);
			if (excludeDirs != null) { skipDirs.AddRange(excludeDirs); }

			List<string> files = new List<string>();
			Collect(root, skipDirs, files);
			files.Sort(StringComparer.OrdinalIgnoreCase);

			string prefix = Path.GetFullPath(root);
			if (!prefix.EndsWith("\\") && !prefix.EndsWith("/")) { prefix += Path.DirectorySeparatorChar; }

			List<ScanEntry> result = new List<ScanEntry>();
			for (int i = 0; i < files.Count; i++)
			{
				string file = files[i];
				string name = Path.GetFileName(file);

				if (include != null && include.Count > 0 && !MatchAny(name, include)) { continue; }
				if (exclude != null && exclude.Count > 0 && MatchAny(name, exclude)) { continue; }

				string display = Path.GetFullPath(file);
				if (display.StartsWith(prefix, StringComparison.OrdinalIgnoreCase))
				{
					display = display.Substring(prefix.Length);
				}
				display = display.Replace('\\', '/');

				ScanEntry entry = Inspect(file, display);
				if (entry != null) { result.Add(entry); }
			}
			return result;
		}

		/// <summary>
		/// 1 ファイルを見る。読めない・判定できない・バイナリなら null（見なかった扱い）。
		/// </summary>
		public static ScanEntry Inspect(string path, string display)
		{
			byte[] bytes;
			try
			{
				bytes = File.ReadAllBytes(path);
			}
			catch (Exception)
			{
				return null;
			}

			EncodingKind kind;
			if (!Detector.TryDetect(bytes, out kind)) { return null; }
			if (LooksBinary(bytes, kind)) { return null; }

			string text = Converter.Decode(bytes, kind);

			ScanEntry e = new ScanEntry();
			e.Display = display;
			e.Kind = kind;
			e.Size = bytes.LongLength;
			e.Ascii = Converter.IsAscii(bytes);
			Converter.CountEol(text, out e.CrLf, out e.Lf, out e.Cr);

			string ruleName;
			EncodingKind wantKind;
			EolKind? wantEol;
			RuleFor(path, out ruleName, out wantKind, out wantEol);
			e.RuleName = ruleName;
			e.WantKind = wantKind;
			e.WantEol = wantEol;

			// 純 ASCII のときは UTF-8 と SJIS でバイト列が同じになる。判定はどちらかに
			// 寄るが、どちらでも規約どおりのバイト列なので違反にしない
			// （日本語を含まない cmd を SJIS でないと言わないため）
			e.EncBad = (kind != wantKind)
				&& !(e.Ascii && IsSingleByteNoBom(kind) && IsSingleByteNoBom(wantKind));

			// 改行が混ざっていれば、それだけで規約に合わない。単独の CR も同じ。
			// ここは拡張子によらず見る（どの種類でも事故のため）。
			// 改行がまったく無いファイルは、どちらとも言えないので合っている扱いにする。
			int kinds = 0;
			if (e.CrLf > 0) { kinds++; }
			if (e.Lf > 0) { kinds++; }
			if (e.Cr > 0) { kinds++; }

			if (kinds == 0) { e.EolBad = false; }
			else if (kinds > 1 || e.Cr > 0) { e.EolBad = true; }
			else if (!wantEol.HasValue) { e.EolBad = false; }   // 改行を定めていない拡張子
			else { e.EolBad = (wantEol.Value == EolKind.CrLf) ? (e.CrLf == 0) : (e.Lf == 0); }

			return e;
		}

		/// <summary>BOM を持たない単バイトの組。純 ASCII なら互いに同じバイト列になる。</summary>
		private static bool IsSingleByteNoBom(EncodingKind kind)
		{
			return kind == EncodingKind.Utf8 || kind == EncodingKind.Sjis;
		}

		/// <summary>UTF-16 でないのに NUL を含めばバイナリとみなす（text find と同じ判定）。</summary>
		private static bool LooksBinary(byte[] b, EncodingKind kind)
		{
			if (kind == EncodingKind.Utf16Le || kind == EncodingKind.Utf16Be) { return false; }
			for (int i = 0; i < b.Length; i++) { if (b[i] == 0x00) { return true; } }
			return false;
		}

		private static void Collect(string dir, List<string> skipDirs, List<string> files)
		{
			string[] entries;
			try
			{
				entries = Directory.GetFiles(dir);
			}
			catch (Exception)
			{
				return;
			}

			for (int i = 0; i < entries.Length; i++)
			{
				string name = Path.GetFileName(entries[i]);
				if (name.StartsWith("_")) { continue; }   // 共通ルールで全階層 Git 管理外
				files.Add(entries[i]);
			}

			string[] subs;
			try
			{
				subs = Directory.GetDirectories(dir);
			}
			catch (Exception)
			{
				return;
			}

			for (int i = 0; i < subs.Length; i++)
			{
				string name = Path.GetFileName(subs[i]);
				if (name.StartsWith("_")) { continue; }
				if (ContainsName(skipDirs, name)) { continue; }
				Collect(subs[i], skipDirs, files);
			}
		}

		private static bool ContainsName(IList<string> names, string name)
		{
			for (int i = 0; i < names.Count; i++)
			{
				if (string.Equals(names[i], name, StringComparison.OrdinalIgnoreCase)) { return true; }
			}
			return false;
		}

		private static bool MatchAny(string name, List<string> patterns)
		{
			for (int i = 0; i < patterns.Count; i++)
			{
				if (IsMatch(name, patterns[i])) { return true; }
			}
			return false;
		}

		/// <summary>
		/// * と ? だけを見る単純な照合。大小は区別しない。
		/// 正規表現へ組み替えると、パターンの記号がそのまま効いて驚きが出るため自前で持つ。
		/// </summary>
		public static bool IsMatch(string name, string pattern)
		{
			return IsMatch(name, 0, pattern, 0);
		}

		private static bool IsMatch(string s, int si, string p, int pi)
		{
			while (pi < p.Length)
			{
				char pc = p[pi];
				if (pc == '*')
				{
					// 末尾の * は残り全部に当たる
					if (pi + 1 == p.Length) { return true; }
					for (int k = si; k <= s.Length; k++)
					{
						if (IsMatch(s, k, p, pi + 1)) { return true; }
					}
					return false;
				}

				if (si >= s.Length) { return false; }
				if (pc != '?' && char.ToLowerInvariant(pc) != char.ToLowerInvariant(s[si])) { return false; }
				si++;
				pi++;
			}
			return si == s.Length;
		}

		/// <summary>
		/// --info の書き方。全件を同じ形で並べ、規約に合わないものには
		/// あるべき組を付け足す。終了コードは呼び出し側で常に 0 にする。
		/// </summary>
		public static string FormatInfo(List<ScanEntry> entries)
		{
			int wName = 0, wEnc = 0, wCrLf = 0, wLf = 0, wCr = 0;
			for (int i = 0; i < entries.Count; i++)
			{
				ScanEntry e = entries[i];
				wName = Math.Max(wName, e.Display.Length);
				wEnc = Math.Max(wEnc, EncNameOf(e).Length);
				wCrLf = Math.Max(wCrLf, e.CrLf.ToString().Length);
				wLf = Math.Max(wLf, e.Lf.ToString().Length);
				wCr = Math.Max(wCr, e.Cr.ToString().Length);
			}

			int bad = 0;
			StringBuilder sb = new StringBuilder();
			for (int i = 0; i < entries.Count; i++)
			{
				ScanEntry e = entries[i];
				if (e.Bad) { bad++; }

				sb.Append(e.Display.PadRight(wName));
				sb.Append("  ").Append(EncNameOf(e).PadRight(wEnc));
				sb.Append("  crlf=").Append(e.CrLf.ToString().PadRight(wCrLf));
				sb.Append("  lf=").Append(e.Lf.ToString().PadRight(wLf));
				sb.Append("  cr=").Append(e.Cr.ToString().PadRight(wCr));
				sb.Append("  ").Append(string.Format("{0:N0} bytes", e.Size));
				if (e.Bad) { sb.Append("  → ").Append(e.RuleName).Append(" は ").Append(DescribeDiff(e)); }
				sb.Append('\n');
			}

			sb.Append('\n');
			sb.Append(string.Format("=== {0} 件（うち規約に合わないもの {1} 件）===\n", entries.Count, bad));
			return sb.ToString();
		}

		/// <summary>
		/// --check の書き方。規約に合わないものだけを出す。
		/// </summary>
		public static string FormatCheck(List<ScanEntry> entries, out int bad)
		{
			List<ScanEntry> ng = new List<ScanEntry>();
			for (int i = 0; i < entries.Count; i++)
			{
				if (entries[i].Bad) { ng.Add(entries[i]); }
			}
			bad = ng.Count;

			int wName = 0, wNow = 0;
			for (int i = 0; i < ng.Count; i++)
			{
				wName = Math.Max(wName, ng[i].Display.Length);
				wNow = Math.Max(wNow, DescribeNow(ng[i]).Length);
			}

			StringBuilder sb = new StringBuilder();
			for (int i = 0; i < ng.Count; i++)
			{
				ScanEntry e = ng[i];
				sb.Append(e.Display.PadRight(wName));
				sb.Append("  ").Append(DescribeNow(e).PadRight(wNow));
				sb.Append("  → ").Append(e.RuleName).Append(" は ").Append(DescribeWant(e));
				sb.Append('\n');
			}

			if (bad == 0)
			{
				sb.Append("=== 規約どおりです ===\n");
			}
			else
			{
				sb.Append('\n');
				sb.Append(string.Format("=== {0} 件が規約に合いません ===\n", bad));
			}
			return sb.ToString();
		}

		/// <summary>
		/// いまの組の名前。純 ASCII は utf8 と sjis を区別できないので ascii と書く。
		/// </summary>
		private static string EncNameOf(ScanEntry e)
		{
			if (e.Ascii && IsSingleByteNoBom(e.Kind)) { return "ascii"; }
			return Spec.NameOf(e.Kind);
		}

		/// <summary>いまの組。utf8bom+lf の形。</summary>
		private static string DescribeNow(ScanEntry e)
		{
			return EncNameOf(e) + "+" + Converter.DescribeEol(e.CrLf, e.Lf, e.Cr);
		}

		/// <summary>
		/// あるべき組。utf8bom+crlf の形。改行を定めていない拡張子では組だけを書く
		/// （「+lf」と書くと、定めていないものを定めているように読めるため）。
		/// </summary>
		private static string DescribeWant(ScanEntry e)
		{
			string s = Spec.NameOf(e.WantKind);
			if (e.WantEol.HasValue) { s += "+" + Spec.NameOf(e.WantEol.Value); }
			else if (e.EolBad) { s += "（改行を混ぜない）"; }
			return s;
		}

		/// <summary>違うところだけを short に言う（--info の行末に足す用）。</summary>
		private static string DescribeDiff(ScanEntry e)
		{
			if (e.EncBad && e.EolBad) { return DescribeWant(e); }
			if (e.EncBad) { return Spec.NameOf(e.WantKind); }
			// 改行の違反は、定めている拡張子でしか立たない。混在・単独 CR のときは
			// 定めていない拡張子でも立つので、その場合はどちらかに寄せず lf を示す
			return e.WantEol.HasValue ? Spec.NameOf(e.WantEol.Value) : "改行を混ぜない";
		}
	}
}
