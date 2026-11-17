---
schema: 1
id: i261117-01
title: psh が 5.1 の powershell を呼ぶ前に、PSModulePath を Machine と User の値に戻す (--pwsh のときは戻さない)
group: 他プロジェクトからの要求
created: 2026-11-17
from: 20260824-local-llm-llama-cp #2007
confirmed: true
refs: #2007
---

依頼 #2007。PowerShell 7 の窓から psh が 5.1 (powershell) を起動すると、環境変数 PSModulePath に 7 の置き場が混ざり、Get-FileHash などが 5.1 で見つからなくなる。psh が 5.1 を呼ぶ前に、PSModulePath を Machine と User の値に戻してほしい (--pwsh のときは戻さない)。戻すと 5.1 で Get-FileHash が見つかることを、依頼元が実測で確かめている。

調べた結果 (11/17): psh には TS 版 (src/psh/psh-main.ts) と Rust 版 (src/psh-rs/src/psh-main.rs) があり、どちらにも PSModulePath の扱いは無い (src/ を PSModulePath で検索して 0 件)。直すなら両方と、試験 run-psh-tests が要る。自分では PSModulePath の混ざる現象を再現していない (未確認)。

決めること: Machine と User の値の読み方 (レジストリ HKLM と HKCU の Environment の PSModulePath。REG_EXPAND_SZ なので %…% を展開する) と、2 つを並べる順。

レビュー (11/18、子セッション tools-review): TS 版と Rust 版は、同じ条件で大小を問わず外し、窓と取り込みの 2 つの経路の両方に入っている。見たが指摘は 1 件だけ — 呼び出し元で PSModulePath に足した置き場が、psh 経由の 5.1 に届かなくなる。TOOLS-USAGE の psh の節に書いた (ps1 の中で足すか --pwsh を付ける)。

## やること
- [済] TS 版 ・ Rust 版の spawn で、5.1 のとき PSModulePath を外す (--pwsh は外さない)。run-psh-tests の 14 を足す
- [済] TOOLS-USAGE の psh の節に説明を足す
- [済] 依頼元 (20260824-local-llm-llama-cp) へ報告し、確認を待つ
