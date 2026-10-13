import { createRequire } from 'node:module';
import { expect, it } from 'vitest';

const { smokeExitDetail } = createRequire(import.meta.url)('../../scripts/test-web-worker.cjs');

it('names the signal when the Electron smoke process exits without a status code', () => {
  expect(smokeExitDetail(null, 'SIGABRT')).toBe('signal SIGABRT');
  expect(smokeExitDetail(null, null)).toBe('signal unknown');
  expect(`Web worker smoke failed (${smokeExitDetail(null, 'SIGABRT')}).`).not.toContain('null');
  expect(smokeExitDetail(1, null)).toBe('1');
});
