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
    return st.prevWord === 'of' || (beforePrev === ts.SyntaxKind.AtToken && st.decoratorExpr);
  return isBeforeExpr(prev);
}

function allowsASI(kind) {
  return (
    kind === ts.SyntaxKind.Identifier ||
    kind === ts.SyntaxKind.StringLiteral ||
    kind === ts.SyntaxKind.NumericLiteral ||
    kind === ts.SyntaxKind.BigIntLiteral ||
    kind === ts.SyntaxKind.RegularExpressionLiteral ||
    kind === ts.SyntaxKind.NoSubstitutionTemplateLiteral ||
    kind === ts.SyntaxKind.TemplateTail ||
    kind === ts.SyntaxKind.CloseParenToken ||
    kind === ts.SyntaxKind.CloseBracketToken ||
    kind === ts.SyntaxKind.CloseBraceToken ||
    kind === ts.SyntaxKind.PlusPlusToken ||
    kind === ts.SyntaxKind.MinusMinusToken ||
    kind === ts.SyntaxKind.TrueKeyword ||
    kind === ts.SyntaxKind.FalseKeyword ||
    kind === ts.SyntaxKind.NullKeyword ||
    kind === ts.SyntaxKind.UndefinedKeyword ||
    kind === ts.SyntaxKind.ThisKeyword ||
    kind === ts.SyntaxKind.BreakKeyword ||
    kind === ts.SyntaxKind.ContinueKeyword ||
    kind === ts.SyntaxKind.ReturnKeyword ||
    kind === ts.SyntaxKind.ThrowKeyword ||
    kind === ts.SyntaxKind.DebuggerKeyword ||
    kind === ts.SyntaxKind.PrivateIdentifier
  );
}

function headerParen(prev) {
  return (
    prev === ts.SyntaxKind.IfKeyword ||
    prev === ts.SyntaxKind.WhileKeyword ||
    prev === ts.SyntaxKind.ForKeyword ||
    prev === ts.SyntaxKind.SwitchKeyword ||
    prev === ts.SyntaxKind.WithKeyword ||
    prev === ts.SyntaxKind.CatchKeyword
  );
}

function nextCode(text, end) {
  let i = end;
  while (i < text.length) {
    const ch = text[i];
    if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r') {
      i++;
      continue;
    }
    if (ch === '/' && text[i + 1] === '/') {
      i += 2;
      while (i < text.length && text[i] !== '\n') i++;
      continue;
    }
    if (ch === '/' && text[i + 1] === '*') {
      const close = text.indexOf('*/', i + 2);
      i = close < 0 ? text.length : close + 2;
      continue;
    }
    return ch;
  }
  return '';
}

const NAME_INTRO = new Set([
  ts.SyntaxKind.OpenParenToken,
  ts.SyntaxKind.OpenBraceToken,
  ts.SyntaxKind.CommaToken,
  ts.SyntaxKind.SemicolonToken,
  ts.SyntaxKind.DotDotDotToken,
  ts.SyntaxKind.PublicKeyword,
  ts.SyntaxKind.PrivateKeyword,
  ts.SyntaxKind.ProtectedKeyword,
  ts.SyntaxKind.ReadonlyKeyword,
  ts.SyntaxKind.StaticKeyword,
  ts.SyntaxKind.AbstractKeyword,
  ts.SyntaxKind.DeclareKeyword,
  ts.SyntaxKind.OverrideKeyword,
  ts.SyntaxKind.AccessorKeyword,
]);

function inClassBody(st) {
  return st.classMark.length > 0 && st.classMark[st.classMark.length - 1] === true;
}

function inObjectLiteral(st) {
  return st.objectMark.length > 0 && st.objectMark[st.objectMark.length - 1] === true;
}

