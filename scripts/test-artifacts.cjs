const { spawnSync } = require('node:child_process');
const result = spawnSync(require('electron'), ['out/main/artifacts-test.js'], {
  stdio: 'inherit',
  env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
});
process.exit(result.status ?? 1);
