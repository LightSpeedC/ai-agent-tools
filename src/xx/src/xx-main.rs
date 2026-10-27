/*
	引数のコマンドを別プロセスで実行し、出力の文字コードを判定して UTF-8 で返す（計画 p261027-01）。
	内部ツール。使い方の資料には載せない。

	    xx <コマンド> [引数...]

	決め（計画 p261027-01 の 73 〜 77）:
	  ・子プロセスとして起動し、終わるまで待つ。終了コードはそのまま返す
	  ・子の標準入力は EOF（待たされて固まらない）
	  ・標準出力は標準出力へ、標準エラーは標準エラーへ。混ぜない
	  ・出力の文字コード（UTF-8 ・ UTF-16 BOM あり ・ CP932）を判定し、常に UTF-8 で出す。
	    判定が付かなければそのまま流す
	  ・コンソールのコードページは変えない（共通ルール）
	  ・見つからない・起動できないときは 127、引数が無いときは 2
*/

use std::ffi::OsString;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};

/// 引数が無い
const EXIT_BAD_ARGS: i32 = 2;
/// 見つからない・起動できない（シェルの慣習）
const EXIT_NOT_FOUND: i32 = 127;
/// 拡張子の無い名前を探す順
const EXTENSIONS: [&str; 4] = ["exe", "cmd", "bat", "ps1"];

/*
	子の出力を UTF-8 にする。受けたバイト列の全体を見て、1 回で判定する。

	  1. 先頭が UTF-8 の BOM        → BOM を除いて出す
	  2. 先頭が UTF-16 の BOM       → UTF-8 にして出す
	  3. 全体が正しい UTF-8         → そのまま出す（ASCII だけの場合を含む）
	  4. CP932 として誤りなく読める → UTF-8 にして出す
	  5. どれでもない               → 判定が付かない。そのまま流す
*/
fn to_utf8(buf: &[u8]) -> Vec<u8> {
	if buf.starts_with(&[0xEF, 0xBB, 0xBF]) {
		return buf[3..].to_vec();
	}
	if buf.starts_with(&[0xFF, 0xFE]) {
		let (s, _) = encoding_rs::UTF_16LE.decode_without_bom_handling(&buf[2..]);
		return s.into_owned().into_bytes();
	}
	if buf.starts_with(&[0xFE, 0xFF]) {
		let (s, _) = encoding_rs::UTF_16BE.decode_without_bom_handling(&buf[2..]);
		return s.into_owned().into_bytes();
	}
	if std::str::from_utf8(buf).is_ok() {
		return buf.to_vec();
	}
	// CP932 は encoding_rs の SHIFT_JIS（WHATWG の shift_jis。Windows-31J の表）。誤りがあれば判定が付かない
	let (s, had_errors) = encoding_rs::SHIFT_JIS.decode_without_bom_handling(buf);
	if had_errors {
		buf.to_vec()
	} else {
		s.into_owned().into_bytes()
	}
}

/// 名前から、試す名前の並びを作る。拡張子が .exe ・ .cmd ・ .bat ・ .ps1 ならそのまま、
/// 無ければその 4 つを順に付ける
fn candidate_names(name: &str) -> Vec<String> {
	let lower = name.to_ascii_lowercase();
	if EXTENSIONS.iter().any(|e| lower.ends_with(&format!(".{}", e))) {
		vec![name.to_string()]
	} else {
		EXTENSIONS.iter().map(|e| format!("{}.{}", name, e)).collect()
	}
}

/// PATH の各フォルダ（区切りを含む名前ならそのまま）から、実在する最初のものを返す。
/// 順は、フォルダごとに拡張子を試す（Windows の探し方と同じ）
fn resolve(name: &str, dirs: &[PathBuf], exists: &dyn Fn(&Path) -> bool) -> Option<PathBuf> {
	let has_separator = name.contains('/') || name.contains('\\');
	let bases: Vec<PathBuf> = if has_separator { vec![PathBuf::new()] } else { dirs.to_vec() };
	for base in &bases {
		for candidate in candidate_names(name) {
			let path = base.join(&candidate);
			if exists(&path) {
				return Some(path);
			}
		}
	}
	None
}

