---
schema: 1
id: i261110-08
title: text replace の 3 点 (--expect 0、管理外の置き場、ファイル名の置き換え)
group: text
created: 2026-11-10
from: file-manager
confirmed: true
---

file-manager の #1911。課題の番号の振り直し (10 種類・131 件) で手間取った 3 点。

## やること

- [済] 1: --expect 0 で一致が 0 件なら終了コード 0 にした (試験を先に足し ❌Red を見てから直した。text-replace 38 件 bun ・ node とも ✅)。2026-11-10 23:15、#1913 で file-manager から確認済み
- [済] 2: --path を root にすると、Rust の target など .gitignore で外したものまで読む。238-A: git の管理下では既定で外す (find ・ replace とも)。git ls-files -o -i --exclude-standard --directory で外したフォルダを受け取り、中に入らない。--path そのものが外されているときは今までどおり読む。試験を先に足し ❌Red 4 件を見てから作った (text-replace 44 件 ・ text 92 件、bun ・ node とも ✅)。'.' で check-ignore を聞くと、利用者の全体の .gitignore の書き方でリポジトリの頭でも「外した」と返ったので、頭では聞かない形にした
- [済] 3: 番号がファイル名にも入っていた。239-A: --rename を足す (git の管理下なら git mv)。名前の一致も合計と --expect に数え、ぶつかり ・ 使えない文字は終了コード 7 で何も書かない。試験を先に足し ❌Red を見てから作った (text-replace 58 件 ・ text 92 件、bun ・ node とも ✅)
- [済] 2 と 3 を #1917 で file-manager に知らせた (commit は 814584f ・ 7a054c5)。2026-11-10 23:34、#1918 で確認済みの返事 (root の --dry-run が 2 分超から 3 秒に。--rename は git mv で RM)
