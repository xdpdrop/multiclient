import { realpath, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { childEnvironment, exec, findExecutable } from '../providers/process';

const key = (path: string) => (process.platform === 'win32' ? path.toLowerCase() : path);

export async function checkoutOwnership(path: string): Promise<string> {
  const directory = await realpath(path);
  try {
    const executable = await findExecutable('git', '', directory);
    const { stdout } = await exec(
      executable,
      ['--no-optional-locks', '-c', 'core.fsmonitor=false', 'rev-parse', '--show-toplevel'],
      {
        cwd: directory,
        env: childEnvironment(),
        windowsHide: true,
        timeout: 10000,
        maxBuffer: 16384,
      },
    );
    return key(await realpath(stdout.replace(/\r?\n$/, '')));
  } catch {
    // A Git marker also identifies ordinary checkouts and worktrees without an installed Git CLI.
    let current = directory;
    while (true) {
      try {
        const marker = await stat(join(current, '.git'));
        if (marker.isDirectory() || marker.isFile()) return key(current);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT')
          throw new Error(
            'Could not determine checkout ownership. Check workspace permissions before starting an agent.',
          );
      }
      const parent = dirname(current);
      if (parent === current) return key(directory);
      current = parent;
    }
  }
}
