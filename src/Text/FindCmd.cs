using System;
using System.Collections.Generic;
using System.IO;
using System.Text;
using System.Text.RegularExpressions;

namespace TextTool
{
	/// <summary>text find — 文字コードを問わず素の文字列を探す。◎/■/◆ の入れ子で出す。</summary>
	internal static class FindCmd
	{
		private static readonly HashSet<string> ValueOpts =
			new HashSet<string>(StringComparer.Ordinal)
			{ "--path", "--include", "--exclude", "--exclude-dir", "--from" };

		private sealed class Hit { public int LineNo; public string Content; }
		private sealed class FileHits
		{
			public string Rel; public string Sub; public string Name;
			public string Combo; public long Size; public string Mtime;
			public List<Hit> Hits = new List<Hit>();
		}

		public static int Run(string[] a)
		{
			Args args = Args.Parse(a, ValueOpts);
			if (args.Positional.Count < 1) { throw new ToolError(2, "検索語を指定してください。"); }
			string keyword = args.Positional[0];
			if (keyword.Length == 0) { throw new ToolError(2, "検索語が空です。"); }

			string basePath = args.Get("--path");
			if (basePath == null) { basePath = "."; }
			bool recurse = args.Flag("-r", "--recurse");
			bool ignoreCase = args.Flag("-i", "--ignore-case");
			bool bare = args.Flag("--bare", "--bare");
			string from = args.Get("--from");

			List<Regex> inc = Globs(args.Get("--include"));
			List<Regex> exc = Globs(args.Get("--exclude"));
			HashSet<string> excDir = DirSet(args.Get("--exclude-dir"));

			string baseFull = Path.GetFullPath(basePath);
			bool baseIsFile = File.Exists(basePath);

			List<string> targets = new List<string>();
			if (baseIsFile) { targets.Add(Path.GetFullPath(basePath)); }
			else if (Directory.Exists(basePath)) { Walk(baseFull, recurse, inc, exc, excDir, targets); }
			else { throw new ToolError(2, "対象がありません: " + Files.Show(basePath)); }

			StringComparison cmp = ignoreCase ? StringComparison.OrdinalIgnoreCase : StringComparison.Ordinal;
			List<FileHits> results = new List<FileHits>();

			foreach (string file in targets)
			{
				try
				{
					FileHits fh = Scan(file, baseFull, baseIsFile, from, keyword, cmp);
					if (fh != null && fh.Hits.Count > 0) { results.Add(fh); }
				}
				catch { /* 読めないファイルは飛ばす */ }
			}

			if (results.Count == 0) { return 1; }

			if (bare) { OutputBare(results); }
			else { OutputGrouped(basePath, keyword, args, recurse, ignoreCase, results); }
			return 0;
		}

		private static FileHits Scan(string file, string baseFull, bool baseIsFile,
			string from, string keyword, StringComparison cmp)
		{
			byte[] bytes = File.ReadAllBytes(file);
			Combo combo = Files.Resolve(bytes, from);
			if (Detector.LooksBinary(bytes, combo.Enc)) { return null; }
			string text = Codec.Decode(bytes, combo.Enc);
			List<Line> lines = Lines.Split(text);

			FileHits fh = new FileHits();
			for (int i = 0; i < lines.Count; i++)
			{
				string content = Lines.Content(text, lines[i]);
				if (content.IndexOf(keyword, cmp) >= 0)
				{
					Hit h = new Hit(); h.LineNo = i + 1; h.Content = content;
					fh.Hits.Add(h);
				}
			}
			if (fh.Hits.Count == 0) { return fh; }

			string rel = baseIsFile ? Path.GetFileName(file) : RelPath(baseFull, file);
			fh.Rel = rel;
			int slash = rel.LastIndexOf('/');
			fh.Sub = slash < 0 ? "." : rel.Substring(0, slash);
			fh.Name = slash < 0 ? rel : rel.Substring(slash + 1);
			fh.Combo = combo.Name();
			fh.Size = bytes.LongLength;
			fh.Mtime = Digest.Mtime(File.GetLastWriteTime(file));
			return fh;
		}

