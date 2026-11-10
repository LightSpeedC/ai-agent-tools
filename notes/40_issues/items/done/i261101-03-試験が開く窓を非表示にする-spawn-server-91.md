---
schema: 1
id: i261101-03
title: 試験が開く窓を非表示にする (spawn-server、91-A)
group: 運用・方針の決定事項
created: 2026-11-01
---

2026-11-01、利用者の要望。`run-spawn-server-tests.ts` が、`powershell … Start-Sleep 30` などの新しい窓を開き、作業中の画面を邪魔する。**裏に回せるコンソールが要る試験は、非表示にする**。共通ルール「窓が要る試験は、非表示で裏に回す」(`test-rules`) にも反映した (92-A')。

**実測 (2026-11-01、見えている最上位の窓を、起動の前後で比べた)。**

- `CreateProcessW` の新しい窓で、表示の指定なし (いまの `spawn-server`): 窓が見え、**前面を奪った**。`SW_HIDE`: 窓は見えず、前面も変わらず、**`conhost` は作られた**。`SW_SHOWMINNOACTIVE`: 最小化で見え、前面は変わらない
- PowerShell の `-NoNewWindow` ・ `-WindowStyle Hidden` ・ `ProcessStartInfo.CreateNoWindow`: この環境では、どれも窓は出ない (対照の `Start-Process` 既定は出る)
- **確かめられなかったこと**: `-NoNewWindow` が、親に窓が無いとき別の窓を作るか (他プロジェクトの記録にある)。PowerShell は、コンソール無しで起動するとすぐ終わるため、その条件を作れなかった

- [済] 試験を先に書いた (❌Red: 起動した窓が見えている)。`tools/40_test/run-spawn-server-tests.ts` の 8 に、窓が見えないこと ・ 前面を奪わないことを足した。**前面を奪わないことの確認は、実装の前から通っていた** (❌Red を見られていない)
- [済] 実装した。環境変数 `SPAWN_SERVER_TEST_HIDE=1` のとき、3 つの起動の道とも非表示にする (`bun:ffi` と `koffi` は `STARTF_USESHOWWINDOW` と `SW_HIDE`、`Start-Process` は `-WindowStyle Hidden`。`src/spawn-server-ts/create-process.ts`)。本番は指定せず、いつも見える窓。node ・ bun とも、全 3 つの道で 32 件成功
- [済] ほかの試験が開く窓 (`cc` ・ `cx` ・ `ag` の入口の試験の `start`) は、この課題の対象外。必要になったとき、別に扱う。<strong>調べた結果 (2026-11-02、全件テスト 604 秒の間、新しく窓を持つプロセスを 0.7 秒ごとに記録した)。</strong>この間に窓を持ったプロセスは、ai-agent-tools の試験からは 0 件。別プロジェクトの定期タスク (`20260905-windows-pc-memory-inspection` の `check-report.cmd`、親は `svchost`) の窓が 1 回だけ記録された。**「窓が時々出る」の正体は、この定期タスクの見込み** (出た時刻の突き合わせは未確認。他プロジェクトのものなので直さない)
- [済] 2026-11-10、利用者が試験の間に窓のチラつきを見た。流していたのは ag-trusted ・ cc-register ・ cc ・ agent-entry ・ agent-launch (bun と node)。2026-11-02 の記録 (0.7 秒ごと) では 0 件だったので、間隔より短く出て消える窓の見込み。どの試験が出しているかを、短い窓も拾える方法で調べる
- [済] 2026-11-10 調べた結果 (SetWinEventHook の表示の通知 ＋ 50 ミリ秒ごとの EnumWindows)。窓を出していたのは run-cc-tests (claude.exe の身代わりの窓 2 つ) と run-agent-entry-tests (cmd の窓 6 つ前後)。ほかの 3 本 (ag-trusted ・ cc-register ・ agent-launch) は 0。原因: agent-launch/main.ts が非表示の試験のとき、番人を spawn の detached:true ＋ windowsHide:true で起こす。detached は DETACHED_PROCESS になり、番人 (cmd) はコンソールを持たない。その子 (claude.exe 等のコンソールのプログラム) は新しいコンソールを作り、見える窓になる。実験で確かめた: detached ＋ windowsHide の cmd から呼んだ ping は窓が出た。detached なしでは出ない
- [済] 225-A で直した。非表示の試験では、番人を spawn-server の launch (CreateProcessW、SW_HIDE の新しいコンソール) で起こす (src/agent-launch/main.ts の launchKeeper)。試験: run-agent-entry-tests に、エージェントのコンソールの窓が見えないことを足した (❌Red 3 件を見てから直し、✅ bun ・ node とも 48 件)。見張りで 0 件を確かめた
