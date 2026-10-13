import { exec, childEnvironment, findExecutable } from '../providers/process';
import type { GitState, GitDiffPreview, GitFileChange } from '../../shared/types';
import { readText } from '../files';
import { lstat } from 'node:fs/promises';
import { join } from 'node:path';
export function parseStatus(text: string): { path: string; status: string }[] {
  const fields = text.split('\0');
  const entries: { path: string; status: string }[] = [];
  for (let i = 0; i < fields.length; i++) {
    const value = fields[i];
    if (!value) continue;
    const status = value.slice(0, 2);
    entries.push({ status, path: value.slice(3) });
    if (status.includes('R') || status.includes('C')) i++;
  }
  return entries;
}
export async function gitState(cwd: string): Promise<GitState & { files: GitFileChange[] }> {
  const executable = await findExecutable('git', '', cwd).catch(() => null);
  async function run(args: string[], maxBuffer = 2 * 1024 * 1024) {
    if (!executable) throw new Error('Git is not installed.');
    const result = await exec(
      executable,
      ['--no-optional-locks', '--no-pager', '-c', 'core.fsmonitor=false', ...args],
      {
        cwd,
        env: { ...childEnvironment(), GIT_TERMINAL_PROMPT: '0' },
        windowsHide: true,
        timeout: 10000,
        maxBuffer,
      },
    );
    return result.stdout;
  }
  try {
    const [branch, status] = await Promise.all([
      run(['branch', '--show-current']),
      run(['status', '--porcelain=v1', '-z', '--untracked-files=all']),
    ]);
    const entries = parseStatus(status);
    const renameSources = new Map<string, string>();
    const fields = status.split('\0');
    for (let index = 0; index < fields.length; index++) {
      if (/[RC]/.test(fields[index].slice(0, 2)))
        renameSources.set(fields[index].slice(3), fields[++index]);
    }
    const files: GitFileChange[] = [];
    async function preview(path: string, staged: boolean): Promise<GitDiffPreview> {
      try {
        const text = await run(
          [
            'diff',
            ...(staged ? ['--cached'] : []),
            '--find-renames',
            '--no-ext-diff',
            '--no-textconv',
            '--',
            path,
            ...(renameSources.has(path) ? [renameSources.get(path)!] : []),
          ],
          100000,
        );
        return /^(Binary files .* differ|GIT binary patch)$/m.test(text)
          ? { text: '', kind: 'binary', detail: 'Binary file changed. Text diff unavailable.' }
          : { text, kind: 'text' };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return /maxBuffer|buffer limit/i.test(message)
          ? {
              text: '',
              kind: 'oversize',
              detail: 'This file’s diff exceeds the 100 KB preview limit.',
            }
          : { text: '', kind: 'unavailable', detail: 'This file’s diff could not be read.' };
      }
    }
    for (let offset = 0; offset < entries.length; offset += 4) {
      const changes = await Promise.all(
        entries.slice(offset, offset + 4).map(async (entry, index) => {
          const file: GitFileChange = { ...entry };
          if (offset + index >= 100) {
            const unavailable: GitDiffPreview = {
              text: '',
              kind: 'unavailable',
              detail: 'Preview is limited to the first 100 changed files.',
            };
            if (entry.status === '??') file.untracked = unavailable;
            else {
              if (entry.status[0] !== ' ') file.staged = unavailable;
              if (entry.status[1] !== ' ') file.unstaged = unavailable;
            }
          } else if (entry.status === '??') {
            try {
              if ((await lstat(join(cwd, entry.path))).isSymbolicLink())
                throw new Error('Symbolic links cannot be previewed as text.');
              const content = await readText(cwd, entry.path);
              const lines = content ? content.replace(/\n$/, '').split('\n') : [];
              file.untracked = {
                kind: 'text',
                text: `New file: ${entry.path}\n${lines.length ? `@@ -0,0 +1,${lines.length} @@\n${lines.map((line) => '+' + line).join('\n')}\n${content.endsWith('\n') ? '' : '\\ No newline at end of file\n'}` : 'Empty file\n'}`,
              };
              if (file.untracked.text.length > 100000)
                file.untracked = {
                  text: '',
                  kind: 'oversize',
                  detail: 'This file’s preview exceeds the 100 KB limit.',
                };
            } catch (error) {
              const message = error instanceof Error ? error.message : String(error);
              file.untracked = {
                text: '',
                kind: /Binary/i.test(message)
                  ? 'binary'
                  : /100 KB/i.test(message)
                    ? 'oversize'
                    : 'unavailable',
                detail: message,
              };
            }
          } else {
            if (entry.status[0] !== ' ') file.staged = await preview(entry.path, true);
            if (entry.status[1] !== ' ') file.unstaged = await preview(entry.path, false);
          }
          return file;
        }),
      );
      files.push(...changes);
    }
    const diff = files
      .flatMap((file) =>
        (['staged', 'unstaged', 'untracked'] as const).flatMap((section) => {
          const value = file[section];
          if (!value) return [];
          return value.kind === 'text'
            ? value.text
              ? [`${section.toUpperCase()}\n${value.text}`]
              : []
            : [
                `${section.toUpperCase()}: ${file.path}\n[${value.kind}: ${value.detail ?? 'No text diff available.'}]`,
              ];
        }),
      )
      .join('\n\n');
    return {
      branch: branch.trim() || 'Detached HEAD',
      entries,
      files,
      diff: diff.length <= 2 * 1024 * 1024 ? diff : '',
    };
  } catch {
    return {
      branch: '',
      entries: [],
      files: [],
      diff: '',
      error:
        'Git is unavailable, this folder is not a repository, or its diff exceeds the 2 MB preview limit.',
    };
  }
}
