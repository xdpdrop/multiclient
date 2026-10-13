import { it, expect } from 'vitest';
import { mkdtemp, mkdir, writeFile, symlink, rm, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { callWorkspaceTool } from '../../src/runtime/files/workspace-tools';

it('lists and reads project text while refusing traversal, junction escapes, secrets and writes', async () => {
  const base = await mkdtemp(join(tmpdir(), 'multiclient-files-'));
  const root = join(base, 'project');
  const outside = join(base, 'outside');
  await mkdir(root);
  await mkdir(outside);
  await writeFile(join(root, 'hello.txt'), 'Hello 🌍');
  await writeFile(join(root, '.env.local'), 'PRIVATE=secret');
  await writeFile(join(root, 'large.txt'), 'x'.repeat(100001));
  await writeFile(join(root, 'binary.bin'), Buffer.from([0, 1, 2]));
  await writeFile(join(outside, 'private.txt'), 'outside');
  await symlink(outside, join(root, 'escape'), process.platform === 'win32' ? 'junction' : 'dir');
  try {
    const listing = await callWorkspaceTool(root, 'list_directory', { path: '.' });
    expect('entries' in listing && listing.entries.map((entry) => entry.name)).toEqual([
      'binary.bin',
      'hello.txt',
      'large.txt',
    ]);
    expect(await callWorkspaceTool(root, 'read_file', { path: 'hello.txt' })).toEqual({
      path: 'hello.txt',
      content: 'Hello 🌍',
    });
    for (const path of [
      '../outside/private.txt',
      join(outside, 'private.txt'),
      'escape/private.txt',
    ])
      await expect(callWorkspaceTool(root, 'read_file', { path })).rejects.toThrow(/outside/);
    await expect(callWorkspaceTool(root, 'read_file', { path: '.env.local' })).rejects.toThrow(
      /excluded/,
    );
    await expect(callWorkspaceTool(root, 'read_file', { path: 'large.txt' })).rejects.toThrow(
      /100 KB/,
    );
    await expect(callWorkspaceTool(root, 'read_file', { path: 'binary.bin' })).rejects.toThrow(
      /Binary/,
    );
    await expect(callWorkspaceTool(root, 'delete_file', { path: 'hello.txt' })).rejects.toThrow(
      /Unknown/,
    );
    await expect(
      callWorkspaceTool(root, 'read_file', { path: 'hello.txt', command: 'anything' }),
    ).rejects.toThrow();
  } finally {
    await unlink(join(root, 'escape'));
    await rm(base, { recursive: true, force: true });
  }
});
