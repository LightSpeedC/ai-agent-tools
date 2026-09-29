/*
	PowerShell を呼んで、出力を UTF-8 に直して流す。src/psh/psh-main.ts の Rust 版（計画 p260929-01）。

	    psh <path.ps1> [引数...]         ps1 を実行する（引数は -File と同じ規則で渡す）
	    psh -c "<式>"                   PowerShell の式を実行する（--command も可）
	    psh --pwsh …                    pwsh（7）で走らせる

	TypeScript 版から動きを変えずに移した。Rust にしたのは次のため。

	  ・bun は動いている間、窓のコードページを 65001 にする。bun で動かした psh から
	    起動した PowerShell はその状態で動き、ps1 の中で SJIS を出す cmd の出力を
	    取り込むと化けた（実測）。この exe はコードページに触らない
	  ・bun 同士のパイプの文字化け（oven-sh/bun#43660）に当たらない
	  ・入口 → 処理系 → powershell のプロセスが 1 段減る

	決め（TypeScript 版と同じ）:
	  ・終了コードは素通しする（呼び元の 0/1/2 の契約を壊さない）
	  ・標準出力は標準出力へ、標準エラーは標準エラーへ。混ぜない
	  ・対象が無い・引数が無いときは 2 で止める。黙って成功しない
	  ・コンソールのコードページは変えない（共通ルール）
*/

use std::ffi::OsString;
use std::io::Write;
use std::path::Path;
use std::process::{Command, ExitCode, Stdio};

/// 引数の誤り・対象が無い。html2md 系の契約に合わせる
const EXIT_BAD_ARGS: u8 = 2;

/*
	使い方を出す。

	求められて出すとき（--help）は標準出力へ、誤用を指したとき（引数なし）は
	標準エラーへ出す。読みたくて呼んだものを、エラーの側へ流さない。
*/
fn usage(to_stdout: bool) {
	let text = "PowerShell を呼んで、出力を UTF-8 に直して流します。\n\
\n\
  psh <path.ps1> [引数...]     ps1 を実行する\n\
  psh -c \"<式>\"               式を実行する（--command も同じ）\n\
\n\
  --pwsh                      pwsh（7）で走らせる。既定は powershell（5.1）\n\
  --help ・ -h                この使い方を出す\n\
\n\
既定を 5.1 にしているのは、ps1 を 5.1 で動くように書く決めがあるため。\n\
厳しい側で動かさないと、7 でしか通らない書き方に気づけません。\n\
起動も 5.1 のほうが速い（実測 185ms 対 285ms）。\n\
\n\
PowerShell は UTF-8（65001）で動かします。ps1 の中で取り込んだ外部コマンドの\n\
出力は UTF-8 として読まれます（SJIS を出すものは化けます）。\n\
\n\
終了コードは PowerShell のものをそのまま返します。\n";
	if to_stdout {
		write_out(text);
	} else {
		write_err(text);
	}
}

/*
	受け取ったバイト列を読む。

	出力の文字コードは、呼び出しの経路と中身で変わる。1 回の実行で UTF-8 と CP932 が
	混ざることがあり、全体をまとめて読むと、どちらかが必ず化ける。

	そこで行ごとに読み分ける。まず全体を UTF-8 として厳密に読み、読めなければ
	行（\n まで。\r は行の末尾に残る）に切って 1 行ずつ UTF-8 → CP932 の順で読む。
	行の中で切り替わることは無い（1 つの Write-Host ・ 1 つの exe の出力が行をまたいで混ざらないため）。

	CP932 は encoding_rs の SHIFT_JIS（WHATWG の shift_jis。Windows-31J の表）。
	TypeScript 版の TextDecoder('shift_jis') と同じ表なので、結果が一致する。
*/
fn decode_one(b: &[u8]) -> String {
	match std::str::from_utf8(b) {
		Ok(s) => s.to_string(),
		Err(_) => {
			let (s, _had_errors) = encoding_rs::SHIFT_JIS.decode_without_bom_handling(b);
			s.into_owned()
		}
	}
}

fn decode(buf: &[u8]) -> String {
	if buf.is_empty() {
		return String::new();
	}
	// 全体が UTF-8 で読めるなら、それでよい（混ざっていない）
	if let Ok(s) = std::str::from_utf8(buf) {
		return s.to_string();
	}
	// 混ざっている。行ごとに読み分ける
	let mut out = String::with_capacity(buf.len());
	for line in buf.split_inclusive(|&c| c == b'\n') {
		out.push_str(&decode_one(line));
	}
	out
}

