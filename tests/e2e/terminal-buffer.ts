/**
 * Replay the pty stream the way a terminal does.
 * `\n` commits a line. A bare `\r` returns the cursor to column 0 and the
 * following characters overwrite; text that is not overwritten stays.
 */
export function normalizeTerminalBuffer(raw: string) {
  const text = raw
    .replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '')
    .replace(/\x1b\][^\x07]*(?:\x07|\x1b\\)/g, '');
  let line = '';
  let column = 0;
  const lines: string[] = [];
  const write = (char: string) => {
    line = line.slice(0, column) + char + line.slice(column + 1);
    column += 1;
  };
  for (let index = 0; index < text.length; index++) {
    const char = text[index];
    if (char === '\r' && text[index + 1] === '\n') continue;
    if (char === '\r') column = 0;
    else if (char === '\n') {
      lines.push(line);
      line = '';
      column = 0;
    } else if (char === '\b') column = Math.max(0, column - 1);
    else write(char);
  }
  lines.push(line);
  return lines.join('\n');
}

export function terminalHasLine(raw: string, marker: string) {
  return normalizeTerminalBuffer(raw)
    .split('\n')
    .some((line) => line.trim() === marker);
}

/** PowerShell prints either the 8.3 cwd or its canonical long path. */
export function windowsShellPromptSeen(raw: string, paths: readonly string[]) {
  const text = normalizeTerminalBuffer(raw).toLowerCase();
  return paths.some((cwd) => cwd.length > 0 && text.includes(`ps ${cwd.toLowerCase()}>`));
}

/** The shell has echoed `command` on a finished line, not only the open prompt. */
export function shellCommandCommitted(raw: string, command: string) {
  const expected = command.replace(/\s+/g, '');
  if (!expected) return false;
  return normalizeTerminalBuffer(raw)
    .split('\n')
    .slice(0, -1)
    .some((line) => line.replace(/\s+/g, '').includes(expected));
}
