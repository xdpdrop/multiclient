import { expect, it } from 'vitest';
import { joinPdfText } from '../../src/runtime/files/attachments';

const run = (str: string, x: number, width: number, y = 100) => ({
  str,
  transform: [1, 0, 0, 1, x, y],
  width,
  height: 12,
});

it('joins a split fi ligature and keeps one space between words', () => {
  const items = [run('Export', 10, 48), run('fi', 70, 8), run('xture', 78, 32)];
  const alwaysSpaced = items
    .map((item) => item.str + ' ')
    .join('')
    .trim();
  expect(alwaysSpaced).toBe('Export fi xture');
  expect(joinPdfText(items)).toBe('Export fixture');
  expect(
    joinPdfText([
      run('const', 10, 36, 80),
      run('exportFixture', 58, 90, 80),
      run('=', 160, 8, 80),
      run('true;', 180, 32, 80),
    ]),
  ).toBe('const exportFixture = true;');
  expect(joinPdfText([run('ﬁxture', 0, 40)])).toBe('fixture');
});
