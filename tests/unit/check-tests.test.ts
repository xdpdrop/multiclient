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