/// 実行するもの（プログラムと、その前に挟む引数）を決める。
/// .ps1 は powershell -File で、それ以外（.exe ・ .cmd ・ .bat）は直接
fn invocation(path: &Path, args: &[OsString]) -> (OsString, Vec<OsString>) {
	let is_ps1 = path.extension().map(|e| e.eq_ignore_ascii_case("ps1")).unwrap_or(false);
	if is_ps1 {
		let mut all: Vec<OsString> = ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File"].iter().map(OsString::from).collect();
		all.push(path.as_os_str().to_os_string());
		all.extend(args.iter().cloned());
		(OsString::from("powershell"), all)
	} else {
		// .cmd ・ .bat も直接渡す。Rust の標準ライブラリが cmd.exe 経由で起動し、引数の引用も直す
		(path.as_os_str().to_os_string(), args.to_vec())
	}
}

fn write_err(s: &str) {
	let mut e = std::io::stderr().lock();
	let _ = e.write_all(s.as_bytes());
	let _ = e.flush();
}

fn main() {
	let args: Vec<OsString> = std::env::args_os().skip(1).collect();
	if args.is_empty() {
		write_err("使い方: xx <コマンド> [引数...]\n");
		std::process::exit(EXIT_BAD_ARGS);
	}

	let name = args[0].to_string_lossy().into_owned();
	let dirs: Vec<PathBuf> = std::env::var_os("PATH").map(|p| std::env::split_paths(&p).collect()).unwrap_or_default();
	let path = match resolve(&name, &dirs, &|p: &Path| p.is_file()) {
		Some(p) => p,
		None => {
			write_err(&format!("[NG] コマンドが見つかりません: {}\n", name));
			std::process::exit(EXIT_NOT_FOUND);
		}
	};

	let (program, full_args) = invocation(&path, &args[1..]);
	// 標準入力は閉じる（EOF）。出力は別々に受け、終わるまで待つ
	let output = match Command::new(&program).args(&full_args).stdin(Stdio::null()).output() {
		Ok(o) => o,
		Err(e) => {
			write_err(&format!("[NG] {} を起動できません: {}\n", name, e));
			std::process::exit(EXIT_NOT_FOUND);
		}
	};

	// 窓に直接書くときは Rust の標準ライブラリが UTF-16 で書くため、コードページに関係なく化けない。
	// リダイレクトされていれば UTF-8 のバイト列のまま
	{
		let mut o = std::io::stdout().lock();
		let _ = o.write_all(&to_utf8(&output.stdout));
		let _ = o.flush();
	}
	{
		let mut e = std::io::stderr().lock();
		let _ = e.write_all(&to_utf8(&output.stderr));
		let _ = e.flush();
	}

	// 終了コードは 32 ビットのまま返す（シグナルなどで取れないときは起動失敗と同じ扱い）
	std::process::exit(output.status.code().unwrap_or(EXIT_NOT_FOUND));
}

#[cfg(test)]
mod tests {
	use super::{candidate_names, invocation, resolve, to_utf8};
	use std::ffi::OsString;
	use std::path::{Path, PathBuf};

	// 期待値は手で書いた。psh の Rust 版の decode と同じバイト列の書き方

	#[test]
	fn 空は空のまま() {
		assert_eq!(to_utf8(&[]), Vec::<u8>::new());
	}

	#[test]
	fn ascii_だけはそのまま() {
		assert_eq!(to_utf8(b"abc\r\n"), b"abc\r\n".to_vec());
	}

	#[test]
	fn utf8_はそのまま() {
		let b = [0xE3, 0x81, 0x82, 0xE3, 0x81, 0x84, 0x0A];
		assert_eq!(to_utf8(&b), b.to_vec());
	}

