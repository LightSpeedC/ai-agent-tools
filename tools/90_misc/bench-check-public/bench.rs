// check-public の検査を Rust で書いた見積もり用の実装。
// 条件は bench.cs ・ bench.js と同じ（同じフォルダ・同じ拡張子・同じ 4 つの検査）。
//
// 外部クレートを使わずに rustc だけでビルドできる形にしてある。
// regex クレートが無いため、4 つの検査は手書きの走査で表現している。
// 正規表現エンジンの差がそのまま速度差になるのを避ける意図もある。

use std::collections::VecDeque;
use std::fs;
use std::path::{Path, PathBuf};
use std::time::Instant;

const EXTS: [&str; 8] = [".cs", ".ps1", ".md", ".html", ".cmd", ".txt", ".json", ".js"];
const SKIP_DIRS: [&str; 4] = [".git", "tmp", "etc", "node_modules"];

fn is_mail_local(c: char) -> bool {
	c.is_ascii_alphanumeric() || c == '.' || c == '_' || c == '%' || c == '+' || c == '-'
}

fn is_domain(c: char) -> bool {
	c.is_ascii_alphanumeric() || c == '.' || c == '-'
}

// 1. メールアドレス
fn has_mail(line: &str) -> bool {
	let b: Vec<char> = line.chars().collect();
	for i in 0..b.len() {
		if b[i] != '@' || i == 0 || i + 1 >= b.len() {
			continue;
		}
		if !is_mail_local(b[i - 1]) {
			continue;
		}
		let mut j = i + 1;
		let mut dot = false;
		let mut tail = 0;
		while j < b.len() && is_domain(b[j]) {
			if b[j] == '.' {
				dot = true;
				tail = 0;
			} else {
				tail += 1;
			}
			j += 1;
		}
		if dot && tail >= 2 {
			return true;
		}
	}
	false
}

// 2. C:\Users\ の直後がプレースホルダでないもの
fn has_user_path(line: &str) -> bool {
	let lower = line.to_ascii_lowercase();
	let mut from = 0;
	while let Some(pos) = lower[from..].find("c:\\users\\") {
		let at = from + pos + "c:\\users\\".len();
		match line[at..].chars().next() {
			Some(c) if c != '<' && c != '%' && c != '$' && (c.is_ascii_alphanumeric() || c == '.' || c == '_' || c == '-') => {
				return true
			}
			_ => {}
		}
		from = at;
	}
	false
}

// 3. 認証情報に値が続くもの
fn has_secret(line: &str) -> bool {
	let lower = line.to_ascii_lowercase();
	for key in ["password", "passwd", "secret", "api_key", "token"].iter() {
		let mut from = 0;
		while let Some(pos) = lower[from..].find(key) {
			let mut at = from + pos + key.len();
			let b: Vec<char> = lower[at..].chars().collect();
			let mut k = 0;
			while k < b.len() && b[k] == ' ' {
				k += 1;
			}
			if k < b.len() && (b[k] == ':' || b[k] == '=') {
				k += 1;
				while k < b.len() && b[k] == ' ' {
					k += 1;
				}
				let mut len = 0;
				while k + len < b.len() {
					let c = b[k + len];
					if c.is_whitespace() || c == '"' || c == '\'' || c == '<' || c == '$' || c == '%' || c == '{' {
						break;
					}
					len += 1;
				}
				if len >= 4 {
					return true;
				}
			}
			at = from + pos + key.len();
			from = at;
		}
	}
	false
}

// 5. キリル・ハングルの混入
fn has_foreign(line: &str) -> bool {
	line.chars().any(|c| {
		let n = c as u32;
		(0x0400..=0x04FF).contains(&n) || (0xAC00..=0xD7AF).contains(&n)
	})
}

fn walk(root: &Path, out: &mut Vec<PathBuf>) {
	let mut dirs: VecDeque<PathBuf> = VecDeque::new();
	dirs.push_back(root.to_path_buf());
	while let Some(dir) = dirs.pop_back() {
		if let Some(name) = dir.file_name().and_then(|s| s.to_str()) {
			if SKIP_DIRS.contains(&name) {
				continue;
			}
		}
		let entries = match fs::read_dir(&dir) {
			Ok(e) => e,
			Err(_) => continue,
		};
		for e in entries.flatten() {
			let p = e.path();
			if p.is_dir() {
				dirs.push_back(p);
				continue;
			}
			if let Some(name) = p.file_name().and_then(|s| s.to_str()) {
				let lower = name.to_ascii_lowercase();
				if EXTS.iter().any(|x| lower.ends_with(x)) {
					out.push(p);
				}
			}
		}
	}
}

fn main() {
	let args: Vec<String> = std::env::args().collect();
	if args.len() < 2 {
		eprintln!("使い方: bench-rs.exe <対象フォルダ>");
		std::process::exit(2);
	}
	let start = Instant::now();

	let mut paths: Vec<PathBuf> = Vec::new();
	walk(Path::new(&args[1]), &mut paths);

	let mut files = 0;
	let mut lines = 0;
	let mut hits = 0;

	for p in &paths {
		files += 1;
		let text = match fs::read_to_string(p) {
			Ok(t) => t,
			Err(_) => continue,
		};
		for line in text.lines() {
			lines += 1;
			if has_mail(line) {
				hits += 1;
			}
			if has_user_path(line) {
				hits += 1;
			}
			if has_secret(line) {
				hits += 1;
			}
			if has_foreign(line) {
				hits += 1;
			}
		}
	}

	let ms = start.elapsed().as_millis();
	println!("files={} lines={} hits={} inner_ms={}", files, lines, hits, ms);
}
