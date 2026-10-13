import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, readFile, rm, writeFile, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createManagedWorktree, removeManagedWorktree } from '../../src/runtime/git/worktrees';
import { childEnvironment, exec, findExecutable } from '../../src/runtime/providers/process';
import { checkoutOwnership } from '../../src/runtime/files/ownership';

const directories: string[] = [];
afterEach(async () => {
  for (const path of directories.splice(0)) await rm(path, { recursive: true, force: true });
});
async function repository() {
  const root = await mkdtemp(join(tmpdir(), 'multiclient-worktree-'));
  directories.push(root);
  const project = join(root, 'repository');
  const data = join(root, 'data');
  await mkdir(project);
  await mkdir(data);
  const executable = await findExecutable('git');
  const git = async (cwd: string, args: string[]) =>
    (
      await exec(executable, args, { cwd, windowsHide: true, env: childEnvironment() })
    ).stdout.trim();
  await git(project, ['init']);
  await git(project, ['config', 'user.email', 'fixture@example.invalid']);
  await git(project, ['config', 'user.name', 'Fixture']);
  await writeFile(join(project, 'file.txt'), 'Committed content');
  await git(project, ['add', 'file.txt']);
  await git(project, ['commit', '-m', 'Fixture']);
  return { project, data, git };
}
describe('managed workspace safety', () => {
  it('identifies nested directories as one checkout while separating real managed worktrees', async () => {
    const { project, data } = await repository();
    const nested = join(project, 'nested');
    await mkdir(nested);
    const workspace = await createManagedWorktree(project, data, 'HEAD');
    expect(await checkoutOwnership(nested)).toBe(await checkoutOwnership(project));
    expect(await checkoutOwnership(workspace.path)).not.toBe(await checkoutOwnership(project));
  });
  it('uses an explicit committed ref and does not copy dirty source files', async () => {
    const { project, data } = await repository();
    await writeFile(join(project, 'file.txt'), 'Uncommitted source change');
    const workspace = await createManagedWorktree(project, data, 'HEAD');
    expect(workspace.branch).toMatch(/^codex\/multiclient-/);
    expect(await readFile(join(workspace.path, 'file.txt'), 'utf8')).toBe('Committed content');
    await expect(removeManagedWorktree(project, workspace.path, data)).rejects.toThrow(
      /no upstream/,
    );
    await writeFile(join(workspace.path, 'new.txt'), 'Unsaved work');
    await expect(removeManagedWorktree(project, workspace.path, data)).rejects.toThrow(
      /untracked files/,
    );
    expect(await readFile(join(workspace.path, 'new.txt'), 'utf8')).toBe('Unsaved work');
  });
  it('rejects option-like references and unrelated checkout removal', async () => {
    const { project, data } = await repository();
    await expect(createManagedWorktree(project, data, '--help')).rejects.toThrow(/local branch/);
    await expect(removeManagedWorktree(project, project, data)).rejects.toThrow(
      /application-owned/,
    );
  });
  it('preserves ignored files and unpushed commits, then removes only a clean published checkout', async () => {
    const { project, data, git } = await repository();
    const workspace = await createManagedWorktree(project, data, 'HEAD');
    const remote = join(data, 'remote.git');
    await git(project, ['init', '--bare', remote]);
    await git(workspace.path, ['remote', 'add', 'fixture', remote]);
    await git(workspace.path, ['push', '-u', 'fixture', workspace.branch]);
    await writeFile(join(project, '.git', 'info', 'exclude'), 'scratch.tmp\n');
    await writeFile(join(workspace.path, 'scratch.tmp'), 'Ignored data to preserve');
    await expect(removeManagedWorktree(project, workspace.path, data)).rejects.toThrow(
      /untracked files/,
    );
    expect(await readFile(join(workspace.path, 'scratch.tmp'), 'utf8')).toBe(
      'Ignored data to preserve',
    );
    await unlink(join(workspace.path, 'scratch.tmp'));
    await writeFile(join(workspace.path, 'file.txt'), 'Local commit');
    await git(workspace.path, ['add', 'file.txt']);
    await git(workspace.path, ['commit', '-m', 'Local work']);
    await expect(removeManagedWorktree(project, workspace.path, data)).rejects.toThrow(
      /unpushed commits/,
    );
    await git(workspace.path, ['push', 'fixture', workspace.branch]);
    await removeManagedWorktree(project, workspace.path, data);
    await expect(readFile(join(workspace.path, 'file.txt'))).rejects.toThrow();
    expect(await git(project, ['rev-parse', '--verify', workspace.branch])).toMatch(
      /^[a-f0-9]{40}$/,
    );
  });
});
