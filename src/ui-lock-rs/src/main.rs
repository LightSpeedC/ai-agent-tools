// ui-lock の Rust 版 (課題 i261114-01、決定 256-A)。動きは src/ui-lock/main.ts と同じにする。
// 試験は tools/40_test/run-ui-lock-tests.ts を UI_LOCK_TEST_TARGET にこの exe を渡して流す。
//
// ロックは名前付きミューテックス。持ち主が死ねば OS が放棄として次へ渡す。
// 持ち主の記録は owner.json にも書く (TS 版と同じ形。どちらの実装でも読める)。

use std::ffi::c_void;
use std::io::Write;
use std::os::windows::process::CommandExt;
use std::path::PathBuf;
use std::process::{Command, ExitCode, Stdio};
use std::thread::sleep;
use std::time::{Duration, Instant};

const EXIT_BUSY: u8 = 1;
const EXIT_WAIT_TIMEOUT: u8 = 3;
const EXIT_RUN_TIMEOUT: u8 = 4;
const EXIT_BAD_ARGS: u8 = 5;

const DEFAULT_TIMEOUT_SEC: u64 = 10 * 60; // 決定 252-B
const DEFAULT_WAIT_SEC: u64 = 60 * 60; // 決定 253-A
const OWNER_PRINT_SEC: u64 = 60;
const TOAST_SEC: u64 = 5 * 60; // 決定 254-A

const WAIT_OBJECT_0: u32 = 0;
const WAIT_ABANDONED: u32 = 0x80;
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

type Handle = *mut c_void;

#[repr(C)]
#[derive(Default)]
struct SystemTime {
	year: u16,
	month: u16,
	day_of_week: u16,
	day: u16,
	hour: u16,
	minute: u16,
	second: u16,
	milliseconds: u16,
}

#[link(name = "kernel32")]
extern "system" {
	fn CreateMutexW(attr: *mut c_void, owned: i32, name: *const u16) -> Handle;
	fn WaitForSingleObject(h: Handle, ms: u32) -> u32;
	fn ReleaseMutex(h: Handle) -> i32;
	fn CloseHandle(h: Handle) -> i32;
	fn GetLocalTime(t: *mut SystemTime);
}

const USAGE: &str = "ui-lock: 画面 ・ マウス ・ キーを使う作業を、全プロジェクトで 1 つずつにする

使い方:
  ui-lock run [--timeout <時間>] [--wait <時間>] [--also <名前>]… -- <コマンド> [引数…]
      ロックを取ってコマンドを流し、終わったら放す
      --timeout  実行の上限 (既定 10m)。過ぎたら子のプロセスごと止めて放す (終了コード 4)
      --wait     取れるまで待つ上限 (既定 60m)。過ぎたら終了コード 3
                 待つ間は 1 分ごとに持ち主を出し、5 分ごとに Windows のトーストで知らせる
      --also     一緒に取るロックの名前 (移行中の古い名前。例 Local\\fm-ui-tests)。何度でも書ける
  ui-lock status
      今の持ち主を出す (空きなら 0、使用中なら 1)

時間は 30s ・ 10m ・ 1h の形。
終了コード: 子の終了コード / 1 使用中 (status) / 3 待ちの上限 / 4 実行の上限 / 5 引数の誤り
";

struct BadArgs(String);

fn lock_name() -> String {
	std::env::var("UI_LOCK_NAME").ok().filter(|s| !s.is_empty()).unwrap_or_else(|| "Local\\ai-interactive-desktop".into())
}

fn owner_dir() -> PathBuf {
	if let Some(d) = std::env::var_os("UI_LOCK_DIR").filter(|s| !s.is_empty()) {
		return PathBuf::from(d);
	}
	PathBuf::from(std::env::var_os("LOCALAPPDATA").unwrap_or_default()).join("ai-interactive-desktop")
}

fn owner_path() -> PathBuf {
	owner_dir().join("owner.json")
}

fn parse_duration(s: Option<&String>) -> Result<u64, BadArgs> {
	let bad = || BadArgs(format!("時間の形が違う: {} (30s ・ 10m ・ 1h の形)", s.map(|x| x.as_str()).unwrap_or("")));
	let s = s.ok_or_else(bad)?;
	if s.len() < 2 {
		return Err(bad());
	}
	let (num, unit) = s.split_at(s.len() - 1);
	if num.is_empty() || !num.bytes().all(|b| b.is_ascii_digit()) {
		return Err(bad());
	}
	let n: u64 = num.parse().map_err(|_| bad())?;
	match unit {
		"s" => Ok(n),
		"m" => Ok(n * 60),
		"h" => Ok(n * 3600),
		_ => Err(bad()),
	}
}

