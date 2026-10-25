import { createRequire } from 'node:module';
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
