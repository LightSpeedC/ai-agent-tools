# 決定の状態と choice next 計画 (ai-agent-tools)

決定に「決めた ・ 仮に決めた ・ 答え待ち」の状態を持たせ、`issue decide migrate` がその状態で移せるようにする。`issue choice next` が決定の題の番号も数えるようにする。課題 i261111-06 (file-manager の #1920) と i261111-01。

> 📅 作成: 2026-11-11 / 更新: 2026-11-11

[^^](../../README.md)

**対象 ・ 入力 ・ 出力**: 対象は、このプロジェクトの `src/issue/` (`numbers.ts` ・ `check.ts` ・ `decide.ts` ・ `decide-migrate.ts` ・ `render.ts` ・ `main.ts`) と試験、仕様 [課題ファイルの形と検査](../50_spec/課題ファイルの形と検査.md)、TOOLS-USAGE。入力は決定のファイルと旧資料。出力は決定のファイルの `status`。

## 目次

1. [決めたこと](#1-決めたこと)
2. [今ある動きと試験](#2-今ある動きと試験)
3. [進め方](#3-進め方)

## 1. 決めたこと

| 番号 | 問い | 選んだ案 |
|---|---|---|
| 244-A | 選択肢の番号の取り方 (i261111-01-d1) | `issue choice next` が、決定の題 (`NNN:` で始まる) の番号も数える。予約に無い番号を知らせる Stop フックは ai-agent-rules に頼んだ (#1923) |
| 249-A | 答え待ち ・ 仮に決めた決定の扱い (i261111-06-d1) | 決定に `status` を持たせる。migrate は名指しした番号をその状態で移す。あとで `issue decide set` で変える。選ばなかった案: 名指しした番号を移さない / 資料の言葉で見分ける |

## 2. 今ある動きと試験

今ある動き: 直したあとも、次の動きを保つ。

- 決定は、書けば「決めた」として扱う (run-issue-decide-tests)
- migrate は、資料の番号を全部、決定として移す (run-issue-decide-migrate-tests)
- `issue choice next` は、予約と legacy_ids の旧番号の大きい方の次を返す。worktree の間でも重ならない (run-issue-numbers-tests)
- `issue check` は、決定のキーの順と値を検査する (run-issue-tests)

## 3. 進め方

どの手順も、試験を先に書き、❌Red を見てから作る。bun と node の両方で流す。

1. **choice next が、決定の題の番号も数える** (244-A)。「37 件の表」のような題の途中の数字は数えない
2. **決定に `status` を持たせる** (249-A)。値は `決めた` ・ `仮に決めた` ・ `答え待ち`。書いていなければ `決めた`。`issue check` で値を検査し、render は決めた以外の決定に印を付ける
3. **migrate の `--pending <番号,…>` ・ `--provisional <番号,…>`**。名指しした番号を、その状態で移す
4. **`issue decide set <id> --status <状態> [--chosen <字>]`**。状態と選んだ字を、あとから変える
5. 仕様 ・ TOOLS-USAGE を直し、file-manager に知らせて確認を頼む

[^^](../../README.md)
