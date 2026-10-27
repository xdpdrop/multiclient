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
  ts.SyntaxKind.UndefinedKeyword,
  ts.SyntaxKind.PrivateIdentifier,
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

function isKeyword(kind) {
  return kind >= ts.SyntaxKind.FirstKeyword && kind <= ts.SyntaxKind.LastKeyword;
}

function typeBracketOpen(kind) {
  return (
    kind === ts.SyntaxKind.LessThanToken ||
    kind === ts.SyntaxKind.OpenParenToken ||
    kind === ts.SyntaxKind.OpenBracketToken ||
    kind === ts.SyntaxKind.OpenBraceToken
  );
}

function typeBracketClose(kind) {
  return (
    kind === ts.SyntaxKind.GreaterThanToken ||
    kind === ts.SyntaxKind.CloseParenToken ||
    kind === ts.SyntaxKind.CloseBracketToken ||
    kind === ts.SyntaxKind.CloseBraceToken
  );
}

const CAST_TYPE_KEYWORD = new Set([
  ts.SyntaxKind.AbstractKeyword,
  ts.SyntaxKind.AnyKeyword,
  ts.SyntaxKind.BigIntKeyword,
  ts.SyntaxKind.BooleanKeyword,
  ts.SyntaxKind.ConstKeyword,
  ts.SyntaxKind.ExtendsKeyword,
  ts.SyntaxKind.FalseKeyword,
  ts.SyntaxKind.ImportKeyword,
  ts.SyntaxKind.InferKeyword,
  ts.SyntaxKind.IntrinsicKeyword,
  ts.SyntaxKind.KeyOfKeyword,
  ts.SyntaxKind.NeverKeyword,
  ts.SyntaxKind.NewKeyword,
  ts.SyntaxKind.NullKeyword,
  ts.SyntaxKind.NumberKeyword,
  ts.SyntaxKind.ObjectKeyword,
  ts.SyntaxKind.ReadonlyKeyword,
  ts.SyntaxKind.StringKeyword,
  ts.SyntaxKind.SymbolKeyword,
  ts.SyntaxKind.ThisKeyword,
  ts.SyntaxKind.TrueKeyword,
  ts.SyntaxKind.TypeOfKeyword,
  ts.SyntaxKind.UndefinedKeyword,
  ts.SyntaxKind.UniqueKeyword,
  ts.SyntaxKind.UnknownKeyword,
  ts.SyntaxKind.VoidKeyword,
]);

function continuesCastType(kind) {
  return (
    kind === ts.SyntaxKind.Identifier ||
    kind === ts.SyntaxKind.StringLiteral ||
    kind === ts.SyntaxKind.NumericLiteral ||
    kind === ts.SyntaxKind.BigIntLiteral ||
    kind === ts.SyntaxKind.NoSubstitutionTemplateLiteral ||
    kind === ts.SyntaxKind.DotToken ||
    kind === ts.SyntaxKind.BarToken ||
    kind === ts.SyntaxKind.AmpersandToken ||
    kind === ts.SyntaxKind.EqualsGreaterThanToken ||
    CAST_TYPE_KEYWORD.has(kind)
  );
}

// `as T` / `satisfies T` and postfix `!` end an expression, so the next slash is division.
function slashIsRegex(
  prevNonTrivia,
  lastNonTrivia,
  inCastType,
  typeNest,
  exclaimPostfix,
  closeBraceRegex,
  moduleSpecifier,
) {
  if (inCastType && typeNest === 0) return false;
  if (lastNonTrivia === ts.SyntaxKind.ExclamationToken && exclaimPostfix) return false;
  // A module specifier, import attribute, or statement `}` ends the statement, so `/` is a regex.
  // Function and class expressions stay division, so `function(){}/2` does not hide a later call.
  if (lastNonTrivia === ts.SyntaxKind.CloseBraceToken) return closeBraceRegex;
  if (lastNonTrivia === ts.SyntaxKind.StringLiteral && moduleSpecifier) return true;
  if (NO_REGEX_AFTER.has(lastNonTrivia)) return false;
  if (
    isKeyword(lastNonTrivia) &&
    (prevNonTrivia === ts.SyntaxKind.AsKeyword || prevNonTrivia === ts.SyntaxKind.SatisfiesKeyword)
  )
    return false;
  return true;
}