fn now_text() -> String {
	let mut t = SystemTime::default();
	unsafe { GetLocalTime(&mut t) };
	format!("{}/{:02}/{:02} {:02}:{:02}:{:02}", t.year, t.month, t.day, t.hour, t.minute, t.second)
}

/* ---- owner.json (TS 版と同じ形) ---- */

struct Owner {
	project: String,
	worktree: String,
	command: String,
	started: String,
	pid: u32,
	timeout_sec: u64,
}

fn json_str(s: &str) -> String {
	let mut o = String::from("\"");
	for c in s.chars() {
		match c {
			'"' => o.push_str("\\\""),
			'\\' => o.push_str("\\\\"),
			'\n' => o.push_str("\\n"),
			'\r' => o.push_str("\\r"),
			'\t' => o.push_str("\\t"),
			c if (c as u32) < 0x20 => o.push_str(&format!("\\u{:04x}", c as u32)),
			c => o.push(c),
		}
	}
	o.push('"');
	o
}

fn owner_json(o: &Owner) -> String {
	format!(
		"{{\n\t\"project\": {},\n\t\"worktree\": {},\n\t\"command\": {},\n\t\"started\": {},\n\t\"pid\": {},\n\t\"timeoutSec\": {}\n}}\n",
		json_str(&o.project),
		json_str(&o.worktree),
		json_str(&o.command),
		json_str(&o.started),
		o.pid,
		o.timeout_sec
	)
}

/// 鍵の値の先頭 (コロンの後の空白を飛ばした位置) を返す
fn value_at<'a>(json: &'a str, key: &str) -> Option<&'a str> {
	let k = format!("\"{}\"", key);
	let i = json.find(&k)? + k.len();
	let rest = json[i..].trim_start();
	Some(rest.strip_prefix(':')?.trim_start())
}

fn get_str(json: &str, key: &str) -> Option<String> {
	let v = value_at(json, key)?;
	let mut chars = v.strip_prefix('"')?.chars();
	let mut o = String::new();
	while let Some(c) = chars.next() {
		match c {
			'"' => return Some(o),
			'\\' => match chars.next()? {
				'n' => o.push('\n'),
				'r' => o.push('\r'),
				't' => o.push('\t'),
				'u' => {
					let h: String = chars.by_ref().take(4).collect();
					o.push(char::from_u32(u32::from_str_radix(&h, 16).ok()?).unwrap_or('?'));
				}
				x => o.push(x),
			},
			c => o.push(c),
		}
	}
	None
}

fn get_num(json: &str, key: &str) -> Option<u64> {
	let v = value_at(json, key)?;
	let d: String = v.chars().take_while(|c| c.is_ascii_digit()).collect();
	d.parse().ok()
}

fn read_owner() -> Option<Owner> {
	let j = std::fs::read_to_string(owner_path()).ok()?;
	Some(Owner {
		project: get_str(&j, "project").unwrap_or_default(),
		worktree: get_str(&j, "worktree").unwrap_or_default(),
		command: get_str(&j, "command").unwrap_or_default(),
		started: get_str(&j, "started").unwrap_or_default(),
		pid: get_num(&j, "pid").unwrap_or(0) as u32,
		timeout_sec: get_num(&j, "timeoutSec").unwrap_or(0),
	})
}

fn owner_text(o: Option<Owner>) -> String {
	match o {
		None => "持ち主の記録がありません".into(),
		Some(o) => format!(
			"{} (pid {}) {}  開始 {}  上限 {} 分",
			o.project,
			o.pid,
			o.command,
			o.started,
			(o.timeout_sec as f64 / 60.0).round() as u64
		),
	}
}

fn write_owner(o: &Owner) {
	let dir = owner_dir();
	let _ = std::fs::create_dir_all(&dir);
	let tmp = dir.join(format!("owner.json.{}.tmp", std::process::id()));
	if std::fs::write(&tmp, owner_json(o)).is_ok() {
		let _ = std::fs::rename(&tmp, owner_path());
	}
}

fn where_am_i() -> (String, String) {
	let top = Command::new("git")
		.args(["rev-parse", "--show-toplevel"])
		.stderr(Stdio::null())
		.output()
		.ok()
		.filter(|o| o.status.success())
		.map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string())
		.unwrap_or_else(|| std::env::current_dir().map(|p| p.to_string_lossy().into_owned()).unwrap_or_default());
	let name = top.rsplit(['/', '\\']).next().unwrap_or("").to_string();
	(name, top)
}

