const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

/**
 * node-pty ships Node-API binaries for Windows and macOS. Linux still needs
 * an Electron rebuild. better-sqlite3 is never rebuilt: v13 ships one Node-API
 * binary per platform inside the npm package, and @electron/rebuild does not
 * recognize prebuilds/<platform>-<arch>.node, so it would call node-gyp.
 * On Windows, node-gyp configure calls findVisualStudio before binding.gyp
 * can no-op, which fails when Visual Studio is not installed.
 */
function modulesToRebuild(platform = process.platform) {
  return platform === 'linux' ? ['node-pty'] : [];
}

function sqlitePrebuildRelative(platform, arch, musl = false) {
  const osName = platform === 'linux' && musl ? 'linuxmusl' : platform;
  return path.join('prebuilds', `${osName}-${arch}.node`);
}

/**
 * node-pty 1.1.0 publishes darwin prebuilds/spawn-helper as mode 0644.
 * macOS pty.spawn posix_spawns that helper, and a non-executable file
 * throws "posix_spawnp failed." Linux uses forkpty and does not need it.
 * chmod here instead of rebuilding node-pty, which would require a compiler.
 */
function ensureSpawnHelpersExecutable(root) {
  const base = path.join(root, 'node_modules', 'node-pty');
  const helpers = [];
  const walk = (directory) => {
    if (!fs.existsSync(directory)) return;
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const full = path.join(directory, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name === 'spawn-helper') {
        fs.chmodSync(full, 0o755);
        helpers.push(full);
      }
    }
  };
  walk(path.join(base, 'prebuilds'));
  walk(path.join(base, 'build'));
  return helpers;
}

function assertSqlitePrebuild(root, platform = process.platform, arch = process.arch) {
  const musl =
    platform === 'linux' &&
    platform === process.platform &&
    !process.report.getReport().header.glibcVersionRuntime;
  const relative = sqlitePrebuildRelative(platform, arch, musl);
  const file = path.join(root, 'node_modules', 'better-sqlite3', relative);
  if (!fs.existsSync(file)) {
    throw new Error(
      `better-sqlite3 is missing its bundled Node-API prebuild (${relative}). Refusing to compile it from source.`,
    );
  }
  return file;
}

async function main() {
  const electron = require('electron');
  const root = path.resolve(__dirname, '..');
  assertSqlitePrebuild(root);
  ensureSpawnHelpersExecutable(root);
  const modules = modulesToRebuild();
  if (modules.length > 0) {
    const { rebuild } = await import('@electron/rebuild');
    await rebuild({
      buildPath: root,
      electronVersion: require('electron/package.json').version,
      onlyModules: modules,
    });
  }
  const check = spawnSync(
    electron,
    [
      '-e',
      "require('better-sqlite3'); require('node-pty'); console.log('Native modules load successfully')",
    ],
    {
      cwd: root,
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
      stdio: 'inherit',
    },
  );
  if (check.status !== 0) throw new Error('Native dependency verification failed.');
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}

module.exports = {
  modulesToRebuild,
  sqlitePrebuildRelative,
  assertSqlitePrebuild,
  ensureSpawnHelpersExecutable,
};