// `a?:` is optional only on a type, parameter, or property name. `a ? :` is a ternary.
function optionalColon(st, prev, beforePrev) {
  const name =
    prev === ts.SyntaxKind.Identifier ||
    prev === ts.SyntaxKind.PrivateIdentifier ||
    prev === ts.SyntaxKind.CloseBracketToken;
  if (!name) return false;
  if (st.typeFrame) return true;
  if (prev === ts.SyntaxKind.CloseBracketToken) return inClassBody(st) || inObjectLiteral(st);
  if (
    st.paramDepth > 0 &&
    NAME_INTRO.has(beforePrev) &&
    beforePrev !== ts.SyntaxKind.OpenBraceToken
  )
    return true;
  if (inClassBody(st) && NAME_INTRO.has(beforePrev)) return true;
  return (
    inObjectLiteral(st) &&
    (beforePrev === ts.SyntaxKind.OpenBraceToken || beforePrev === ts.SyntaxKind.CommaToken)
  );
}

// `a?:`, `a?`, `a? =` and `[a?]` are optional punctuation, not an open ternary.
function optionalQuestion(text, end, st, prev, beforePrev) {
  const ch = nextCode(text, end);
  if (ch === ')' || ch === ',' || ch === '=' || ch === ']' || ch === '}') return true;
  return ch === ':' && optionalColon(st, prev, beforePrev);
}

// `enum` / `interface` arm a type body only as a declaration, not a property or member.
function isTypeDecl(st, kind, prev, text, end) {
  if (kind !== ts.SyntaxKind.InterfaceKeyword && kind !== ts.SyntaxKind.EnumKeyword) return false;
  if (prev === ts.SyntaxKind.DotToken || prev === ts.SyntaxKind.QuestionDotToken) return false;
  if (nextCode(text, end) === ':') return false;
  return (
    st.atStmt ||
    prev === ts.SyntaxKind.ExportKeyword ||
    prev === ts.SyntaxKind.DeclareKeyword ||
    prev === ts.SyntaxKind.DefaultKeyword ||
    (kind === ts.SyntaxKind.EnumKeyword && prev === ts.SyntaxKind.ConstKeyword)
  );
}

// A decorator expression stays open through `@dec`, `@dec.a`, and `@dec()`.
function advanceDecorator(st, kind, prev, beforePrev) {
  const head = st.decoratorHead;
  if (kind === ts.SyntaxKind.AtToken) {
    const continues =
      head === 'ready' ||
      prev === ts.SyntaxKind.AtToken ||
      (prev === ts.SyntaxKind.Identifier && beforePrev === ts.SyntaxKind.AtToken);
    if (!continues) {
      st.decoratorExpr = exprIntroducer(st, prev, beforePrev) || exprFrame(st);
      st.decoratorDefault = prev === ts.SyntaxKind.DefaultKeyword;
    }
    st.decoratorHead = 'name';
    return;
  }
  if (!head) return;
  if (head === 'name') {
    st.decoratorHead = kind === ts.SyntaxKind.Identifier ? 'ready' : false;
    return;
  }
  if (head === 'ready') {
    if (kind === ts.SyntaxKind.DotToken) st.decoratorHead = 'name';
    else if (kind === ts.SyntaxKind.OpenParenToken) st.decoratorHead = 1;
    else if (kind !== ts.SyntaxKind.ClassKeyword) st.decoratorHead = false;
    return;
  }
  if (typeof head === 'number') {
    if (kind === ts.SyntaxKind.OpenParenToken) st.decoratorHead = head + 1;
    else if (kind === ts.SyntaxKind.CloseParenToken)
      st.decoratorHead = head === 1 ? 'ready' : head - 1;
  }
}