/* ---- ミューテックス ---- */

fn wide(s: &str) -> Vec<u16> {
	s.encode_utf16().chain(std::iter::once(0)).collect()
}

struct Locks {
	names: Vec<String>,
	held: Vec<Handle>,
}

impl Locks {
	/// 全部を取れたら Some(放棄があったか)。1 つでも取れなければ、取った分を放して None
	fn try_all(&mut self) -> Option<bool> {
		let mut abandoned = false;
		for name in self.names.clone() {
			let w = wide(&name);
			let h = unsafe { CreateMutexW(std::ptr::null_mut(), 0, w.as_ptr()) };
			if h.is_null() {
				eprintln!("[NG] CreateMutexW が失敗しました: {}", name);
				self.release_all();
				return None;
			}
			let r = unsafe { WaitForSingleObject(h, 0) };
			if r == WAIT_OBJECT_0 || r == WAIT_ABANDONED {
				abandoned |= r == WAIT_ABANDONED;
				self.held.push(h);
			} else {
				unsafe { CloseHandle(h) };
				self.release_all();
				return None;
			}
		}
		Some(abandoned)
	}

	fn release_all(&mut self) {
		while let Some(h) = self.held.pop() {
			unsafe {
				ReleaseMutex(h);
				CloseHandle(h);
			}
		}
	}
}

/* ---- トースト ---- */

fn toast(title: &str, body: &str) {
	if std::env::var("UI_LOCK_NO_TOAST").as_deref() == Ok("1") {
		return;
	}
	let esc = |s: &str| s.replace('&', "&amp;").replace('<', "&lt;").replace('>', "&gt;").replace('\'', "''");
	let script = [
		"[Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] | Out-Null".to_string(),
		"[Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom.XmlDocument, ContentType = WindowsRuntime] | Out-Null".to_string(),
		"$x = New-Object Windows.Data.Xml.Dom.XmlDocument".to_string(),
		format!("$x.LoadXml('<toast><visual><binding template=\"ToastGeneric\"><text>{}</text><text>{}</text></binding></visual></toast>')", esc(title), esc(body)),
		"$id = '{1AC14E77-02E7-4E5D-B744-2EB1AE5198B7}\\WindowsPowerShell\\v1.0\\powershell.exe'".to_string(),
		"[Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier($id).Show([Windows.UI.Notifications.ToastNotification]::new($x))".to_string(),
	]
	.join("; ");
	let _ = Command::new("powershell")
		.args(["-NoProfile", "-NonInteractive", "-Command", &script])
		.stdin(Stdio::null())
		.stdout(Stdio::null())
		.stderr(Stdio::null())
		.creation_flags(CREATE_NO_WINDOW)
		.spawn();
}

/* ---- 子のプロセス ---- */

fn quote(a: &str) -> String {
	let plain = !a.is_empty() && a.chars().all(|c| c.is_alphanumeric() || "_-.:\\/=".contains(c));
	if plain {
		a.to_string()
	} else {
		format!("\"{}\"", a.replace('"', "\\\""))
	}
}

fn kill_tree(pid: u32) {
	let _ = Command::new("taskkill")
		.args(["/PID", &pid.to_string(), "/T", "/F"])
		.stdout(Stdio::null())
		.stderr(Stdio::null())
		.status();
}

fn minutes(sec: u64) -> f64 {
	(sec as f64 / 60.0 * 10.0).round() / 10.0
}

/* ---- 下位コマンド ---- */

fn status() -> u8 {
	let mut locks = Locks { names: vec![lock_name()], held: vec![] };
	if locks.try_all().is_some() {
		locks.release_all();
		println!("空き: {}", lock_name());
		if owner_path().exists() {
			println!("  前の持ち主の記録が残っています (放棄): {}", owner_text(read_owner()));
		}
		return 0;
	}
	println!("使用中: {}", lock_name());
	println!("  {}", owner_text(read_owner()));
	EXIT_BUSY
}

