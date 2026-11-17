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

決めること: 1 note の複数行の書式 (YAML の | の塊 / 1 行にして \n で表す / 別の形)。2 4 つの鍵の並ぶ位置 (KeyOrder のどこか)。3 --missing の対象の鍵と、書式。4 released の書式 (依頼は "2026/11/17 11:30")。決めた (11/17): 269-A (note は | の塊) ・ 270-A (refs の後ろに version → released → kind → note) ・ 271-A (--missing はカンマ区切り) ・ 272-B (released は 2026-11-17 11:30 に統一)。決定 i261117-03-d1 〜 d4。

今ある動き: (1) issue set --state が、課題を隣のフォルダへ動かす・済にできない理由を出す・既に同じ状態なら動かさない (run-issue-edit-tests ・ run-issue-ops-tests の set の節)。(2) issue list が、既定で未・着手を id の順に出し、--state ・ --all ・ --group で絞る (run-issue-ops-tests の list の節)。(3) issue show が、全文と --json の meta を出す (同 show の節)。(4) issue check が、知らない鍵を警告にし、鍵の順と値の形を検査する (run-issue-tests)。(5) メタ情報の 1 行ごとの読み (引用符なし・空行は誤り・値が空は誤り・重複は誤り)。すべて、直したあとも同じ試験で ✅ (bun ・ node の両方)。

レビュー (11/18、子セッション tools-review。設計とソースを読んだ。9 件): 直した 2 件 — (1) --state と鍵を一緒に指定して --state が誤り ・ 済にできない ・ archived のとき、鍵だけが書かれていた。先に鍵の検査 (dryRun) をし、状態を動かしてから鍵を書く順に直した (試験 5 件を足し ❌Red → ✅)。(4) 塊の中の空行が 2 字の空白だけの行で、末尾の空白を消すエディタで塊が切れる。空行のままでも読み、空行のまま書くように直した (試験を足し ❌Red → ✅)。直さない 7 件、条件を記録 — (2) 前からある「キー: |」の意味が変わる: 課題 ・ 決定を、このプロジェクトと file-manager で Grep して 0 件 (実測)。他のプロジェクトは数えていない。(3) 書き込みが原子的でない: setConfirmed ・ editTodo ・ setState も同じで、新しい弱点ではない。全部の書き込みをまとめて直す別の課題 i261118-01 に立てた。(5) 形の誤り (重複 ・ x-foo) のあるファイルにも書く: x-foo のような今は誤りの鍵を、残したまま書くための設計 (file-manager の確かめ方)。重複は最初の 1 つだけを書き換え、check が誤りのまま知らせる。(6) 前の鍵が無い場合: schema が必須で起きない。(7) version ・ kind の値の検査: 形を決めていない。--note -x は値として通ることを測った。(8) archived にも鍵だけは書ける: 状態を問わない依頼 (828-A) のため。仕様に書いた。(9) psh の PSModulePath: 足した置き場が届かなくなる動きを TOOLS-USAGE に書いた。

## やること
- [済] 試験を先に足し ❌Red を見てから、meta ・ check ・ ops ・ main を直す (run-issue-tests ・ run-issue-ops-tests。bun ・ node とも ✅)
- [済] 仕様 (課題ファイルの形と検査) と TOOLS-USAGE を更新する
- [未] file-manager へ実装済みを知らせ、確認をもらう (version のあと、ハイフンを含む鍵 (x-foo) は今も形の誤りなので、確かめ方は x_foo で)