function opensStatement(st, prev) {
  return (
    prev === ts.SyntaxKind.Unknown ||
    prev === ts.SyntaxKind.SemicolonToken ||
    prev === ts.SyntaxKind.ElseKeyword ||
    prev === ts.SyntaxKind.DoKeyword ||
    prev === ts.SyntaxKind.TryKeyword ||
    prev === ts.SyntaxKind.FinallyKeyword ||
    prev === ts.SyntaxKind.CatchKeyword ||
    prev === ts.SyntaxKind.EqualsGreaterThanToken ||
    prev === ts.SyntaxKind.CloseParenToken ||
    prev === ts.SyntaxKind.ImportKeyword ||
    prev === ts.SyntaxKind.ExportKeyword ||
    (prev === ts.SyntaxKind.OpenBraceToken && st.frames[st.frames.length - 1] === true) ||
    (prev === ts.SyntaxKind.CloseBraceToken && st.closeBraceRegex)
  );
}

function typeNameEnd(prev) {
  return (
    prev === ts.SyntaxKind.AnyKeyword ||
    prev === ts.SyntaxKind.BigIntKeyword ||
    prev === ts.SyntaxKind.BooleanKeyword ||
    prev === ts.SyntaxKind.FalseKeyword ||
    prev === ts.SyntaxKind.NeverKeyword ||
    prev === ts.SyntaxKind.NullKeyword ||
    prev === ts.SyntaxKind.NumberKeyword ||
    prev === ts.SyntaxKind.ObjectKeyword ||
    prev === ts.SyntaxKind.StringKeyword ||
    prev === ts.SyntaxKind.SymbolKeyword ||
    prev === ts.SyntaxKind.ThisKeyword ||
    prev === ts.SyntaxKind.TrueKeyword ||
    prev === ts.SyntaxKind.UndefinedKeyword ||
    prev === ts.SyntaxKind.UnknownKeyword ||
    prev === ts.SyntaxKind.VoidKeyword
  );
}

function bodyPrev(prev) {
  return (
    prev === ts.SyntaxKind.Identifier ||
    prev === ts.SyntaxKind.ClassKeyword ||
    prev === ts.SyntaxKind.CloseParenToken ||
    prev === ts.SyntaxKind.CloseBraceToken ||
    prev === ts.SyntaxKind.CloseBracketToken ||
    prev === ts.SyntaxKind.GreaterThanToken ||
    prev === ts.SyntaxKind.GreaterThanGreaterThanToken ||
    prev === ts.SyntaxKind.GreaterThanGreaterThanGreaterThanToken ||
    typeNameEnd(prev)
  );
}

function isBeforeExpr(kind) {
  return (
    (kind >= ts.SyntaxKind.LessThanToken &&
      kind <= ts.SyntaxKind.CaretEqualsToken &&
      kind !== ts.SyntaxKind.PlusPlusToken &&
      kind !== ts.SyntaxKind.MinusMinusToken &&
      kind !== ts.SyntaxKind.LessThanSlashToken) ||
    kind === ts.SyntaxKind.OpenParenToken ||
    kind === ts.SyntaxKind.OpenBracketToken ||
    kind === ts.SyntaxKind.CommaToken ||
    kind === ts.SyntaxKind.DotDotDotToken ||
    kind === ts.SyntaxKind.CaseKeyword ||
    kind === ts.SyntaxKind.ReturnKeyword ||
    kind === ts.SyntaxKind.ThrowKeyword ||
    kind === ts.SyntaxKind.NewKeyword ||
    kind === ts.SyntaxKind.ExtendsKeyword ||
    kind === ts.SyntaxKind.InKeyword ||
    kind === ts.SyntaxKind.InstanceOfKeyword ||
    kind === ts.SyntaxKind.TypeOfKeyword ||
    kind === ts.SyntaxKind.VoidKeyword ||
    kind === ts.SyntaxKind.DeleteKeyword ||
    kind === ts.SyntaxKind.YieldKeyword ||
    kind === ts.SyntaxKind.AwaitKeyword
  );
}

function exprFrame(st) {
  return st.frames.length > 0 && st.frames[st.frames.length - 1] === false;
}

