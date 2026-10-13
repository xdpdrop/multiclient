import { it, expect } from 'vitest';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { gitState } from '../../src/runtime/git';

const exec = promisify(execFile);
it('keeps staged, unstaged, renamed, new, binary and oversized changes distinct', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'multiclient-git-preview-'));
  const git = (args: string[]) => exec('git', args, { cwd: directory, windowsHide: true });
  try {
    await git(['init']);
    await writeFile(join(directory, 'mixed.txt'), 'original\n');
    await writeFile(join(directory, 'rename.txt'), 'preserved\n');
    await writeFile(join(directory, 'binary.bin'), Buffer.from([0, 1, 2]));
    await writeFile(join(directory, 'large.txt'), 'small\n');
    await git(['add', '.']);
    await git([
      '-c',
      'user.name=Fixture',
      '-c',
      'user.email=fixture@example.invalid',
      '-c',
      'commit.gpgsign=false',
      'commit',
      '-m',
      'fixture',
    ]);
    await writeFile(join(directory, 'mixed.txt'), 'staged\n');
    await git(['add', 'mixed.txt']);
    await writeFile(join(directory, 'mixed.txt'), 'unstaged\n');
    await git(['mv', 'rename.txt', 'renamed.txt']);
    await writeFile(join(directory, 'binary.bin'), Buffer.from([0, 3, 4]));
    await writeFile(join(directory, 'large.txt'), 'x'.repeat(100001));
    await writeFile(join(directory, 'new.txt'), 'hello new file\n');
    await writeFile(join(directory, 'new-binary.bin'), Buffer.from([0, 5]));
    const state = await gitState(directory);
    expect(state.error).toBeUndefined();
    const mixed = state.files.find((file) => file.path === 'mixed.txt')!;
    expect(mixed.staged?.text).toContain('+staged');
    expect(mixed.unstaged?.text).toContain('+unstaged');
    expect(state.files.find((file) => file.path === 'renamed.txt')?.staged?.text).toContain(
      'rename from rename.txt',
    );
    expect(state.files.find((file) => file.path === 'new.txt')?.untracked?.text).toContain(
      '+hello new file',
    );
    expect(state.files.find((file) => file.path === 'binary.bin')?.unstaged?.kind).toBe('binary');
    expect(state.files.find((file) => file.path === 'new-binary.bin')?.untracked?.kind).toBe(
      'binary',
    );
    expect(state.files.find((file) => file.path === 'large.txt')?.unstaged?.kind).toBe('oversize');
    expect(state.entries).toHaveLength(6);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}, 20000);
