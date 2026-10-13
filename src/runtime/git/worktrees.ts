import { randomUUID } from 'node:crypto';
import { mkdir, readFile, realpath, unlink, writeFile } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { z } from 'zod';
import { contained } from '../files';
import { childEnvironment, exec, findExecutable } from '../providers/process';

const metadataSchema = z
  .object({
    path: z.string(),
    sourcePath: z.string(),
    branch: z.string(),
    sourceRef: z.string(),
    commit: z.string(),
  })
  .strict();
export type ManagedWorktree = z.infer<typeof metadataSchema>;

async function environment(projectPath: string, dataDir: string) {
  const project = await realpath(projectPath);
  const executable = await findExecutable('git', '', project);
  const data = await realpath(dataDir);
  const directory = join(data, 'worktrees');
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const root = await realpath(directory);
  if (!contained(data, root))
    throw new Error('Managed workspace storage is outside the application data directory.');
  const hooks = join(root, '.disabled-hooks');
  await mkdir(hooks, { recursive: true, mode: 0o700 });
  if (!contained(root, await realpath(hooks)))
    throw new Error('Managed workspace hook configuration is invalid.');
  const run = async (cwd: string, args: string[]) => {
    const { stdout } = await exec(
      executable,
      ['--no-pager', '-c', 'core.fsmonitor=false', '-c', `core.hooksPath=${hooks}`, ...args],
      {
        cwd,
        windowsHide: true,
        env: { ...childEnvironment(), GIT_TERMINAL_PROMPT: '0' },
        timeout: 30000,
        maxBuffer: 1024 * 1024,
      },
    );
    return stdout.replace(/\r?\n$/, '');
  };
  const sourcePath = await realpath(await run(project, ['rev-parse', '--show-toplevel']));
  return { root, sourcePath, run };
}

export async function createManagedWorktree(
  projectPath: string,
  dataDir: string,
  sourceRef: string,
): Promise<ManagedWorktree> {
  if (
    !sourceRef ||
    sourceRef.length > 256 ||
    sourceRef.startsWith('-') ||
    /[\x00-\x1f\x7f]/.test(sourceRef)
  )
    throw new Error('Choose an existing local branch or commit reference.');
  const { root, sourcePath, run } = await environment(projectPath, dataDir);
  const commit = await run(sourcePath, [
    'rev-parse',
    '--verify',
    '--end-of-options',
    `${sourceRef}^{commit}`,
  ]);
  if (!/^[a-f0-9]{40,64}$/i.test(commit))
    throw new Error('The selected reference is not a local commit.');
  const id = randomUUID();
  const path = join(root, id);
  const branch = `codex/multiclient-${id}`;
  const worktree: ManagedWorktree = { path, branch, sourcePath, sourceRef, commit };
  // Record ownership before Git runs; a partial failure must remain discoverable.
  await writeFile(join(root, `${id}.json`), JSON.stringify(worktree), { flag: 'wx', mode: 0o600 });
  await run(sourcePath, ['worktree', 'add', '-b', branch, path, commit]);
  return worktree;
}

export async function removeManagedWorktree(
  projectPath: string,
  worktreePath: string,
  dataDir: string,
) {
  const { root, sourcePath, run } = await environment(projectPath, dataDir);
  const path = await realpath(worktreePath);
  const id = basename(path);
  if (!/^[a-f0-9-]{36}$/i.test(id) || dirname(path) !== root || resolve(worktreePath) !== path)
    throw new Error('Only an application-owned managed workspace can be removed.');
  const marker = join(root, `${id}.json`);
  const owner = metadataSchema.parse(JSON.parse(await readFile(marker, 'utf8')));
  if (
    owner.path !== path ||
    owner.sourcePath !== sourcePath ||
    owner.branch !== `codex/multiclient-${id}`
  )
    throw new Error('Managed workspace ownership does not match this repository.');
  const branch = await run(path, ['symbolic-ref', '--short', 'HEAD']);
  if (branch !== owner.branch)
    throw new Error('The workspace branch changed. Archive it to preserve its contents.');
  if (await run(path, ['status', '--porcelain=v1', '--untracked-files=all', '--ignored=matching']))
    throw new Error(
      'The workspace contains changed or untracked files. Archive it to preserve its contents.',
    );
  let upstream: string;
  try {
    const ref = await run(path, ['rev-parse', '--symbolic-full-name', '@{upstream}']);
    if (!ref.startsWith('refs/remotes/')) throw new Error('A remote upstream is required.');
    upstream = await run(path, ['rev-parse', '--verify', '@{upstream}']);
  } catch {
    throw new Error('The workspace has no upstream. Archive it to preserve its local commits.');
  }
  if ((await run(path, ['rev-list', '--count', `${upstream}..HEAD`])) !== '0')
    throw new Error(
      'The workspace contains unpushed commits. Archive it to preserve its contents.',
    );
  // Git refuses dirty worktrees; never use force or recursively delete a checkout.
  await run(sourcePath, ['worktree', 'remove', path]);
  await unlink(marker);
}
