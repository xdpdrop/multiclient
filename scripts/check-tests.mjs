import { readdirSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { extname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const SOURCE = new Set(['.ts', '.tsx', '.js', '.mjs', '.cjs']);
const ISSUE_REF = /#\d+|https?:\/\/github\.com\/[\w.-]+\/[\w.-]+\/issues\/\d+/;

function isHelper(file) {
  return file.replaceAll('\\', '/').endsWith('tests/wait-for.ts');
}

function isBareSleep(line) {
  return /\bsleep\s*\(/.test(line) || /setTimeout\s*\(\s*resolve\s*,/.test(line);
}

function isUnmarkedSkip(line, previous) {
  const skip = /\bskipIf\b/.test(line) || /(?:^|[^.\w])(?:it|test|describe)\.skip\b/.test(line);
  if (!skip) return false;
  return !ISSUE_REF.test(line) && !ISSUE_REF.test(previous);
}

export function scanText(text, file) {
  const lines = text.split(/\r?\n/);
  const violations = [];
  const helper = isHelper(file);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const previous = i > 0 ? lines[i - 1] : '';
    if (!helper && isBareSleep(line)) violations.push({ file, line: i + 1, rule: 'bare-sleep' });
    if (isUnmarkedSkip(line, previous))
      violations.push({ file, line: i + 1, rule: 'skip-without-issue' });
  }
  return violations;
}

export function scanTree(root) {
  const violations = [];
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      if (name === 'node_modules') continue;
      const path = join(dir, name);
      if (statSync(path).isDirectory()) {
        walk(path);
        continue;
      }
      if (!SOURCE.has(extname(name))) continue;
      const file = relative(process.cwd(), path).split(sep).join('/');
      violations.push(...scanText(readFileSync(path, 'utf8'), file));
    }
  };
  walk(root);
  return violations;
}

function main() {
  const root = process.argv[2] ?? 'tests';
  const violations = scanTree(root);
  if (violations.length) {
    for (const violation of violations)
      console.error(`${violation.rule} ${violation.file}:${violation.line}`);
    process.exit(1);
  }
  console.log(`PASS ${root}`);
}

function isMain() {
  if (!process.argv[1]) return false;
  try {
    return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (isMain()) main();