	#[test]
	fn utf8_の_bom_を除く() {
		assert_eq!(to_utf8(&[0xEF, 0xBB, 0xBF, 0xE3, 0x81, 0x82]), vec![0xE3, 0x81, 0x82]);
	}

	#[test]
	fn cp932_を_utf8_にする() {
		assert_eq!(to_utf8(&[0x82, 0xA0, 0x82, 0xA2, 0x0D, 0x0A]), "あい\r\n".as_bytes().to_vec());
	}

	#[test]
	fn cp932_の半角カナを_utf8_にする() {
		assert_eq!(to_utf8(&[0xB1, 0xB2]), "ｱｲ".as_bytes().to_vec());
	}

	#[test]
	fn utf16_le_の_bom_ありを_utf8_にする() {
		assert_eq!(to_utf8(&[0xFF, 0xFE, 0x42, 0x30, 0x44, 0x30]), "あい".as_bytes().to_vec());
	}

	#[test]
	fn utf16_be_の_bom_ありを_utf8_にする() {
		assert_eq!(to_utf8(&[0xFE, 0xFF, 0x30, 0x42, 0x30, 0x44]), "あい".as_bytes().to_vec());
	}

	#[test]
	fn どれでもなければそのまま流す() {
		// 0xFF 0xFF は UTF-8 でも CP932 でも読めず、UTF-16 の BOM でもない
		let b = [0x41, 0xFF, 0xFF, 0x42];
		assert_eq!(to_utf8(&b), b.to_vec());
	}

	#[test]
	fn 拡張子が無ければ四つを順に付ける() {
		assert_eq!(candidate_names("psls"), vec!["psls.exe", "psls.cmd", "psls.bat", "psls.ps1"]);
	}

	#[test]
	fn 拡張子があればそのまま() {
		assert_eq!(candidate_names("a.cmd"), vec!["a.cmd"]);
		assert_eq!(candidate_names("A.PS1"), vec!["A.PS1"]);
	}

	fn dirs() -> Vec<PathBuf> {
		vec![PathBuf::from("d1"), PathBuf::from("d2")]
	}

	#[test]
	fn フォルダごとに拡張子を試す() {
		// d1 に .cmd、d2 に .exe がある。Windows と同じく先のフォルダが勝つ
		let exists = |p: &Path| p == Path::new("d1").join("t.cmd") || p == Path::new("d2").join("t.exe");
		assert_eq!(resolve("t", &dirs(), &exists), Some(Path::new("d1").join("t.cmd")));
	}

	#[test]
	fn 同じフォルダでは_exe_が先() {
		let exists = |p: &Path| p == Path::new("d1").join("t.cmd") || p == Path::new("d1").join("t.exe");
		assert_eq!(resolve("t", &dirs(), &exists), Some(Path::new("d1").join("t.exe")));
	}

	#[test]
	fn 区切りを含む名前は_path_を見ない() {
		let exists = |p: &Path| p == Path::new("sub/t.exe") || p == Path::new("d1").join("sub/t.exe");
		assert_eq!(resolve("sub/t", &dirs(), &exists), Some(PathBuf::from("sub/t.exe")));
	}

	#[test]
	fn どこにも無ければ_none() {
		assert_eq!(resolve("t", &dirs(), &|_: &Path| false), None);
	}

	#[test]
	fn ps1_は_powershell_の_file_で呼ぶ() {
		let (prog, args) = invocation(Path::new("a.ps1"), &[OsString::from("x y")]);
		assert_eq!(prog, OsString::from("powershell"));
		let want: Vec<OsString> = ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", "a.ps1", "x y"]
			.iter()
			.map(OsString::from)
			.collect();
		assert_eq!(args, want);
	}

	#[test]
	fn exe_と_cmd_は直接呼ぶ() {
		for f in ["a.exe", "a.cmd", "a.bat"] {
			let (prog, args) = invocation(Path::new(f), &[OsString::from("1")]);
			assert_eq!(prog, OsString::from(f));
			assert_eq!(args, vec![OsString::from("1")]);
		}
	}
}
