import { readdirSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { extname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const EXT = new Set(['.ts', '.tsx', '.js', '.mjs', '.cjs']);
const ISSUE = /#\d+|https?:\/\/github\.com\/[\w.-]+\/[\w.-]+\/issues\/\d+/;
const SLEEP =
  /\bsleep\s*\(|setTimeout\s*\(\s*(?:\(\s*\)\s*=>\s*)?[A-Za-z_$][\w$]*\s*(?:\([^)]*\))?\s*,/;
const SKIP = /\b(?:skipIf|runIf)\b|\.skip\b/;

export function scanText(text, file) {
  const lines = text.split(/\r?\n/);
  const helper = file.replaceAll('\\', '/').endsWith('tests/wait-for.ts');
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    if (!helper && SLEEP.test(lines[i])) out.push({ file, line: i + 1, rule: 'bare-sleep' });
    if (SKIP.test(lines[i]) && !ISSUE.test(lines[i]) && !ISSUE.test(i ? lines[i - 1] : ''))
      out.push({ file, line: i + 1, rule: 'skip-without-issue' });
  }
  return out;
}

export function scanTree(root) {
  const out = [];
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      if (name === 'node_modules') continue;
      const path = join(dir, name);
      if (statSync(path).isDirectory()) walk(path);
      else if (EXT.has(extname(name)))
        out.push(
          ...scanText(
            readFileSync(path, 'utf8'),
            relative(process.cwd(), path).split(sep).join('/'),
          ),
        );
    }
  };
  walk(root);
  return out;
}

const self =
  process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
if (self) {
  const root = process.argv[2] ?? 'tests';
  const found = scanTree(root);
  if (!found.length) console.log(`PASS ${root}`);
  else
    found.forEach((hit) => console.error(`${hit.rule} ${hit.file}:${hit.line}`)) || process.exit(1);
}
