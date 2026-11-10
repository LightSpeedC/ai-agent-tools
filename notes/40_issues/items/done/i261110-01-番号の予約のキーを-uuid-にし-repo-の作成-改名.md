---
schema: 1
id: i261110-01
title: 番号の予約のキーを uuid にし、repo の作成・改名・id の変更で割れないようにする
group: issue
created: 2026-11-10
---


## やること
- [済] キーを uuid_<uuid>_<id> にする。探すのは uuid の部分 (d1。p261109-01-d4 も含めて置き換える)
- [済] 今の github_… と uuid_<uuid> のフォルダを、key.json の uuid を見て新しい名前に移す
- [済] id が変わったら名前の後ろを付け直す (d2)
- [済] uuid が変わったときに予約が割れる穴を塞ぐ (oracle-cloud で起きた。原因も調べる)
- [済] プロジェクト id を変えたとき legacy_ids の旧 id を拾えるようにするか決める
- [済] TOOLS-USAGE ・ 詳細仕様に、repo の作成 ・ 改名 ・ id の変更で手順が要らないことを書く
- [済] 222-A は、移すではなく写すにした (実装のとき)。--new-id はコピーして別のプロジェクトにしたときにも使うので、移すと元の予約を取り上げる。試験は写すの形で書き直した (写すの形の ❌Red は見ていない)
- [済] 223-B は、former_ids を作らず、既にある legacy_names (154-A) を使った。同じ役目のキーを 2 つにしないため
- [済] oracle-cloud で uuid が変わった原因を調べる (2026-11-10、oracle-cloud に git の履歴を問い合わせ中)。project-uuid.txt を消して init し直すと、前の uuid が分からず、予約を引き継げない
- [済] oracle-cloud の返事 (2026-11-10): git の履歴に出るのは 1313… だけで、bb13… は一度も commit されていない。記録で確かめられたのは issue init を 1 回流したことだけ。bb13… の予約 (17:28) は decide migrate が取った。そのとき project-uuid.txt を作ったのは、issue new ・ decide new が無ければ自動で作る処理の見込み (ops.ts の newIssue)。その後 1313… に変わった理由は分からない (消して作り直した ・ 別の写しで流した、のどちらか。確かめていない)
- [済] 227-A を入れた。新しく置き場を作るとき、同じ project_id の別の uuid の置き場があれば [警告] を出す (numbers.ts の numbersBaseOf)。試験を先に足し ❌Red 1 件を見てから直した。✅ bun ・ node とも 44 件
