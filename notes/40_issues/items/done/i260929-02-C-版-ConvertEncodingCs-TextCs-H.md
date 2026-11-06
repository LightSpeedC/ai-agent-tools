---
schema: 1
id: i260929-02
title: C# 版（ConvertEncodingCs ・ TextCs ・ Html2MdCs）が TypeScript 版とずれている
group: 運用・方針の決定事項
created: 2026-09-29
---

i260929-01 で C# 版にもテストを当てたところ、<strong>判定とは関係のない 8 件が落ちた。</strong>変更前（HEAD）のソースをビルドしても同じ 8 件が落ちるので、以前からのずれである。移植のあと、TypeScript 版にだけ入った変更が C# 版に入っていない。

- convert-encoding: `--read` ＋ `--to`、`--info` ＋ `--to` を拒否しない（2 件）
- text find: 既定で `tmp` ・ `etc` ・ `node_modules` を外さない（4 件）
- text edit: 読めないバイトがあっても拒否せず、書き換える（2 件）

<strong>html2md の C# 版はさらに大きくずれている。</strong>i260929-03 を C# 版にも入れようとして 2026-09-29 に html2md のテストを当てたところ、**28 ケース中 12 ケースが落ちた**。アンカーの件（i260929-03）の前提になる i260903-02（タグの境界に空白を入れない）と i260921-01（`md-flat` の summary のアンカー）も入っていない。ほかに `emphasis-boundary-mark` ・ `existing-md` ・ `figure-extra` ・ `link-in-strong` など、アンカーと関係のないケースも落ちる。

そのため i260929-03 は C# 版に入れず、この課題の判断を先にする（2026-09-29、利用者の判断）。

決めること: C# 版を追いつかせるか、突き合わせ用として固定して差分を記録するか、消すか。

<strong>対応（2026-09-30）。</strong>消すことにした（利用者の判断）。ソース 3 フォルダ ・ ビルド用 cmd 3 本 ・ `dist/*-cs.exe` を消し、html2md のベンチから C# の行を外した。psh のテスト 5 で .NET 製 exe の例に使っていた `convert-encoding-cs.exe` は、`tests/psh/callexe.cs` をテストのたびに Windows 標準の csc で `tmp/` にビルドする形に替えた。全テストが通る。
