---
schema: 1
id: i261117-03
title: issue set で version ・ released ・ note ・ kind を書けるようにし、知らない鍵を消さない
group: 他プロジェクトからの要求
created: 2026-11-17
from: file-manager
confirmed: false
refs: #2039
---

依頼 #2039 (file-manager。課題 i261113-0e のリリースノートの材料にする)。ほしい形: (1) issue set <id> --version --released --note --kind で 4 つの鍵を書ける (note は複数行で改行を保つ。値を空にすると鍵を消す)。(2) front matter を書き直しても、知らない鍵 (並びと内容) を消さない。(3) issue show に 4 つの鍵があれば出す。(4) version を持たない・note を持たない課題を一覧から引ける (例: issue list --missing note)。

調べた結果 (11/17、コードを読んだだけ。試験で測っていない): メタ情報の読み書きは src/issue/meta.ts と ops.ts。(a) 知らない鍵: setConfirmed は該当の 1 行だけを書き換えるので残るはず (試験で確かめる)。ただし issue check は知らない鍵を unknown-key の警告にする。version ・ released ・ note ・ kind を既知の鍵 (KeyOrder と仕様) に足す必要がある。(b) 複数行: meta.ts のパーサは「キー: 値」の 1 行だけで、複数行 ・ 引用符 ・ コメントを持たない (仕様は notes/50_spec/課題ファイルの形と検査.html)。依頼の note (複数行 ・ コロン ・ 引用符) を読み戻して同じ文字列にするには、書式の拡張が要る。依頼元は YAML の note: | の塊を案にしている。(c) set は今は --state だけ。

決めること: 1 note の複数行の書式 (YAML の | の塊 / 1 行にして \n で表す / 別の形)。2 4 つの鍵の並ぶ位置 (KeyOrder のどこか)。3 --missing の対象の鍵と、書式。4 released の書式 (依頼は "2026/11/17 11:30")。決まる前に実装しない。
