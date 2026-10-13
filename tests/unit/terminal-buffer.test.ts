import { expect, it } from 'vitest';
import {
  normalizeTerminalBuffer,
  shellCommandCommitted,
  terminalHasLine,
  windowsShellPromptSeen,
} from '../e2e/terminal-buffer';

const shortPath = 'C:\\Users\\RUNNER~1\\AppData\\Local\\Temp\\first project';
const longPath = 'C:\\Users\\runneradmin\\AppData\\Local\\Temp\\first project';

it('keeps a zsh prompt redraw that uses a bare carriage return', () => {
  const prompt = 'iad20-host%';
  const command = 'echo "$X"EN_SAVED';
  const redraw = `${prompt} ${command}\r${prompt} `;
  expect(normalizeTerminalBuffer(redraw)).toBe(`${prompt} ${command}`);
  expect(normalizeTerminalBuffer(`${prompt} ech\r${prompt} ${command}`)).toBe(
    `${prompt} ${command}`,
  );
  const finished = `${redraw}\nTOKEN_SAVED\n${prompt} `;
  expect(terminalHasLine(finished, 'TOKEN_SAVED')).toBe(true);
  expect(terminalHasLine(finished, command)).toBe(false);
});

it('overwrites ConPTY fragments and keeps wrapped output on one committed line', () => {
  const raw =
    'WT_Com\rWT_Committed marker\r\n' + 'echo "WT_$x"\r' + 'PS C:\\Temp\\work> echo "WT_$x"\r\n';
  expect(normalizeTerminalBuffer(raw)).not.toContain('WT_ComW');
  expect(terminalHasLine(raw, 'WT_Committed marker')).toBe(true);
  expect(shellCommandCommitted(raw, 'echo "WT_$x"')).toBe(true);
});

it('collapses PowerShell per-key echo fragments without joining them', () => {
  const raw =
    "e\rec\recho ($env:X+'EN_SAVED')\r\n" +
    'TOKEN_SAVED\r\n' +
    'PS C:\\Users\\runneradmin\\AppData\\Local\\Temp\\first project> ';
  expect(normalizeTerminalBuffer(raw)).not.toContain('eecho');
  expect(terminalHasLine(raw, 'TOKEN_SAVED')).toBe(true);
  expect(shellCommandCommitted(raw, "echo ($env:X+'EN_SAVED')")).toBe(true);
});

it('matches a PowerShell prompt on either the 8.3 path or the long path', () => {
  const paths = [shortPath, longPath];
  expect(windowsShellPromptSeen(`PS ${longPath}> `, paths)).toBe(true);
  expect(windowsShellPromptSeen(`ps ${shortPath}>`, paths)).toBe(true);
  expect(windowsShellPromptSeen('PS C:\\somewhere\\else>', paths)).toBe(false);
});
