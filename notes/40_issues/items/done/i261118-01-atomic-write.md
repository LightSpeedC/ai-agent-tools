---
schema: 1
id: i261118-01
title: issue の書き込みを一時ファイル + rename にして、同時実行と途中の落ちで壊れないようにする
group: issue
created: 2026-11-18
---

tools-review (i261117-03 のレビュー) の指摘 3。setFields ・ setConfirmed ・ editTodo ・ setState (git mv) は fs.writeFileSync で直に上書きする。同じ課題に 2 つの issue set を同時に流すと、後から書いた方が先の変更を消す。書いている途中に落ちると、半端なファイルが残る。新しい弱点ではなく、前からある。直し方の案: 一時ファイルに書いて rename する (Windows では rename が上書きできるかを測る)。書く直前に読み直して比べる案もある。同時に流す運用が実際にあるかは未確認。決めること: 直すか (同時に流す運用が無ければ、見送ってよい)、直すなら rename か読み直しか。

対応 (11/18): 決定 273-A (i261118-01-d1)。共通の writeAtomic (src/lib/write-atomic.ts。html2md ・ text などが使っている) を、既にあるファイルを書き直す 7 か所 (set の鍵 ・ confirm ・ todo の 2 か所 ・ decide set ・ render ・ project-uuid.txt) に使った。新しいファイルを作る wx の書き込み (new ・ decide new ・ migrate) と、migrate の記録 ・ 番号の予約の小さな書き込みは、読んで直して書き戻す形ではないので、そのまま。試験: 5 つの操作で、書いたあとファイルの識別子 (ino) が変わり、*.tmp が残らない (run-issue-ops-tests。bun ・ node とも ✅)。同時に書く 2 つの操作が互いの変更を消すことは、防がない (錠は持たない。273-B は採らなかった)。
