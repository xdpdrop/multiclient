const { spawn } = require('node:child_process');
const mode = process.argv[2] || 'runtime';
console.log(JSON.stringify({ mode, pid: process.pid }));
function descendants() {
  const child = spawn(process.execPath, [__filename, mode === 'runtime' ? 'child' : 'grandchild'], {
    stdio: ['ignore', 'pipe', 'inherit'],
    windowsHide: true,
  });
  child.stdout.pipe(process.stdout, { end: false });
}
if (mode === 'runtime') process.stdin.once('data', descendants);
else if (mode === 'child') descendants();
setInterval(() => {}, 1000);