// Ternary `:`, for-of `of`, and a decorator are expression context. A named function
// or class there stays division, so `}` does not hide the next call inside a regex.
function exprIntroducer(st, prev, beforePrev) {
  if (prev === ts.SyntaxKind.ColonToken) return st.lastColonTernary || exprFrame(st);
  if (prev === ts.SyntaxKind.OpenBraceToken) return exprFrame(st);
  if (
    prev === ts.SyntaxKind.Unknown ||
    prev === ts.SyntaxKind.SemicolonToken ||
    prev === ts.SyntaxKind.ElseKeyword ||
    prev === ts.SyntaxKind.DoKeyword ||
    prev === ts.SyntaxKind.DefaultKeyword ||
    prev === ts.SyntaxKind.ExportKeyword
  )
    return false;
  if (prev === ts.SyntaxKind.OfKeyword) return true;
  if (prev === ts.SyntaxKind.Identifier)
    return st.prevWord === 'of' || beforePrev === ts.SyntaxKind.AtToken;
  return isBeforeExpr(prev);
}

function noteSyntax(st, kind, prev, beforePrev, word, lineBreak) {
  try {
    if (
      kind === ts.SyntaxKind.StringLiteral &&
      (prev === ts.SyntaxKind.FromKeyword || prev === ts.SyntaxKind.ImportKeyword)
    )
      st.expectAttr = true;
    else if (st.expectAttr === true && (word === 'with' || word === 'assert'))
      st.expectAttr = 'brace';
    else if (kind !== ts.SyntaxKind.OpenBraceToken) st.expectAttr = false;
    if (kind === ts.SyntaxKind.QuestionToken) st.questions.push(st.frames.length);
    if (kind === ts.SyntaxKind.FunctionKeyword || kind === ts.SyntaxKind.ClassKeyword) {
      const intro = prev === ts.SyntaxKind.AsyncKeyword ? beforePrev : prev;
      const introBefore = prev === ts.SyntaxKind.AsyncKeyword ? undefined : beforePrev;
      const introBreak = prev === ts.SyntaxKind.AsyncKeyword ? st.breakBefore : lineBreak;
      st.bodies.push({
        expr:
          exprIntroducer(st, intro, introBefore) &&
          !(intro === ts.SyntaxKind.ReturnKeyword && introBreak),
        named: false,
        closed: false,
        isDefault: intro === ts.SyntaxKind.DefaultKeyword,
      });
    }
    const top = st.bodies[st.bodies.length - 1];
    if (
      top &&
      !top.closed &&
      kind !== ts.SyntaxKind.FunctionKeyword &&
      kind !== ts.SyntaxKind.ClassKeyword
    ) {
      if (kind === ts.SyntaxKind.Identifier) top.named = true;
      else if (
        kind === ts.SyntaxKind.OpenParenToken ||
        kind === ts.SyntaxKind.LessThanToken ||
        kind === ts.SyntaxKind.ExtendsKeyword
      )
        top.closed = true;
    }
    if (kind === ts.SyntaxKind.SemicolonToken) {
      st.bodies.length = 0;
      while (st.questions.length && st.questions[st.questions.length - 1] >= st.frames.length)
        st.questions.pop();
    }
    if (kind === ts.SyntaxKind.OpenBraceToken) {
      const attr = st.expectAttr === 'brace';
      st.expectAttr = false;
      let stmt = opensStatement(st, prev);
      const pending = st.bodies[st.bodies.length - 1];
      if (pending && bodyPrev(prev)) {
        st.bodies.pop();
        const expr = pending.expr || (!pending.named && !pending.isDefault);
        stmt = !expr;
      }
      if (attr) stmt = true;
      st.frames.push(stmt);
    } else if (kind === ts.SyntaxKind.CloseBraceToken) {
      st.closeBraceRegex = st.frames.length ? st.frames.pop() : true;
      while (st.questions.length && st.questions[st.questions.length - 1] > st.frames.length)
        st.questions.pop();
    }
    if (kind === ts.SyntaxKind.ColonToken) {
      const depth = st.questions.length ? st.questions[st.questions.length - 1] : -1;
      st.lastColonTernary = depth === st.frames.length;
      if (st.lastColonTernary) st.questions.pop();
    } else if (kind !== ts.SyntaxKind.AsyncKeyword) st.lastColonTernary = false;
  } finally {
    st.prevWord = word;
    st.breakBefore = lineBreak;
  }
}

