/*
	案 B の中継。窓を持たないまま（detached で起動される）cmd /c <command> を起動し、終わるまで待つ。
	    relay.ts <cwd> <title> <command>
*/
import { spawn } from 'node:child_process';

const [cwd, title, command] = process.argv.slice(2);
const c = spawn('cmd.exe', ['/d', '/s', '/c', '"title ' + title + ' & ' + command + '"'], { cwd, stdio: 'inherit', windowsVerbatimArguments: true });
c.on('exit', (code) => process.exit(code ?? 0));
