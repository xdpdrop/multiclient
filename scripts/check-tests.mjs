import { readdirSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { extname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

// A slash starts a regex only when the previous token cannot end an expression.
const NO_REGEX_AFTER = new Set([
  ts.SyntaxKind.Identifier,
  ts.SyntaxKind.StringLiteral,
  ts.SyntaxKind.NumericLiteral,
  ts.SyntaxKind.BigIntLiteral,
  ts.SyntaxKind.RegularExpressionLiteral,
  ts.SyntaxKind.NoSubstitutionTemplateLiteral,
  ts.SyntaxKind.TemplateTail,
  ts.SyntaxKind.ThisKeyword,
  ts.SyntaxKind.PlusPlusToken,
  ts.SyntaxKind.MinusMinusToken,
  ts.SyntaxKind.CloseParenToken,
  ts.SyntaxKind.CloseBracketToken,
  ts.SyntaxKind.CloseBraceToken,
  ts.SyntaxKind.TrueKeyword,
  ts.SyntaxKind.FalseKeyword,
  ts.SyntaxKind.NullKeyword,
]);

function isTrivia(kind) {
  return (
    kind === ts.SyntaxKind.SingleLineCommentTrivia ||
    kind === ts.SyntaxKind.MultiLineCommentTrivia ||
    kind === ts.SyntaxKind.NewLineTrivia ||
    kind === ts.SyntaxKind.WhitespaceTrivia ||
    kind === ts.SyntaxKind.ShebangTrivia
  );
}

function lex(text) {
  const scanner = ts.createScanner(ts.ScriptTarget.Latest, false, ts.LanguageVariant.TSX, text);
  const tokens = [];
  const templateStack = [];
  let lastNonTrivia = ts.SyntaxKind.Unknown;
  while (true) {
    let kind = scanner.scan();
    if (kind === ts.SyntaxKind.EndOfFileToken) break;
    if (!isTrivia(kind)) {
      if (
        (kind === ts.SyntaxKind.SlashToken || kind === ts.SyntaxKind.SlashEqualsToken) &&
        !NO_REGEX_AFTER.has(lastNonTrivia)
      ) {
        if (scanner.reScanSlashToken() === ts.SyntaxKind.RegularExpressionLiteral)
          kind = ts.SyntaxKind.RegularExpressionLiteral;
      } else if (kind === ts.SyntaxKind.CloseBraceToken && templateStack.length) {
        const last = templateStack[templateStack.length - 1];
        if (last === ts.SyntaxKind.TemplateHead) {
          kind = scanner.reScanTemplateToken(false);
          if (kind === ts.SyntaxKind.TemplateTail) templateStack.pop();
        } else templateStack.pop();
      }
      if (kind === ts.SyntaxKind.TemplateHead) templateStack.push(kind);
      else if (kind === ts.SyntaxKind.OpenBraceToken && templateStack.length)
        templateStack.push(kind);
      lastNonTrivia = kind;
    }
    tokens.push({ kind, pos: scanner.getTokenStart(), end: scanner.getTokenEnd() });
  }
  return tokens;
}

function blankComments(text, tokens) {
  const chars = text.split('');
  for (const token of tokens) {
    if (
      token.kind !== ts.SyntaxKind.SingleLineCommentTrivia &&
      token.kind !== ts.SyntaxKind.MultiLineCommentTrivia
    )
      continue;
    for (let i = token.pos; i < token.end; i++) if (chars[i] !== '\n') chars[i] = ' ';
  }
  return chars.join('');
}

const EXT = new Set(['.ts', '.tsx', '.js', '.mjs', '.cjs']);
const ISSUE = /#\d+|https?:\/\/github\.com\/[\w.-]+\/[\w.-]+\/issues\/\d+/;
const SKIP = /\b(?:skipIf|runIf)\b|\.skip\b/;
const DELAY_ALLOW = new Set([
  'tests/wait-for.ts',
  'tests/e2e/screenshot.ts',
  'tests/unit/terminal-session.test.ts',
  'tests/unit/diagram-lifecycle.test.ts',
]);

function lineNumber(text, index) {
  let line = 1;
  for (let i = 0; i < index; i++) if (text[i] === '\n') line++;
  return line;
}

function callEnd(tokens, open) {
  let depth = 0;
  for (const token of tokens) {
    if (token.pos < open) continue;
    if (token.kind === ts.SyntaxKind.OpenParenToken) depth++;
    else if (token.kind === ts.SyntaxKind.CloseParenToken) {
      depth--;
      if (depth === 0) return token.pos;
    }
  }
  return -1;
}

function isAsyncArrow(tokens, open, end) {
  const inner = tokens.filter(
    (token) => token.pos > open && token.pos < end && !isTrivia(token.kind),
  );
  if (inner[0]?.kind !== ts.SyntaxKind.AsyncKeyword) return false;
  const second = inner[1]?.kind;
  if (second !== ts.SyntaxKind.OpenParenToken && second !== ts.SyntaxKind.Identifier) return false;
  return inner.some((token) => token.kind === ts.SyntaxKind.EqualsGreaterThanToken);
}

function bareTimeout(inner, tokens, open, end) {
  const body = inner.trim();
  if (/^(?:async\s+)?function\b/.test(body)) return true;
  if (isAsyncArrow(tokens, open, end)) return true;
  if (/^\(\s*\)\s*=>\s*[A-Za-z_$][\w$]*\s*(?:\([^)]*\))?\s*,/.test(body)) return true;
  return /^[A-Za-z_$][\w$]*\s*(?:\([^)]*\))?\s*,/.test(body);
}

