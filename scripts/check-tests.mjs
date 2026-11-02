import { readdirSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { extname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

function languageOf(file) {
  const path = file.replaceAll('\\', '/');
  if (path.endsWith('.tsx') || path.endsWith('.jsx')) {
    return { scriptKind: ts.ScriptKind.TSX, languageVariant: ts.LanguageVariant.JSX };
  }
  return { scriptKind: ts.ScriptKind.TS, languageVariant: ts.LanguageVariant.Standard };
}

// `function(){}/2` and `class{}/x` are recovered as an unterminated regex, which would hide
// a later call. The slash in those statements is division.
function closedRegex(text, start, end) {
  if (text[start] !== '/') return false;
  for (let i = start + 1; i < end; i++) {
    const ch = text[i];
    if (ch === '\\') {
      i++;
      continue;
    }
    if (ch === '\n' || ch === '\r') return false;
    if (ch === '/') {
      for (let j = i + 1; j < end; j++) {
        const code = text.charCodeAt(j);
        if (!((code >= 65 && code <= 90) || (code >= 97 && code <= 122))) return false;
      }
      return true;
    }
  }
  return false;
}

function tokenize(text, file) {
  const { scriptKind, languageVariant } = languageOf(file);
  const sourceFile = ts.createSourceFile(
    scriptKind === ts.ScriptKind.TSX ? 'scan.tsx' : 'scan.ts',
    text,
    ts.ScriptTarget.Latest,
    true,
    scriptKind,
  );
  const scanner = ts.createScanner(
    ts.ScriptTarget.Latest,
    /*skipTrivia*/ false,
    languageVariant,
    text,
  );
  const tokens = [];
  let cursor = 0;

  function emitGap(from, to) {
    if (from >= to) return;
    scanner.resetTokenState(from);
    while (from < to) {
      const kind = scanner.scan();
      if (kind === ts.SyntaxKind.EndOfFileToken) break;
      const start = scanner.getTokenStart();
      const end = scanner.getTokenEnd();
      if (start >= to) break;
      tokens.push({ kind, pos: start, end: Math.min(end, to) });
      if (end >= to) break;
      from = end;
    }
  }

  // A nameless `function(){}` or `class{}` is a declaration only as error recovery.
  // The slash after it is division, so rescan instead of keeping the recovered regex.
  function rescanUnterminated(node, start) {
    if (node.kind !== ts.SyntaxKind.RegularExpressionLiteral) return false;
    if (closedRegex(text, start, node.end)) return false;
    const stmt = node.parent;
    if (stmt?.kind !== ts.SyntaxKind.ExpressionStatement) return false;
    const list = stmt.parent?.statements;
    if (!list) return false;
    const prev = list[list.indexOf(stmt) - 1];
    const named = !!prev?.name?.escapedText;
    return (
      (prev?.kind === ts.SyntaxKind.FunctionDeclaration ||
        prev?.kind === ts.SyntaxKind.ClassDeclaration) &&
      !named
    );
  }

  function emitLeaf(node) {
    const start = node.getStart(sourceFile, false);
    emitGap(cursor, start);
    if (rescanUnterminated(node, start)) emitGap(start, node.end);
    else if (start < node.end) tokens.push({ kind: node.kind, pos: start, end: node.end });
    cursor = node.end;
  }

  // `extends` or `?` on the next line keeps a type alias open. The parser starts a
  // new statement there, which would treat the slashes as division.
  function emitTypeContinuation(node) {
    const start = node.getStart(sourceFile, false);
    const end = node.end;
    emitGap(cursor, start);
    const first = text.indexOf('/', start);
    const last = text.lastIndexOf('/', end - 1);
    if (first >= start && last > first && last < end) {
      emitGap(start, first);
      tokens.push({ kind: ts.SyntaxKind.RegularExpressionLiteral, pos: first, end: last + 1 });
      emitGap(last + 1, end);
    } else emitGap(start, end);
    cursor = end;
  }

  function visit(node) {
    if (node.kind >= ts.SyntaxKind.FirstJSDocNode && node.kind <= ts.SyntaxKind.LastJSDocNode) {
      const start = node.getStart(sourceFile, false);
      emitGap(cursor, start);
      if (start < node.end) {
        tokens.push({ kind: ts.SyntaxKind.MultiLineCommentTrivia, pos: start, end: node.end });
      }
      cursor = node.end;
      return;
    }
    const children = [];
    node.forEachChild((child) => {
      children.push(child);
    });
    if (!children.length) {
      emitLeaf(node);
      return;
    }
    let prev = undefined;
    for (const child of children) {
      if (child.pos > cursor) {
        emitGap(cursor, child.pos);
        cursor = child.pos;
      }
      const between = prev ? text.slice(prev.end, child.getStart(sourceFile, false)) : '';
      const gap = between.trim();
      if (prev?.kind === ts.SyntaxKind.TypeAliasDeclaration && (gap === 'extends' || gap === '?')) {
        emitTypeContinuation(child);
      } else visit(child);
      prev = child;
    }
    if (node.end > cursor) {
      emitGap(cursor, node.end);
      cursor = node.end;
    }
  }

  visit(sourceFile);
  if (cursor < text.length) emitGap(cursor, text.length);
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

function isTrivia(kind) {
  return (
    kind === ts.SyntaxKind.SingleLineCommentTrivia ||
    kind === ts.SyntaxKind.MultiLineCommentTrivia ||
    kind === ts.SyntaxKind.NewLineTrivia ||
    kind === ts.SyntaxKind.WhitespaceTrivia ||
    kind === ts.SyntaxKind.ShebangTrivia
  );
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
  const tokens = tokenize(text, file);
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
