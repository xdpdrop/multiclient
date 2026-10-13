import { mkdtemp, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { realpath } from 'node:fs/promises';
import { afterEach, expect, it } from 'vitest';
import { addedProjectId } from '../e2e/project-path';

const directories: string[] = [];
afterEach(async () => {
  const { rm } = await import('node:fs/promises');
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

it('matches a folder stored at the canonical path of a symlinked selection', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'multiclient-project-real-'));
  const parent = await mkdtemp(join(tmpdir(), 'multiclient-project-link-'));
  directories.push(directory, parent);
  const link = join(parent, 'linked-project');
  await symlink(directory, link);
  const canonical = await realpath(link);
  expect(canonical).not.toBe(link);
  expect(
    await addedProjectId(
      [{ id: 'project-1', name: basename(directory), path: canonical, kind: 'folder' }],
      link,
    ),
  ).toBe('project-1');
});

it('matches the only folder whose leaf name survives an 8.3 or symlink rewrite', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'multiclient-project-leaf-'));
  directories.push(directory);
  const leaf = basename(directory);
  const stored = `C:\\Users\\runneradmin\\AppData\\Local\\Temp\\${leaf}`;
  expect(await realpath(directory)).not.toBe(stored);
  expect(
    await addedProjectId(
      [{ id: 'project-2', name: leaf, path: stored, kind: 'folder' }],
      directory,
    ),
  ).toBe('project-2');
});

it('does not treat a chat project or two folders with the same leaf as a match', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'multiclient-project-ambiguous-'));
  directories.push(directory);
  const leaf = basename(directory);
  await expect(
    addedProjectId(
      [
        { id: 'chat', name: leaf, kind: 'chat' },
        { id: 'one', name: leaf, path: `D:\\one\\${leaf}`, kind: 'folder' },
        { id: 'two', name: leaf, path: `D:\\two\\${leaf}`, kind: 'folder' },
      ],
      directory,
    ),
  ).rejects.toThrow(/not found/);
});