/*
	PowerShell を UTF-8（65001）で動かす（計画 p260929-01。利用者の決定）。TypeScript 版と同じ。

	PowerShell は、ps1 の中で外部コマンドの出力を変数に取り込むとき、自分のコンソールの
	コードページで文字列にする。932 だとこのリポジトリのツールが出す UTF-8 が化け、
	65001 だと SJIS が化ける。UTF-8 のほうを取る。取り込んだあとに化けたものは、
	psh の読み分けでは直せない。

	PowerShell は自分専用のコンソール（CREATE_NO_WINDOW）で起動し、最初の 1 行で
	そのコンソールを 65001 にする。呼び出し元の窓には触らない
	（共通ルール「コンソールのコードページを変更しない」の例外「自分専用に作ったコンソール」）。
*/
const UTF8_SETUP: &str = "[Console]::OutputEncoding = [Console]::InputEncoding = New-Object System.Text.UTF8Encoding($false)";

/// 単一引用符の文字列にする。中の ' は '' にする。$ などは展開されない
fn ps_quote(s: &str) -> String {
	format!("'{}'", s.replace('\'', "''"))
}

/// -名前 ・ -名前:値 の形なら (名前, 値) を返す。-File と同じく、- の次が英字か _ で、
/// そのあと英数字 ・ _ ・ - が続くものを引数の名前とみなす
fn split_param_name(a: &str) -> Option<(&str, Option<&str>)> {
	let mut chars = a.char_indices();
	if chars.next().map(|(_, c)| c) != Some('-') {
		return None;
	}
	match chars.next() {
		Some((_, c)) if c.is_ascii_alphabetic() || c == '_' => {}
		_ => return None,
	}
	for (i, c) in chars {
		if c == ':' {
			return Some((&a[..i], Some(&a[i + 1..])));
		}
		if !(c.is_ascii_alphanumeric() || c == '_' || c == '-') {
			return None;
		}
	}
	Some((a, None))
}

/*
	ps1 を呼ぶ 1 行を組み立てる（TypeScript 版の buildFileCall と同じ）。

	最初の 1 行を実行してから ps1 を呼ぶため、-File が使えず -Command の中から呼ぶ。
	-File と同じく、- で始まる語は引数の名前、それ以外は値として並べる。値はすべて
	単一引用符で囲むので、空白 ・ 引用符 ・ $ ・ ; を含んでも 1 つの値のまま届き、展開もされない。

	trap { break } を置く。引数の結び付けに失敗したとき、-File は 1 で終わるが、& は
	止まらないエラーとして続けて 0 で終わってしまうため。

	-File との違い: exit を書かない ps1 の最後で外部コマンドが失敗すると、-File では 0、
	ここではその終了コードになる。

	パスは絶対パスにする。& は区切りを含まない名前をカレントから探さないため
*/
fn build_file_call(script: &Path, rest: &[OsString]) -> String {
	let abs = std::path::absolute(script).unwrap_or_else(|_| script.to_path_buf());
	let mut parts = vec!["&".to_string(), ps_quote(&abs.to_string_lossy())];
	for a in rest {
		let a = a.to_string_lossy();
		match split_param_name(&a) {
			None => parts.push(ps_quote(&a)),
			Some((name, None)) => parts.push(name.to_string()),
			Some((name, Some(v))) => parts.push(format!("{}:{}", name, ps_quote(v))),
		}
	}
	format!("{}; trap {{ break }}; $global:LASTEXITCODE = 0; {}; exit $LASTEXITCODE", UTF8_SETUP, parts.join(" "))
}

/// 標準出力へ書く。窓に直接書くときは Rust の標準ライブラリが UTF-16 で書くため、
/// コードページに関係なく化けない。リダイレクトされていれば UTF-8 のバイト列のまま
fn write_out(s: &str) {
	let mut o = std::io::stdout().lock();
	let _ = o.write_all(s.as_bytes());
	let _ = o.flush();
}

fn write_err(s: &str) {
	let mut e = std::io::stderr().lock();
	let _ = e.write_all(s.as_bytes());
	let _ = e.flush();
}

