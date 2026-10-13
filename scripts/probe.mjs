import { spawn } from 'node:child_process';
import { homedir } from 'node:os';
// Read-only discovery. No model calls, login, credential reads or workspace changes.
for (const command of ['codex', 'claude', 'agent']) {
  const executable = process.platform === 'win32' ? command + '.exe' : command;
  await new Promise((resolve) => {
    const child = spawn(executable, ['--version'], {
      cwd: homedir(),
      shell: false,
      windowsHide: true,
    });
    let text = '';
    child.stdout.on('data', (chunk) => (text += chunk));
    child.stderr.resume();
    const timeout = setTimeout(() => child.kill(), 10000);
    child.on('error', () => {
      clearTimeout(timeout);
      console.log(`${command}: not installed or not on PATH`);
      resolve();
    });
    child.on('exit', (code) => {
      clearTimeout(timeout);
      console.log(`${command}: ${code === 0 ? text.trim() : 'probe failed'}`);
      resolve();
    });
  });
}