function lex(text) {
  const scanner = ts.createScanner(ts.ScriptTarget.Latest, false, ts.LanguageVariant.TSX, text);
  const tokens = [];
  const templateStack = [];
  let prevNonTrivia = ts.SyntaxKind.Unknown;
  let lastNonTrivia = ts.SyntaxKind.Unknown;
  let inCastType = false;
  let typeNest = 0;
  let exclaimPostfix = false;
  let lastNonTriviaEnd = 0;
  const brace = {
    frames: [],
    bodies: [],
    closeBraceRegex: false,
    moduleSpecifier: false,
    expectAttr: false,
    prevWord: '',
    breakBefore: false,
    questions: [],
    lastColonTernary: false,
  };
  while (true) {
    let kind = scanner.scan();
    if (kind === ts.SyntaxKind.EndOfFileToken) break;
    if (!isTrivia(kind)) {
      let templateClose = false;
      if (
        (kind === ts.SyntaxKind.SlashToken || kind === ts.SyntaxKind.SlashEqualsToken) &&
        slashIsRegex(
          prevNonTrivia,
          lastNonTrivia,
          inCastType,
          typeNest,
          exclaimPostfix,
          brace.closeBraceRegex,
          brace.moduleSpecifier,
        )
      ) {
        if (scanner.reScanSlashToken() === ts.SyntaxKind.RegularExpressionLiteral)
          kind = ts.SyntaxKind.RegularExpressionLiteral;
      } else if (kind === ts.SyntaxKind.CloseBraceToken && templateStack.length) {
        const last = templateStack[templateStack.length - 1];
        if (last === ts.SyntaxKind.TemplateHead) {
          templateClose = true;
          kind = scanner.reScanTemplateToken(false);
          if (kind === ts.SyntaxKind.TemplateTail) templateStack.pop();
        } else templateStack.pop();
      }
      if (kind === ts.SyntaxKind.TemplateHead) templateStack.push(kind);
      else if (kind === ts.SyntaxKind.OpenBraceToken && templateStack.length)
        templateStack.push(kind);
      if (kind === ts.SyntaxKind.AsKeyword || kind === ts.SyntaxKind.SatisfiesKeyword) {
        inCastType = true;
        typeNest = 0;
      } else if (inCastType) {
        // Nested closers stay in the type; a nest-0 `)` or `>` cannot.
        if (typeNest > 0 && typeBracketClose(kind)) typeNest--;
        else if (typeBracketOpen(kind)) typeNest++;
        else if (typeNest === 0 && !continuesCastType(kind)) inCastType = false;
      }
      if (
        (kind === ts.SyntaxKind.SlashToken || kind === ts.SyntaxKind.SlashEqualsToken) &&
        !slashIsRegex(
          prevNonTrivia,
          lastNonTrivia,
          inCastType,
          typeNest,
          exclaimPostfix,
          brace.closeBraceRegex,
          brace.moduleSpecifier,
        )
      )
        inCastType = false;
      if (!templateClose) {
        const start = scanner.getTokenStart();
        noteSyntax(
          brace,
          kind,
          lastNonTrivia,
          prevNonTrivia,
          text.slice(start, scanner.getTokenEnd()),
          text.slice(lastNonTriviaEnd, start).includes('\n'),
        );
      }
      brace.moduleSpecifier =
        kind === ts.SyntaxKind.StringLiteral &&
        (lastNonTrivia === ts.SyntaxKind.FromKeyword ||
          lastNonTrivia === ts.SyntaxKind.ImportKeyword);
      if (kind === ts.SyntaxKind.ExclamationToken) {
        // A line break ends the postfix chain, so this `!` is prefix.
        const lineBreak = text.slice(lastNonTriviaEnd, scanner.getTokenStart()).includes('\n');
        if (lineBreak) exclaimPostfix = false;
        else if (lastNonTrivia !== ts.SyntaxKind.ExclamationToken)
          exclaimPostfix = NO_REGEX_AFTER.has(lastNonTrivia);
      } else exclaimPostfix = false;
      prevNonTrivia = lastNonTrivia;
      lastNonTrivia = kind;
      lastNonTriviaEnd = scanner.getTokenEnd();
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