fn main() -> ExitCode {
	let mut args: Vec<OsString> = std::env::args_os().skip(1).collect();

	/*
		どちらの PowerShell を呼ぶか。

		既定は powershell（Windows PowerShell 5.1）。pwsh（7）ではない。
		ps1 は 5.1 で動くように書く決めがあり、厳しい側で動かさないと
		7 でしか通らない書き方に気づけないため。
	*/
	let mut exe = "powershell";
	if args.first().map(|a| a == "--pwsh").unwrap_or(false) {
		exe = "pwsh";
		args.remove(0);
	}

	if args.is_empty() {
		usage(false);
		return ExitCode::from(EXIT_BAD_ARGS);
	}

	/*
		使い方の要求。見るのは先頭だけ。`psh script.ps1 --help` の --help は
		呼ばれる ps1 のものなので、こちらで食べない
	*/
	if args[0] == "--help" || args[0] == "-h" {
		usage(true);
		return ExitCode::SUCCESS;
	}

	let mut ps_args: Vec<OsString> = vec!["-NoProfile".into(), "-ExecutionPolicy".into(), "Bypass".into()];

	// -c は --command の短縮（sh -c ・ bash -c と同じ慣習）
	if args[0] == "--command" || args[0] == "-c" {
		if args.len() < 2 {
			write_err(&format!("[NG] {} に式がありません。\n", args[0].to_string_lossy()));
			return ExitCode::from(EXIT_BAD_ARGS);
		}
		// 式は 1 つの引数として渡す。シェルを挟まないので、引用符を足す必要はない。
		// 前に UTF-8 にする 1 行を置く
		ps_args.push("-Command".into());
		let mut expr = OsString::from(format!("{}; ", UTF8_SETUP));
		expr.push(&args[1]);
		ps_args.push(expr);
	} else {
		let script = Path::new(&args[0]);
		if !script.exists() {
			write_err(&format!("[NG] ファイルが見つかりません: {}\n", args[0].to_string_lossy()));
			return ExitCode::from(EXIT_BAD_ARGS);
		}
		ps_args.push("-Command".into());
		ps_args.push(build_file_call(script, &args[1..]).into());
	}

	/*
		PowerShell を走らせて、出た分をすべて受け取る。

		引数は配列のまま渡す（シェルを挟まない）。空白や記号を含む引数が割れない。
		標準入力は閉じる（Stdio::null）。閉じないと、相手が入力を待って止まったままになる
		（TypeScript 版と同じ。扱いは課題 i260927-03 で検討中）

		PowerShell は自分専用のコンソールで起動する（CREATE_NO_WINDOW。上の UTF8_SETUP の説明を参照）。
		そうしない方法は課題 i260929-04 で検討する
	*/
	let mut cmd = Command::new(exe);
	cmd.args(&ps_args).stdin(Stdio::null());
	#[cfg(windows)]
	{
		use std::os::windows::process::CommandExt;
		const CREATE_NO_WINDOW: u32 = 0x0800_0000;
		cmd.creation_flags(CREATE_NO_WINDOW);
	}
	let result = cmd.output();

	let output = match result {
		Ok(o) => o,
		Err(e) => {
			write_err(&format!("[NG] {} を起動できません: {}\n", exe, e));
			return ExitCode::from(EXIT_BAD_ARGS);
		}
	};

	let out = decode(&output.stdout);
	let err = decode(&output.stderr);
	if !out.is_empty() {
		write_out(&out);
	}
	if !err.is_empty() {
		write_err(&err);
	}

	// シグナルで落ちた場合などは code が取れない
	match output.status.code() {
		Some(c) => ExitCode::from((c & 0xff) as u8),
		None => ExitCode::from(EXIT_BAD_ARGS),
	}
}

#[cfg(test)]
mod tests {
	use super::{decode, ps_quote, split_param_name};

	#[test]
	fn 単一引用符で囲み中の引用符を重ねる() {
		assert_eq!(ps_quote("引用'符"), "'引用''符'");
		assert_eq!(ps_quote("$env:PATH"), "'$env:PATH'");
	}

	#[test]
	fn 引数の名前の見分け() {
		assert_eq!(split_param_name("-Name"), Some(("-Name", None)));
		assert_eq!(split_param_name("-Code:3"), Some(("-Code", Some("3"))));
		assert_eq!(split_param_name("-my_param-x"), Some(("-my_param-x", None)));
		assert_eq!(split_param_name("-5"), None);
		assert_eq!(split_param_name("値"), None);
		assert_eq!(split_param_name("-名前"), None);
		assert_eq!(split_param_name("-a b"), None);
	}

	// 期待値は手で書いた。tools/40_test/run-psh-tests.ts の 9 と同じ並び
	#[test]
	fn utf8_だけ() {
		assert_eq!(decode(&[0xE3, 0x81, 0x82, 0xE3, 0x81, 0x84, 0xE3, 0x81, 0x86, 0x0A]), "あいう\n");
	}

	#[test]
	fn cp932_だけ() {
		assert_eq!(decode(&[0x82, 0xA0, 0x82, 0xA2, 0x82, 0xA4, 0x0D, 0x0A]), "あいう\r\n");
	}

	#[test]
	fn 行ごとに混ざる() {
		assert_eq!(decode(&[0xE3, 0x81, 0x82, 0x0A, 0x82, 0xA2, 0x0D, 0x0A]), "あ\nい\r\n");
	}

	#[test]
	fn 末尾に改行が無い_cp932() {
		assert_eq!(decode(&[0x41, 0x0A, 0x82, 0xA0]), "A\nあ");
	}

	#[test]
	fn cp932_の半角カナと_utf8() {
		assert_eq!(decode(&[0xB1, 0x0A, 0xE3, 0x81, 0x86, 0x0A]), "ｱ\nう\n");
	}

	#[test]
	fn 空() {
		assert_eq!(decode(&[]), "");
	}
}
