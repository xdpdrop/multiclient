import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { Terminals } from '../../src/runtime/terminals';
import { normalizeTerminalBuffer, terminalHasLine } from '../e2e/terminal-buffer';
import { waitFor } from '../wait-for';

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

function script() {
  if (process.platform === 'win32') {
    return (
      [
        "$env:X='TOK'",
        "echo ($env:X+'EN_SAVED')",
        "echo ('CWD_'+(Get-Location).Path)",
        "echo ('DIR_'+(Get-Content -LiteralPath .\\marker.txt -Raw).Trim())",
        'exit',
      ].join('\r\n') + '\r\n'
    );
  }
  return (
    [
      'PS1=',
      'PROMPT=',
      'X=TOK',
      'echo "$X"EN_SAVED',
      'echo "CWD_$(pwd)"',
      'echo "DIR_$(cat ./marker.txt)"',
      'exit',
    ].join('\n') + '\n'
  );
}

function markedLine(raw: string, prefix: string) {
  const line = normalizeTerminalBuffer(raw)
    .split('\n')
    .map((entry) => entry.trim())
    .find((entry) => entry.startsWith(prefix));
  if (!line) throw new Error(`missing ${prefix} in\n${normalizeTerminalBuffer(raw)}`);
  return line.slice(prefix.length).replace(/^Microsoft\.PowerShell\.Core\\FileSystem::/i, '');
}

async function samePath(left: string, right: string) {
  const [a, b] = await Promise.all([realpath(left), realpath(right)]);
  return process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b;
}

async function runScript(cwd: string) {
  let output = '';
  let resolveExit: (code: number) => void = () => {};
  const exited = new Promise<number>((resolve) => {
    resolveExit = resolve;
  });
  let closed = false;
  let resolveClosed: () => void = () => {};
  new Promise<void>((resolve) => {
    resolveClosed = () => {
      closed = true;
      resolve();
    };
  });
  const terminals = new Terminals((event) => {
    if (event.type === 'terminal') output += event.data;
    if (event.type === 'terminal-exit') {
      resolveExit(event.code);
      resolveClosed();
    }
  });
  const timer = setTimeout(() => resolveExit(-1), 15000);
  try {
    const text = script();
    const id = terminals.open(cwd, 'session', 'script', text);
    if (process.platform !== 'win32') terminals.write(id, text);
    const code = await exited;
    if (code !== 0) throw new Error(`exit ${code}\n${normalizeTerminalBuffer(output)}`);
    return output;
  } finally {
    clearTimeout(timer);
    terminals.closeAll();
    await waitFor(() => closed, 5000).catch(() => {});
  }
}

// Temporary: Windows ConPTY hangs on powershell.exe -EncodedCommand with no output
// and no exit. https://github.com/xdpdrop/multiclient/issues/18
it.skipIf(process.platform === 'win32')(
  'reads cwd and a computed marker through the app terminal spawn',
  async () => {
    expect(script()).not.toContain('TOKEN_SAVED');
    expect(script()).not.toContain('DIR_Committed marker');
    expect(script()).not.toContain('DIR_Dirty primary marker');
    const root = await mkdtemp(join(tmpdir(), 'multiclient-terminal-'));
    roots.push(root);
    const primary = join(root, 'primary');
    const worktree = join(root, 'worktree');
    await mkdir(primary);
    await mkdir(worktree);
    await writeFile(join(primary, 'marker.txt'), 'Dirty primary marker');
    await writeFile(join(worktree, 'marker.txt'), 'Committed marker');

    const primaryOutput = await runScript(primary);
    const worktreeOutput = await runScript(worktree);

    expect(terminalHasLine(primaryOutput, 'TOKEN_SAVED')).toBe(true);
    expect(terminalHasLine(worktreeOutput, 'TOKEN_SAVED')).toBe(true);
    expect(await samePath(markedLine(primaryOutput, 'CWD_'), primary)).toBe(true);
    expect(await samePath(markedLine(worktreeOutput, 'CWD_'), worktree)).toBe(true);
    expect(terminalHasLine(primaryOutput, 'DIR_Dirty primary marker')).toBe(true);
    expect(terminalHasLine(worktreeOutput, 'DIR_Committed marker')).toBe(true);
    expect(terminalHasLine(primaryOutput, 'DIR_Committed marker')).toBe(false);
    expect(terminalHasLine(worktreeOutput, 'DIR_Dirty primary marker')).toBe(false);
  },
  30000,
);
