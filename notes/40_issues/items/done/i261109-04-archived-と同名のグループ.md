---
schema: 1
id: i261109-04
title: グループが archived/ と未・着手の両方にあると、issue new がそのグループに立てられない
group: issue
created: 2026-11-09
from: ai-chat-lite
confirmed: true
---

ai-chat-lite の #1865。migrate で保管の 3 件を着手に移したため、グループ「チャットの機能」が archived/ と doing/ の両方にある。issue new --group チャットの機能 が「archived/ に退避済み」で止まる。

原因: issue new は、同じグループの課題が archived/ に 1 件でもあると止めていた (112-A)。未・着手の課題が残っているかを見ていなかった。

当座の手 (#1866): issue unarchive チャットの機能 で archived/ の課題を done/ に戻せば、issue new が通る。

## やること

- [済] 一部だけが保管されたグループにも issue new で立てられるようにする。止めるのは全件が保管のときだけ (215-A、65998dd)
- [済] 保管の有無によらず、issue new はどのグループにも立てられるようにする (d4。利用者の指示で 112-A ・ 215-A を改めた)
- [済] issue archive <番号> で、済の課題を 1 件ずつ保管できるようにする (214-A、65998dd)
- [済] issue archive --done-before <日付> [--dry-run] で、その日より前に立てた済の課題をまとめて保管できるようにする (216-A、a411188)
- [済] ai-chat-lite へ直したことと確かめ方を返す (#1868)
- [済] ai-chat-lite の確認を受けて閉じる (#1870。2b5ee00 で issue new が通った)