		private static void OutputGrouped(string basePath, string keyword, Args args,
			bool recurse, bool ignoreCase, List<FileHits> results)
		{
			results.Sort(delegate (FileHits x, FileHits y)
			{
				int c = string.Compare(x.Sub, y.Sub, StringComparison.Ordinal);
				return c != 0 ? c : string.Compare(x.Name, y.Name, StringComparison.Ordinal);
			});

			Io.Out("◎\"" + Files.Show(basePath) + "\"");
			StringBuilder opt = new StringBuilder("  検索=\"" + keyword + "\"");
			if (args.Get("--include") != null) { opt.Append("  対象=\"").Append(args.Get("--include")).Append("\""); }
			if (recurse) { opt.Append("  再帰"); }
			if (!ignoreCase) { opt.Append("  大小区別"); }
			Io.Out(opt.ToString());

			string curSub = null;
			foreach (FileHits fh in results)
			{
				if (!string.Equals(curSub, fh.Sub, StringComparison.Ordinal))
				{
					Io.Out("■\"" + fh.Sub + "\"");
					curSub = fh.Sub;
				}
				Io.Out("◆\"" + fh.Name + "\" [" + fh.Combo + "] size=" + fh.Size + " mtime=" + fh.Mtime);
				foreach (Hit h in fh.Hits)
				{
					string num = h.LineNo.ToString();
					if (num.Length < 6) { num = new string(' ', 6 - num.Length) + num; }
					Io.Out(num + ":\t" + h.Content);
				}
			}
		}

		private static void OutputBare(List<FileHits> results)
		{
			foreach (FileHits fh in results)
			{
				foreach (Hit h in fh.Hits)
				{
					Io.Out(fh.Rel + ":" + h.LineNo + ":" + h.Content);
				}
			}
		}

		private static void Walk(string dir, bool recurse, List<Regex> inc, List<Regex> exc,
			HashSet<string> excDir, List<string> outFiles)
		{
			string[] files;
			try { files = Directory.GetFiles(dir); } catch { return; }
			foreach (string f in files)
			{
				string name = Path.GetFileName(f);
				if (inc.Count > 0 && !MatchAny(inc, name)) { continue; }
				if (exc.Count > 0 && MatchAny(exc, name)) { continue; }
				outFiles.Add(f);
			}
			if (!recurse) { return; }
			string[] dirs;
			try { dirs = Directory.GetDirectories(dir); } catch { return; }
			foreach (string sub in dirs)
			{
				string name = Path.GetFileName(sub);
				if (name == ".git") { continue; }
				if (name.StartsWith("_", StringComparison.Ordinal)) { continue; }
				if (excDir.Contains(name)) { continue; }
				Walk(sub, true, inc, exc, excDir, outFiles);
			}
		}

		private static string RelPath(string baseFull, string file)
		{
			string b = baseFull.Replace('\\', '/').TrimEnd('/');
			string f = Path.GetFullPath(file).Replace('\\', '/');
			if (f.StartsWith(b + "/", StringComparison.OrdinalIgnoreCase))
			{
				return f.Substring(b.Length + 1);
			}
			return f;
		}

		private static List<Regex> Globs(string csv)
		{
			List<Regex> list = new List<Regex>();
			if (string.IsNullOrEmpty(csv)) { return list; }
			foreach (string part in csv.Split(','))
			{
				string g = part.Trim();
				if (g.Length == 0) { continue; }
				list.Add(new Regex(GlobToRegex(g), RegexOptions.IgnoreCase));
			}
			return list;
		}

		private static HashSet<string> DirSet(string csv)
		{
			HashSet<string> set = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
			if (string.IsNullOrEmpty(csv)) { return set; }
			foreach (string part in csv.Split(','))
			{
				string d = part.Trim();
				if (d.Length > 0) { set.Add(d); }
			}
			return set;
		}

		private static bool MatchAny(List<Regex> pats, string name)
		{
			foreach (Regex r in pats) { if (r.IsMatch(name)) { return true; } }
			return false;
		}

		private static string GlobToRegex(string glob)
		{
			StringBuilder sb = new StringBuilder("^");
			foreach (char ch in glob)
			{
				if (ch == '*') { sb.Append(".*"); }
				else if (ch == '?') { sb.Append('.'); }
				else { sb.Append(Regex.Escape(ch.ToString())); }
			}
			sb.Append('$');
			return sb.ToString();
		}
	}
}
