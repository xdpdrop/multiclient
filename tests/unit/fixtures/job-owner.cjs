const { spawn } = require('node:child_process');
const { join } = require('node:path');
console.log(JSON.stringify({ mode: 'owner', pid: process.pid }));
const runtime = spawn(process.execPath, [join(__dirname, 'process-tree.cjs')], {
  stdio: 'pipe',
  windowsHide: true,
});
runtime.stdout.pipe(process.stdout, { end: false });
runtime.stderr.pipe(process.stderr, { end: false });
const supervisor = spawn(process.argv[2], [String(runtime.pid)], {
  stdio: 'pipe',
  windowsHide: true,
});
console.log(JSON.stringify({ mode: 'supervisor', pid: supervisor.pid }));
let ready = '';
supervisor.stdout.on('data', (bytes) => {
  ready += bytes.toString();
  if (ready.trim() === 'READY') runtime.stdin.write('spawn\n');
});
supervisor.stderr.pipe(process.stderr, { end: false });
supervisor.stdin.on('error', () => {});
supervisor.on('error', () => {
  runtime.kill();
  process.exitCode = 1;
});
supervisor.on('exit', (code) => {
  if (code) {
    runtime.kill();
    process.exit(1);
  }
});
setInterval(() => {}, 1000);
