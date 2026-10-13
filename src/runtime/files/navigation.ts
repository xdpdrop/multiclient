import { join, relative } from 'node:path';
import { realpath, readdir } from 'node:fs/promises';
import { contained, readText } from './index';
import type { FileEntry } from '../../shared/types';

const excluded = (name: string) =>
  [
    '.git',
    'node_modules',
    '.ssh',
    '.aws',
    '.azure',
    'dist',
    'out',
    'coverage',
    '.npmrc',
    '.netrc',
    'auth.json',
    'credentials.json',
  ].includes(name.toLowerCase()) ||
  /^\.env(?:\.|$)/i.test(name) ||
  /\.(pem|key)$/i.test(name);
export async function findProjectFiles(root: string, query: string): Promise<FileEntry[]> {
  const base = await realpath(root);
  const matches: FileEntry[] = [];
  const queue = [base];
  let visited = 0;
  while (queue.length && visited < 5000 && matches.length < 100) {
    const directory = queue.shift()!;
    const actual = await realpath(directory);
    if (!contained(base, actual)) continue;
    for (const e of await readdir(actual, { withFileTypes: true })) {
      if (++visited > 5000) break;
      if (excluded(e.name) || e.isSymbolicLink()) continue;
      const path = join(actual, e.name);
      if (e.isDirectory()) queue.push(path);
      else if (e.isFile() && relative(base, path).toLowerCase().includes(query.toLowerCase()))
        matches.push({ name: e.name, path: relative(base, path), directory: false });
      if (matches.length === 100) break;
    }
  }
  return matches;
}
export async function readInstructions(root: string) {
  const results: { path: string; content: string }[] = [];
  for (const path of ['AGENTS.md', 'CLAUDE.md', '.cursor/rules']) {
    try {
      if (path === '.cursor/rules') {
        const names = await readdir(join(root, path));
        for (const name of names.slice(0, 30))
          if (name.endsWith('.mdc'))
            results.push({
              path: join(path, name),
              content: await readText(root, join(path, name)),
            });
      } else results.push({ path, content: await readText(root, path) });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }
  return results;
}
