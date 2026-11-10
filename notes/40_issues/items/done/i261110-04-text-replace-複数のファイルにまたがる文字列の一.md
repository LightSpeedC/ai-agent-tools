---
schema: 1
id: i261110-04
title: text replace: 複数のファイルにまたがる文字列の一括置換
group: 運用・方針の決定事項
created: 2026-11-10
from: ai-obsidian-vault
confirmed: true
---

2026-11-10、ai-obsidian-vault の依頼 (#1888)。Vault でノート名を変えたとき、リンク 59 か所・21 ファイルを Edit で 1 件ずつ書き換えた。text edit は 1 か所にだけ一致するときしか使えず、sed はフックで止まる。要件: (1) --path と --recurse ・ --include でファイルを選ぶ (2) 1 ファイルの中の全部の一致を置き換える (3) 元の文字コード ・ BOM ・ 改行を保つ (SJIS ・ UTF-16 も) (4) --dry-run で、ファイルごとの件数と変わる行を出し、書き換えない (5) 本番でもファイルごとの件数と合計を出す (6) 一致が 0 件なら、0 件と言って終了コードで分かるようにする。

## やること
- [済] text find にも --regex を足す (利用者の指示、2026-11-10)
- [済] 実装した (2026-11-10)。src/text/replace.ts を足し、text find に --regex を足した (find.ts の makePattern ・ selectTargets を共有)。試験 run-text-replace-tests.ts を先に書き ❌Red 26 件を見てから直した。✅ bun ・ node とも 35 件。前からある text の試験 92 件も bun ・ node とも成功。TOOLS-USAGE に書いた。計画書は書かずに進めた (要件が依頼で決まっていて、決めたことは d1〜d3)
- [済] 報告元 (ai-obsidian-vault) の確認を待つ
- [済] 報告元の確認 (#1893): Vault で --dry-run を流し、合計 60 件 ・ 20 ファイルが別に数えた一致の数と合った。ファイルごとの件数と変わる行が出て、git status は空のまま
