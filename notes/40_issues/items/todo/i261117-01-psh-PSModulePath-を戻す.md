---
schema: 1
id: i261117-01
title: psh が 5.1 の powershell を呼ぶ前に、PSModulePath を Machine と User の値に戻す (--pwsh のときは戻さない)
group: 他プロジェクトからの要求
created: 2026-11-17
from: 20260824-local-llm-llama-cp #2007
confirmed: false
refs: #2007
---

依頼 #2007。PowerShell 7 の窓から psh が 5.1 (powershell) を起動すると、環境変数 PSModulePath に 7 の置き場が混ざり、Get-FileHash などが 5.1 で見つからなくなる。psh が 5.1 を呼ぶ前に、PSModulePath を Machine と User の値に戻してほしい (--pwsh のときは戻さない)。戻すと 5.1 で Get-FileHash が見つかることを、依頼元が実測で確かめている。

調べた結果 (11/17): psh には TS 版 (src/psh/psh-main.ts) と Rust 版 (src/psh-rs/src/psh-main.rs) があり、どちらにも PSModulePath の扱いは無い (src/ を PSModulePath で検索して 0 件)。直すなら両方と、試験 run-psh-tests が要る。自分では PSModulePath の混ざる現象を再現していない (未確認)。

決めること: Machine と User の値の読み方 (レジストリ HKLM と HKCU の Environment の PSModulePath。REG_EXPAND_SZ なので %…% を展開する) と、2 つを並べる順。
