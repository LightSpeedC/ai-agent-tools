param([string]$Out, [int]$Seconds = 600, [int]$PollMs = 50)
# 新しく表示された最上位の窓を記録する。SetWinEventHook (表示のたびに通知) と、PollMs ごとの EnumWindows の両方で拾う
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
public static class WinWatch {
	delegate void WinEventProc(IntPtr h, uint ev, IntPtr hwnd, int idObj, int idChild, uint th, uint t);
	delegate bool EnumProc(IntPtr hwnd, IntPtr l);
	[DllImport("user32.dll")] static extern IntPtr SetWinEventHook(uint a, uint b, IntPtr m, WinEventProc p, uint pid, uint tid, uint f);
	[DllImport("user32.dll")] static extern bool EnumWindows(EnumProc p, IntPtr l);
	[DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);
	[DllImport("user32.dll")] static extern IntPtr GetParent(IntPtr h);
	[DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
	[DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
	[DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetClassName(IntPtr h, StringBuilder s, int n);
	[DllImport("user32.dll")] static extern bool PeekMessage(out MSG m, IntPtr h, uint a, uint b, uint r);
	[DllImport("user32.dll")] static extern bool TranslateMessage(ref MSG m);
	[DllImport("user32.dll")] static extern IntPtr DispatchMessage(ref MSG m);
	[StructLayout(LayoutKind.Sequential)] struct MSG { public IntPtr h; public uint msg; public IntPtr w; public IntPtr l; public uint t; public int x; public int y; }
	static WinEventProc keep;
	static HashSet<IntPtr> seen = new HashSet<IntPtr>();
	static StreamWriter w;
	static string Desc(IntPtr hwnd) {
		uint pid; GetWindowThreadProcessId(hwnd, out pid);
		var t = new StringBuilder(256); GetWindowText(hwnd, t, 256);
		var c = new StringBuilder(256); GetClassName(hwnd, c, 256);
		string name = "?";
		try { name = Process.GetProcessById((int)pid).ProcessName; } catch { name = "(終了済み)"; }
		return "pid=" + pid + " proc=" + name + " class=" + c + " title=" + t;
	}
	static void Log(string how, IntPtr hwnd) {
		w.WriteLine(DateTime.Now.ToString("HH:mm:ss.fff") + " " + how + " " + Desc(hwnd));
		w.Flush();
	}
	public static void Run(string path, int seconds, int pollMs) {
		w = new StreamWriter(path, false, new UTF8Encoding(false));
		EnumWindows((h, l) => { if (IsWindowVisible(h)) seen.Add(h); return true; }, IntPtr.Zero);
		w.WriteLine("開始 " + DateTime.Now.ToString("HH:mm:ss.fff") + " 既に見えている窓 " + seen.Count);
		w.Flush();
		keep = (h, ev, hwnd, idObj, idChild, th, t) => {
			if (idObj != 0 || idChild != 0 || hwnd == IntPtr.Zero || GetParent(hwnd) != IntPtr.Zero) return;
			Log("hook", hwnd);
		};
		SetWinEventHook(0x8002, 0x8002, IntPtr.Zero, keep, 0, 0, 0); // EVENT_OBJECT_SHOW、WINEVENT_OUTOFCONTEXT
		var end = DateTime.Now.AddSeconds(seconds);
		while (DateTime.Now < end) {
			MSG m;
			while (PeekMessage(out m, IntPtr.Zero, 0, 0, 1)) { TranslateMessage(ref m); DispatchMessage(ref m); }
			EnumWindows((h, l) => {
				if (IsWindowVisible(h) && !seen.Contains(h)) { seen.Add(h); Log("poll", h); }
				return true;
			}, IntPtr.Zero);
			System.Threading.Thread.Sleep(pollMs);
		}
		w.WriteLine("終了 " + DateTime.Now.ToString("HH:mm:ss.fff"));
		w.Close();
	}
}
'@
[WinWatch]::Run($Out, $Seconds, $PollMs)
