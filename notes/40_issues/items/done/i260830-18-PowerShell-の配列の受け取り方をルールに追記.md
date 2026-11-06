---
schema: 1
id: i260830-18
title: PowerShell の配列の受け取り方をルールに追記
group: 運用・方針の決定事項
created: 2026-08-30
---

CLAUDE.md の「PowerShellの落とし穴」には「関数から配列を返すときは `return ,$array`」とあるが、**受け取り側の書き方が規定されていない**。そこで踏んだ。

```
// 誤り1: foreach に直接渡すと、配列そのものが 1 要素として来る
foreach ($b in (Convert-Blocks ... )) { }

// 誤り2: @() で包むと外側が剥がれず、1 要素の配列（中身が配列）になる
$blocks = @(Convert-Blocks $body $ctx)

// 正しい: 代入だけにすると外側が外れる
$sub = Convert-Blocks ...
```

ps1 が出力 `System.Object[]` の 1 行だけになる、という形で表面化した。ルールに 1 行足す案を出した。

✅ **済** 共通ルールの「PowerShellの落とし穴」に**受け取り側の書き方**として反映済み（「受け取るときは変数に代入する。`foreach` に直接渡す・`@()` で包む、はどちらも壊れる」）（i260910-03 の7）。
