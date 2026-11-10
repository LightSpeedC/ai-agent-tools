---
schema: 1
id: i261109-02
title: issue migrate の --state-override で 済 を渡すと、食い違いの一覧から外れず --apply が止まる
group: issue
created: 2026-11-09
from: ai-chat-lite
confirmed: true
---

ai-chat-lite の #1860。旧の記録が済で、未のやることが残る課題 (issues-archive.html 側の 3 件) を、旧の記録どおり 済 (保管) で移す手がほしいという依頼。調べた結果、169-A の仕様どおりの動き (試験 run-issue-migrate-tests.ts で、済 の指定を拒むことを確かめている)。209-A で仕様は変えず、旧 HTML の残っているやることを 済 にするか消すかしてから移すよう #1861 で返した。報告元の確認を待つ。

2026-11-10、#1896 で確認を依頼し、#1897 で ai-chat-lite から確認済みの返事を受けた (9ab458f で移し終え、migrate --dry-run が止まらずに通る)。済にする。
