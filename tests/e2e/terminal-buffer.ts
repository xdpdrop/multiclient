/** Collapse ConPTY redraws into the screen the user would read. */
export function normalizeTerminalBuffer(raw: string) {
  const text = raw
    .replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '')
    .replace(/\x1b\][^\x07]*(?:\x07|\x1b\\)/g, '');
  let line = '';
  const lines: string[] = [];
  for (let index = 0; index < text.length; index++) {
    const char = text[index];
    if (char === '\r' && text[index + 1] === '\n') continue;
    if (char === '\r') line = '';
    else if (char === '\n') {
      lines.push(line);
      line = '';
    } else if (char === '\b') line = line.slice(0, -1);
    else line += char;
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

/**
 * The unsubmitted paste sits at the end of the buffer. ConPTY wraps that
 * prompt line with newlines; drop all whitespace before comparing.
 */
export function commandOnCurrentPrompt(raw: string, command: string) {
  const expected = command.replace(/\s+/g, '');
  if (!expected) return false;
  return normalizeTerminalBuffer(raw).replace(/\s+/g, '').endsWith(expected);
}
