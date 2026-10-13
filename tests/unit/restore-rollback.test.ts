import { beforeEach, describe, expect, it, vi } from 'vitest';
import { join, resolve, sep } from 'node:path';
import { installRestore } from '../../src/main/history';
import type { RuntimeHost } from '../../src/main/runtime';

const fixture = vi.hoisted(() => ({
  files: new Map<string, string>(),
  removals: [] as string[],
  failPath: '',
}));
vi.mock('../../src/runtime/storage/backup', () => ({ sanitizeRestoredProfile: vi.fn() }));
vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return {
    ...actual,
    mkdtemp: async (prefix: string) => `${prefix}fixture`,
    access: async (path: string) => {
      if (!fixture.files.has(path))
        throw Object.assign(new Error('Missing fixture'), { code: 'ENOENT' });
    },
    rename: async (from: string, to: string) => {
      if (from === fixture.failPath) throw new Error('Fixture WAL move failed');
      fixture.files.set(to, fixture.files.get(from)!);
      fixture.files.delete(from);
    },
    rm: async (path: string, options?: { recursive?: boolean }) => {
      fixture.removals.push(path);
      for (const key of fixture.files.keys())
        if (key === path || (options?.recursive && key.startsWith(path + sep)))
          fixture.files.delete(key);
    },
  };
});
beforeEach(() => {
  fixture.files.clear();
  fixture.removals.length = 0;
  fixture.failPath = '';
});
describe('restore rollback preserves unmoved original sidecars', () => {
  it('restores the moved database without deleting the original WAL or SHM when WAL movement fails', async () => {
    const directory = resolve('fixture-profile');
    const staged = join(directory, 'restore-fixture');
    const original = {
      'multiclient.sqlite': 'Original DB',
      'multiclient.sqlite-wal': 'Original WAL',
      'multiclient.sqlite-shm': 'Original SHM',
      assets: 'Original assets',
    };
    for (const [name, value] of Object.entries(original))
      fixture.files.set(join(directory, name), value);
    fixture.files.set(join(staged, 'multiclient.sqlite'), 'Replacement DB');
    fixture.files.set(join(staged, 'assets'), 'Replacement assets');
    fixture.failPath = join(directory, 'multiclient.sqlite-wal');
    const host = { stop: vi.fn(async () => {}), start: vi.fn(async () => {}), request: vi.fn() };
    await expect(installRestore(host as unknown as RuntimeHost, directory, staged)).rejects.toThrow(
      'Fixture WAL move failed',
    );
    for (const [name, value] of Object.entries(original))
      expect(fixture.files.get(join(directory, name))).toBe(value);
    expect(fixture.removals).not.toContain(join(directory, 'multiclient.sqlite-wal'));
    expect(fixture.removals).not.toContain(join(directory, 'multiclient.sqlite-shm'));
    expect(host.start).toHaveBeenCalledTimes(1);
    expect(host.request).not.toHaveBeenCalled();
  });
});
