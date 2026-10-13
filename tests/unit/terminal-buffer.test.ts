import { expect, it } from 'vitest';
import {
  normalizeTerminalBuffer,
  terminalHasLine,
  windowsShellPromptSeen,
} from '../e2e/terminal-buffer';

const shortPath = 'C:\\Users\\RUNNER~1\\AppData\\Local\\Temp\\first project';
const longPath = 'C:\\Users\\runneradmin\\AppData\\Local\\Temp\\first project';

it('collapses ConPTY carriage-return redraws onto the output line', () => {
  const raw =
    "Write-Output ('WORKTREE_MARKER_' + (Get-Co\r" +
    "Write-Output ('WORKTREE_MARKER_' + (Get-Content -LiteralPath './marker.txt'))\r\n" +
    'WORKTREE_MARKER_Committed marker\r\n';
  expect(normalizeTerminalBuffer(raw)).not.toContain('Get-CoWrite');
  expect(terminalHasLine(raw, 'WORKTREE_MARKER_Committed marker')).toBe(true);
});

it('matches a PowerShell prompt on either the 8.3 path or the long path', () => {
  const paths = [shortPath, longPath];
  expect(windowsShellPromptSeen(`PS ${longPath}> `, paths)).toBe(true);
  expect(windowsShellPromptSeen(`ps ${shortPath}>`, paths)).toBe(true);
  expect(windowsShellPromptSeen('PS C:\\somewhere\\else>', paths)).toBe(false);
});