fn run(args: &[String]) -> Result<u8, BadArgs> {
	let sep = args.iter().position(|a| a == "--");
	let sep = match sep {
		Some(i) if i + 1 < args.len() => i,
		_ => return Err(BadArgs("-- の後にコマンドを書いてください".into())),
	};
	let (opts, cmd) = (&args[..sep], &args[sep + 1..]);
	let mut timeout_sec = DEFAULT_TIMEOUT_SEC;
	let mut wait_sec = DEFAULT_WAIT_SEC;
	let mut names = vec![lock_name()];
	let mut i = 0;
	while i < opts.len() {
		match opts[i].as_str() {
			"--timeout" => {
				i += 1;
				timeout_sec = parse_duration(opts.get(i))?;
			}
			"--wait" => {
				i += 1;
				wait_sec = parse_duration(opts.get(i))?;
			}
			"--also" => {
				i += 1;
				let v = opts.get(i).filter(|s| !s.is_empty()).ok_or_else(|| BadArgs("--also に名前が要ります".into()))?;
				names.push(v.clone());
			}
			o => return Err(BadArgs(format!("知らないオプション: {}", o))),
		}
		i += 1;
	}

	let mut locks = Locks { names, held: vec![] };
	let command = cmd.iter().map(|a| quote(a)).collect::<Vec<_>>().join(" ");

	// 取れるまで待つ
	let t0 = Instant::now();
	let mut last_print: Option<Instant> = None;
	let mut last_toast = Instant::now();
	let abandoned = loop {
		if let Some(a) = locks.try_all() {
			break a;
		}
		let now = Instant::now();
		if last_print.map_or(true, |p| now - p >= Duration::from_secs(OWNER_PRINT_SEC)) {
			println!("[待ち] {} 使用中: {}", now_text(), owner_text(read_owner()));
			let _ = std::io::stdout().flush();
			last_print = Some(now);
		}
		if now - last_toast >= Duration::from_secs(TOAST_SEC) {
			let (project, _) = where_am_i();
			toast(
				"ui-lock を待っています",
				&format!("{} が {} 分待っています。持ち主: {}", project, (now - t0).as_secs() / 60, owner_text(read_owner())),
			);
			last_toast = now;
		}
		if now - t0 >= Duration::from_secs(wait_sec) {
			println!("[NG] 待ちの上限 ({} 分) を過ぎました。持ち主: {}", minutes(wait_sec), owner_text(read_owner()));
			return Ok(EXIT_WAIT_TIMEOUT);
		}
		sleep(Duration::from_secs(1));
	};
	// 取れたのに記録が残っていれば、前の持ち主は放さずに死んだ
	if abandoned || owner_path().exists() {
		println!("[!] 前の持ち主が放棄したロックを取りました: {}", owner_text(read_owner()));
	}

	let (project, worktree) = where_am_i();
	let me = std::process::id();
	write_owner(&Owner { project, worktree, command: command.clone(), started: now_text(), pid: me, timeout_sec });
	let _ = std::io::stdout().flush();

	let cleanup = |locks: &mut Locks| {
		if read_owner().map_or(false, |o| o.pid == me) {
			let _ = std::fs::remove_file(owner_path());
		}
		locks.release_all();
	};

	// cmd /d /s /c "<コマンド>" で流す (TS 版の shell: true と同じ)
	let child = Command::new("cmd").raw_arg(format!("/d /s /c \"{}\"", command)).spawn();
	let mut child = match child {
		Ok(c) => c,
		Err(e) => {
			cleanup(&mut locks);
			eprintln!("[NG] 起動できません: {}", e);
			return Ok(127);
		}
	};
	let start = Instant::now();
	let code = loop {
		match child.try_wait() {
			Ok(Some(st)) => break st.code().unwrap_or(1),
			Ok(None) => {}
			Err(_) => break 1,
		}
		if start.elapsed() >= Duration::from_secs(timeout_sec) {
			println!("[NG] 実行の上限 ({} 分) を過ぎたので、子のプロセスごと止めます", minutes(timeout_sec));
			kill_tree(child.id());
			let _ = child.wait();
			cleanup(&mut locks);
			return Ok(EXIT_RUN_TIMEOUT);
		}
		sleep(Duration::from_millis(100));
	};
	cleanup(&mut locks);
	Ok(code as u8)
}

fn main() -> ExitCode {
	let argv: Vec<String> = std::env::args().skip(1).collect();
	if argv.is_empty() || argv[0] == "--help" || argv[0] == "-h" {
		println!("{}", USAGE);
		return ExitCode::from(if argv.is_empty() { EXIT_BAD_ARGS } else { 0 });
	}
	let r = match argv[0].as_str() {
		"status" => Ok(status()),
		"run" => run(&argv[1..]),
		o => Err(BadArgs(format!("知らない下位コマンド: {}", o))),
	};
	match r {
		Ok(c) => ExitCode::from(c),
		Err(BadArgs(m)) => {
			eprintln!("[NG] {}", m);
			eprintln!("{}", USAGE);
			ExitCode::from(EXIT_BAD_ARGS)
		}
	}
}
