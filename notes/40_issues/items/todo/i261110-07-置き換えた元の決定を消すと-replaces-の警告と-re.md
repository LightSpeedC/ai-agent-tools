---
schema: 1
id: i261110-07
title: 置き換えた元の決定を消すと、replaces の警告と --recheck の候補が出る
group: issue
created: 2026-11-10
from: ai-chat-lite
confirmed: false
---

ai-chat-lite の #1906。decide new --replaces で置き換えたあと、元の決定のファイルを消すと、issue check が replaces の参照先が見つからないと警告する (8 件)。replaces を消すと --recheck の候補に戻る。decide.ts の作りでは、決定は消さず、新しい決定で replaces を指す前提。直し方は選択が要る (237)。
