# 測定用。数秒止まってから 1 行出す。止まっている間にプロセスツリーを取る
Start-Sleep -Seconds 4
Write-Output '終わりました'
