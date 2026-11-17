---
schema: 1
id: i261118-01
title: issue の書き込みを一時ファイル + rename にして、同時実行と途中の落ちで壊れないようにする
group: issue
created: 2026-11-18
---

tools-review (i261117-03 のレビュー) の指摘 3。setFields ・ setConfirmed ・ editTodo ・ setState (git mv) は fs.writeFileSync で直に上書きする。同じ課題に 2 つの issue set を同時に流すと、後から書いた方が先の変更を消す。書いている途中に落ちると、半端なファイルが残る。新しい弱点ではなく、前からある。直し方の案: 一時ファイルに書いて rename する (Windows では rename が上書きできるかを測る)。書く直前に読み直して比べる案もある。同時に流す運用が実際にあるかは未確認。決めること: 直すか (同時に流す運用が無ければ、見送ってよい)、直すなら rename か読み直しか。
