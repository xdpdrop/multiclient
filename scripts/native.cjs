const { spawnSync } = require('node:child_process');
const path = require('node:path');
async function main() {
  const electron = require('electron');
  const { rebuild } = await import('@electron/rebuild');
  // node-pty ships N-API binaries for Windows/macOS; rebuilding those unnecessarily
  // requires optional Visual Studio Spectre libraries and discards working prebuilds.
  await rebuild({
    buildPath: path.resolve(__dirname, '..'),
    electronVersion: require('electron/package.json').version,
    onlyModules: process.platform === 'linux' ? ['better-sqlite3', 'node-pty'] : ['better-sqlite3'],
  });
  const check = spawnSync(
    electron,
    [
      '-e',
      "require('better-sqlite3'); require('node-pty'); console.log('Native modules load successfully')",
    ],
    {
      cwd: path.resolve(__dirname, '..'),
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
      stdio: 'inherit',
    },
  );
  if (check.status !== 0) throw new Error('Native dependency verification failed.');
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
