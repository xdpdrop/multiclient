import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { expect, it } from 'vitest';

const { scanText, scanTree } = createRequire(import.meta.url)('../../scripts/check-tests.mjs') as {
  scanText: (text: string, file: string) => { rule: string }[];
  scanTree: (root: string) => unknown[];
};
const timed = (body: string) => `set${'Timeout'}(${body})`;
const gate = (body: string) =>
  body
    .replaceAll('SKIP', `.${'skip'}`)
    .replaceAll('RUN', `run${'If'}`)
    .replaceAll('SKI', `skip${'If'}`);

it('flags wall-clock waitFor and function-expression timeouts', () => {
  const clock = `wait${'For'}(() => Date.now() - started >= 100, 1000)`;
  const guard = `set${'Timeout'}(function () { resolveExit(-1); }, 15000)`;
  expect(scanText(clock, 'tests/x.ts')[0]?.rule).toBe('bare-sleep');
  expect(scanText(guard, 'tests/x.ts')[0]?.rule).toBe('bare-sleep');
  expect(scanText(clock, 'tests/wait-for.ts')).toEqual([]);
  expect(scanText(guard, 'tests/wait-for.ts')).toEqual([]);
});

it('flags a split waitFor clock, not a same-line comment, and delay helpers off the allowlist', () => {
  const split = `wait${'For'}(\n() => Date.now() - started >= 100,\n1000)`;
  const comment = `wait${'For'}(() => ready, 1000) // Date.now()`;
  const commentedClock = `wait${'For'}(() => Date.now() - started >= 100, 1000) // pause`;
  const pause = `${'after'}(150)`;
  const hang = `${'guardTimeout'}(15000, () => {})`;
  const asyncFn = timed('async function () { resolve(); }, 1');
  const asyncArrow = timed('async () => r(), 1');
  expect(scanText(split, 'tests/x.ts')[0]?.rule).toBe('bare-sleep');
  expect(scanText(comment, 'tests/x.ts')).toEqual([]);
  expect(scanText(commentedClock, 'tests/x.ts')[0]?.rule).toBe('bare-sleep');
  expect(scanText(timed('() => { resolve(); }, 1'), 'tests/x.ts')).toEqual([]);
  expect(scanText(asyncFn, 'tests/x.ts')[0]?.rule).toBe('bare-sleep');
  expect(scanText(asyncArrow, 'tests/x.ts')[0]?.rule).toBe('bare-sleep');
  expect(scanText(pause, 'tests/x.ts')[0]?.rule).toBe('bare-sleep');
  expect(scanText(hang, 'tests/x.ts')[0]?.rule).toBe('bare-sleep');
  expect(scanText(pause, 'tests/e2e/screenshot.ts')).toEqual([]);
  expect(scanText(hang, 'tests/unit/terminal-session.test.ts')).toEqual([]);
  expect(scanText(pause, 'tests/unit/diagram-lifecycle.test.ts')).toEqual([]);
  expect(scanText(hang, 'tests/wait-for.ts')).toEqual([]);
});

it('flags both sleep shapes and each unmarked skip form', () => {
  for (const body of ['r, 1', '() => r(), 1'])
    expect(scanText(timed(body), 'tests/x.ts')[0]?.rule).toBe('bare-sleep');
  for (const body of [
    'testInfoSKIP(true)',
    'test.info()SKIP()',
    'testSKIP(true, "x")',
    'it.SKI(true)()',
    'it.RUN(true)()',
  ])
    expect(scanText(gate(body), 'tests/x.ts')[0]?.rule, body).toBe('skip-without-issue');
  expect(scanText(`// #18\n${gate('it.SKI(true)()')}`, 'tests/x.ts')).toEqual([]);
  expect(scanText(timed('r, 1'), 'tests/wait-for.ts')).toEqual([]);
  expect(scanTree('tests')).toEqual([]);
});

it('flags a sleep hidden by a regex literal on the same line', () => {
  const call = `${'sleep'}(1)`;
  const bySlashes = `const re = /https?:\\/\\//; ${call}`;
  const byParen = `wait${'For'}(() => /\\)/.test(s) || Date.now() > t, 1)`;
  expect(scanText(bySlashes, 'tests/x.ts')[0]?.rule).toBe('bare-sleep');
  expect(scanText(byParen, 'tests/x.ts')[0]?.rule).toBe('bare-sleep');
});

it('flags a sleep after a cast, satisfies, or non-null slash', () => {
  const call = `await ${'sleep'}(1)`;
  const asNumber = `const x = y as number / 2; ${call}`;
  const nonNull = `const z = a! / 2; ${call}`;
  const satisfies = `const w = y satisfies number / 2; ${call}`;
  expect(scanText(asNumber, 'tests/x.ts')[0]?.rule).toBe('bare-sleep');
  expect(scanText(nonNull, 'tests/x.ts')[0]?.rule).toBe('bare-sleep');
  expect(scanText(satisfies, 'tests/x.ts')[0]?.rule).toBe('bare-sleep');
});

it('flags an async arrow timeout that takes an argument', () => {
  expect(scanText(timed('async (arg) => r(), 1'), 'tests/x.ts')[0]?.rule).toBe('bare-sleep');
  expect(scanText(timed('async (arg) => { r(); }, 1'), 'tests/x.ts')[0]?.rule).toBe('bare-sleep');
});

it('scans comments inside template interpolations', () => {
  const call = `${'sleep'}(1)`;
  const block = `const s = \`\${ /* ${call} */ }\``;
  const line = `const s = \`\${ // ${call}\n}\``;
  const live = `const s = \`\${ ${call} }\``;
  expect(scanText(block, 'tests/x.ts')).toEqual([]);
  expect(scanText(line, 'tests/x.ts')).toEqual([]);
  expect(scanText(live, 'tests/x.ts')[0]?.rule).toBe('bare-sleep');
});

it('rejects each planted sleep form in the test tree', () => {
  const call = `${'sleep'}(1)`;
  const root = mkdtempSync(join('tests/unit', '.plant-'));
  const file = join(root, 'sleeps.ts');
  writeFileSync(
    file,
    [
      `const re = /https?:\\/\\//; ${call}`,
      `wait${'For'}(() => /\\)/.test(s) || Date.now() > t, 1)`,
      timed('async (arg) => r(), 1'),
      `const hidden = \`\${ /* note ${call} */ }\``,
      `const shown = \`\${ /* note */ ""; ${call} }\``,
    ].join('\n'),
  );
  try {
    let code = 0;
    let stderr = '';
    try {
      execFileSync(process.execPath, ['scripts/check-tests.mjs', root], { encoding: 'utf8' });
    } catch (error) {
      code = typeof error === 'object' && error && 'status' in error ? Number(error.status) : 0;
      stderr = typeof error === 'object' && error && 'stderr' in error ? String(error.stderr) : '';
    }
    expect(code, stderr).toBe(1);
    const hits = stderr
      .trim()
      .split('\n')
      .filter(Boolean)
      .map((entry) => Number(entry.slice(entry.lastIndexOf(':') + 1)))
      .sort((a, b) => a - b);
    expect(hits).toEqual([1, 2, 3, 5]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
