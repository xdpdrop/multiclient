import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';

const { modulesToRebuild, sqlitePrebuildRelative, assertSqlitePrebuild } = createRequire(
  import.meta.url,
)('../../scripts/native.cjs');

it('never asks electron-rebuild to compile better-sqlite3', () => {
  for (const platform of ['win32', 'darwin', 'linux']) {
    expect(modulesToRebuild(platform)).not.toContain('better-sqlite3');
  }
  expect(modulesToRebuild('win32')).toEqual([]);
  expect(modulesToRebuild('darwin')).toEqual([]);
  expect(modulesToRebuild('linux')).toEqual(['node-pty']);
});

it('names the bundled Node-API prebuild, including Windows', () => {
  expect(sqlitePrebuildRelative('win32', 'x64')).toBe(join('prebuilds', 'win32-x64.node'));
  expect(sqlitePrebuildRelative('darwin', 'arm64')).toBe(join('prebuilds', 'darwin-arm64.node'));
  expect(sqlitePrebuildRelative('linux', 'x64', true)).toBe(
    join('prebuilds', 'linuxmusl-x64.node'),
  );
  for (const name of ['win32-x64.node', 'darwin-x64.node', 'darwin-arm64.node', 'linux-x64.node']) {
    const bytes = readFileSync(join('node_modules/better-sqlite3/prebuilds', name));
    expect(bytes.includes(Buffer.from('napi_register_module_v1'))).toBe(true);
    expect(bytes.includes(Buffer.from('node_register_module_v'))).toBe(false);
  }
});

it('refuses a source build when the bundled prebuild is absent', async () => {
  const root = await mkdtemp(join(tmpdir(), 'sqlite-prebuild-'));
  try {
    expect(() => assertSqlitePrebuild(root, 'win32', 'x64')).toThrow(/Refusing to compile/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
