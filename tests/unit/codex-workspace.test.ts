import { mkdtemp, realpath, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { codexToolsRoot } from '../../src/runtime/providers/codex';

it('keeps a Windows Codex tools root on the spawn path', async () => {
  const cwd = 'C:\\Users\\RUNNER~1\\AppData\\Local\\Temp\\workspace';
  expect(await codexToolsRoot(cwd, 'win32')).toBe(cwd);
});

it('resolves a POSIX Codex tools root to the path getcwd() reports', async () => {
  const real = await mkdtemp(join(tmpdir(), 'multiclient-codex-root-'));
  const parent = await mkdtemp(join(tmpdir(), 'multiclient-codex-link-'));
  const link = join(parent, 'workspace');
  await symlink(real, link);
  try {
    expect(await realpath(link)).not.toBe(link);
    expect(await codexToolsRoot(link, 'linux')).toBe(await realpath(link));
    expect(await codexToolsRoot(link, 'darwin')).toBe(await realpath(link));
  } finally {
    await rm(parent, { recursive: true, force: true });
    await rm(real, { recursive: true, force: true });
  }
});