function noteSyntax(st, kind, prev, beforePrev, word, lineBreak, text, end) {
  try {
    if (
      lineBreak &&
      allowsASI(prev) &&
      !exprFrame(st) &&
      !st.typeFrame &&
      !st.parens.length &&
      !st.brackets
    )
      st.atStmt = true;
    const colonBrace = st.stmtColon;
    st.stmtColon = false;
    st.sawLabelIdent = kind === ts.SyntaxKind.Identifier && st.atStmt && !st.typeFrame;
    st.nextStmt = false;
    if (
      kind === ts.SyntaxKind.StringLiteral &&
      (prev === ts.SyntaxKind.FromKeyword || prev === ts.SyntaxKind.ImportKeyword)
    )
      st.expectAttr = true;
    else if (st.expectAttr === true && (word === 'with' || word === 'assert'))
      st.expectAttr = 'brace';
    else if (kind !== ts.SyntaxKind.OpenBraceToken) st.expectAttr = false;
    const decorated =
      kind === ts.SyntaxKind.ClassKeyword && st.decoratorExpr && st.decoratorHead === 'ready';
    advanceDecorator(st, kind, prev, beforePrev);
    // `?.` and `??` are their own tokens. Skip `?` only on an optional type, parameter, or property.
    if (kind === ts.SyntaxKind.QuestionToken && !optionalQuestion(text, end, st, prev, beforePrev))
      st.questions.push(st.frames.length);
    if (kind === ts.SyntaxKind.CaseKeyword)
      st.clauses.push({ depth: st.frames.length, qCount: st.questions.length });
    if (kind === ts.SyntaxKind.DefaultKeyword) st.defaultAtStmt = st.atStmt;
    if (kind === ts.SyntaxKind.InterfaceKeyword || kind === ts.SyntaxKind.EnumKeyword) {
      if (isTypeDecl(st, kind, prev, text, end)) st.declBrace = { angles: 0 };
    }
    if (st.declBrace && kind !== ts.SyntaxKind.OpenBraceToken) {
      if (kind === ts.SyntaxKind.LessThanToken) st.declBrace.angles++;
      else if (kind === ts.SyntaxKind.GreaterThanToken) st.declBrace.angles--;
      else if (kind === ts.SyntaxKind.GreaterThanGreaterThanToken) st.declBrace.angles -= 2;
      else if (kind === ts.SyntaxKind.GreaterThanGreaterThanGreaterThanToken)
        st.declBrace.angles -= 3;
    }
    if (kind === ts.SyntaxKind.OpenParenToken) {
      const pendingBody = st.bodies[st.bodies.length - 1];
      const param = !!(pendingBody && !pendingBody.closed);
      if (param) st.paramDepth++;
      st.paramParens.push(param);
      st.parens.push(
        headerParen(prev) ||
          (prev === ts.SyntaxKind.AwaitKeyword && beforePrev === ts.SyntaxKind.ForKeyword),
      );
    }
    if (kind === ts.SyntaxKind.OpenBracketToken) st.brackets++;
    else if (kind === ts.SyntaxKind.CloseBracketToken && st.brackets) st.brackets--;
    if (kind === ts.SyntaxKind.FunctionKeyword || kind === ts.SyntaxKind.ClassKeyword) {
      const intro = prev === ts.SyntaxKind.AsyncKeyword ? beforePrev : prev;
      const introBefore = prev === ts.SyntaxKind.AsyncKeyword ? undefined : beforePrev;
      const introBreak = prev === ts.SyntaxKind.AsyncKeyword ? st.breakBefore : lineBreak;
      st.bodies.push({
        expr:
          (exprIntroducer(st, intro, introBefore) || decorated) &&
          !(intro === ts.SyntaxKind.ReturnKeyword && introBreak),
        named: false,
        closed: false,
        isDefault: intro === ts.SyntaxKind.DefaultKeyword || st.decoratorDefault,
        isClass: kind === ts.SyntaxKind.ClassKeyword,
      });
      st.decoratorDefault = false;
      if (kind === ts.SyntaxKind.ClassKeyword) st.decoratorHead = false;
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
      st.declBrace = null;
      while (st.questions.length && st.questions[st.questions.length - 1] >= st.frames.length)
        st.questions.pop();
      st.nextStmt = true;
    }
    if (
      kind === ts.SyntaxKind.ElseKeyword ||
      kind === ts.SyntaxKind.DoKeyword ||
      kind === ts.SyntaxKind.TryKeyword ||
      kind === ts.SyntaxKind.FinallyKeyword ||
      kind === ts.SyntaxKind.CatchKeyword
    )
      st.nextStmt = true;
    if (kind === ts.SyntaxKind.CloseParenToken && st.parens.length) {
      if (st.parens.pop()) st.nextStmt = true;
      if (st.paramParens.pop()) st.paramDepth--;
    }
    if (kind === ts.SyntaxKind.OpenBraceToken) {
      const attr = st.expectAttr === 'brace';
      st.expectAttr = false;
      let stmt = opensStatement(st, prev);
      const pending = st.bodies[st.bodies.length - 1];
      let tookBody = false;
      let classBody = false;
      if (pending && bodyPrev(prev)) {
        classBody = pending.isClass === true;
        st.bodies.pop();
        tookBody = true;
        const expr = pending.expr || (!pending.named && !pending.isDefault);
        stmt = !expr;
      }
      if (attr) stmt = true;
      if (colonBrace && !tookBody) stmt = true;
      let frame = stmt;
      if (st.declBrace && st.declBrace.angles <= 0) {
        frame = 'type';
        st.declBrace = null;
      }
      st.typeFrame = frame === 'type';
      st.frames.push(frame);
      st.classMark.push(classBody);
      st.objectMark.push(!tookBody && frame === false);
      st.nextStmt = frame === true;
    } else if (kind === ts.SyntaxKind.CloseBraceToken) {
      const frame = st.frames.length ? st.frames.pop() : true;
      if (st.classMark.length) st.classMark.pop();
      if (st.objectMark.length) st.objectMark.pop();
      st.closeBraceRegex = frame === true || frame === 'type';
      st.typeFrame = st.frames[st.frames.length - 1] === 'type';
      while (st.questions.length && st.questions[st.questions.length - 1] > st.frames.length)
        st.questions.pop();
      if (st.closeBraceRegex) st.nextStmt = true;
    } else st.typeFrame = st.frames[st.frames.length - 1] === 'type';
    if (kind === ts.SyntaxKind.ColonToken) {
      const qDepth = st.questions.length ? st.questions[st.questions.length - 1] : -1;
      const clause = st.clauses.length ? st.clauses[st.clauses.length - 1] : undefined;
      const clauseHere = !!clause && clause.depth === st.frames.length;
      const inCaseExpr =
        clauseHere && st.questions.length > clause.qCount && qDepth === st.frames.length;
      const switchDefault = prev === ts.SyntaxKind.DefaultKeyword && st.defaultAtStmt;
      const label = st.prevLabelIdent;
      const structural = (clauseHere && !inCaseExpr) || switchDefault || label;
      if (structural) {
        st.lastColonTernary = false;
        st.stmtColon = true;
        st.nextStmt = true;
        if (clauseHere && !inCaseExpr) st.clauses.pop();
      } else if (qDepth === st.frames.length) {
        st.lastColonTernary = true;
        st.questions.pop();
      } else st.lastColonTernary = false;
    } else if (kind !== ts.SyntaxKind.AsyncKeyword) st.lastColonTernary = false;
  } finally {
    st.prevWord = word;
    st.breakBefore = lineBreak;
    st.prevLabelIdent = st.sawLabelIdent;
    st.atStmt = st.nextStmt;
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
    atStmt: true,
    nextStmt: false,
    sawLabelIdent: false,
    prevLabelIdent: false,
    stmtColon: false,
    clauses: [],
    defaultAtStmt: false,
    declBrace: null,
    typeFrame: false,
    parens: [],
    paramParens: [],
    paramDepth: 0,
    classMark: [],
    objectMark: [],
    brackets: 0,
    decoratorExpr: false,
    decoratorDefault: false,
    decoratorHead: false,
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
          text,
          scanner.getTokenEnd(),
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
