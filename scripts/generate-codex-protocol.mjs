import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve, relative } from 'node:path';
const source = resolve('.cache/codex-protocol');
const target = resolve('src/runtime/providers/codex/protocol');
execFileSync(
  process.platform === 'win32' ? 'codex.exe' : 'codex',
  ['app-server', 'generate-ts', '--out', source],
  { stdio: 'inherit' },
);
const visited = new Set();
function copy(file) {
  if (visited.has(file)) return;
  visited.add(file);
  const full = resolve(source, file);
  if (relative(source, full).startsWith('..')) throw new Error('Unexpected schema import');
  const text = readFileSync(full, 'utf8');
  const output = join(target, file);
  mkdirSync(dirname(output), { recursive: true });
  writeFileSync(output, text);
  for (const match of text.matchAll(/from "(\.[^"]+)"/g))
    copy(relative(source, resolve(dirname(full), match[1] + '.ts')));
}
for (const type of [
  'ThreadStartParams',
  'TurnStartParams',
  'ReviewStartParams',
  'CommandExecutionApprovalDecision',
  'FileChangeApprovalDecision',
])
  copy(`v2/${type}.ts`);
console.log(`Copied ${visited.size} official Codex protocol type files.`);
