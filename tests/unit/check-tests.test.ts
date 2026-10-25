import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const { scanText, scanTree } = createRequire(import.meta.url)('../../scripts/check-tests.mjs') as {
  scanText: (text: string, file: string) => { file: string; line: number; rule: string }[];
  scanTree: (root: string) => { file: string; line: number; rule: string }[];
};

const bareSleep = 'await new Promise((resolve) => set' + 'Timeout(resolve, 5));\n';
const unmarkedSkip = 'it.sk' + 'ip("parked", () => {});\n';
const citedSkip =
  '// https://github.com/xdpdrop/multiclient/issues/18\nit.skip' + 'If(true)("kept", () => {});\n';

describe('check-tests', () => {
  it('flags a bare sleep and an unmarked skip, and allows an issue citation', () => {
    expect(scanText(bareSleep, 'tests/x.ts')).toEqual([
      { file: 'tests/x.ts', line: 1, rule: 'bare-sleep' },
    ]);
    expect(scanText(unmarkedSkip, 'tests/x.ts')[0]?.rule).toBe('skip-without-issue');
    expect(scanText(citedSkip, 'tests/x.ts')).toEqual([]);
    expect(scanText(bareSleep, 'tests/wait-for.ts')).toEqual([]);
  });

  it('accepts the repository tests', () => {
    expect(scanTree('tests')).toEqual([]);
  });
});