function bareSleepLines(text, tokens) {
  const lines = [];
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (token.kind !== ts.SyntaxKind.Identifier) continue;
    const name = text.slice(token.pos, token.end);
    if (name !== 'sleep' && name !== 'setTimeout' && name !== 'waitFor') continue;
    let j = i + 1;
    while (j < tokens.length && isTrivia(tokens[j].kind)) j++;
    if (tokens[j]?.kind !== ts.SyntaxKind.OpenParenToken) continue;
    const open = tokens[j].pos;
    const end = callEnd(tokens, open);
    if (end < 0) continue;
    const inner = text.slice(open + 1, end);
    const hit =
      name === 'sleep' ||
      (name === 'setTimeout' && bareTimeout(inner, tokens, open, end)) ||
      (name === 'waitFor' && /\bDate\.now\s*\(/.test(text.slice(token.pos, end + 1)));
    if (hit) lines.push(lineNumber(text, token.pos));
  }
  return lines;
}

function delayHelperLines(text) {
  const lines = [];
  const re = /\b(?:after|guardTimeout)\s*\(/g;
  for (let match = re.exec(text); match; match = re.exec(text))
    lines.push(lineNumber(text, match.index));
  return lines;
}

export function scanText(text, file) {
  const lines = text.split(/\r?\n/);
  const path = file.replaceAll('\\', '/');
  const tokens = lex(text);
  const stripped = blankComments(text, tokens);
  const out = [];
  if (!path.endsWith('tests/wait-for.ts'))
    for (const line of bareSleepLines(stripped, tokens))
      out.push({ file, line, rule: 'bare-sleep' });
  if (!DELAY_ALLOW.has(path))
    for (const line of delayHelperLines(stripped)) out.push({ file, line, rule: 'bare-sleep' });
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const prev = i ? lines[i - 1] : '';
    if (SKIP.test(line) && !ISSUE.test(line) && !ISSUE.test(prev))
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

if (
  process.argv[1] &&
  realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))
) {
  const root = process.argv[2] ?? 'tests';
  const found = scanTree(root);
  if (!found.length) console.log(`PASS ${root}`);
  else {
    for (const hit of found) console.error(`${hit.rule} ${hit.file}:${hit.line}`);
    process.exit(1);
  }
}
