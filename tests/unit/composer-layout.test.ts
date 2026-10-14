import { expect, it } from 'vitest';
import { composerCenterDelta, EMPTY_COMPOSER_CENTER_TOLERANCE } from '../e2e/layout';

it('accepts the empty-state composer offset measured on every CI OS', () => {
  const main = { y: 42, height: 800 };
  const composer = { y: 470, height: 200 };
  const measured = [109.328125, 110.328125, 112.453125];
  for (const delta of measured) {
    expect(delta).toBeGreaterThanOrEqual(100);
    expect(delta).toBeLessThan(EMPTY_COMPOSER_CENTER_TOLERANCE);
  }
  expect(composerCenterDelta(composer, main)).toBeGreaterThanOrEqual(100);
  expect(composerCenterDelta(composer, main)).toBeLessThan(EMPTY_COMPOSER_CENTER_TOLERANCE);
  const pinnedToBottom = { y: main.y + main.height - 80, height: 80 };
  expect(composerCenterDelta(pinnedToBottom, main)).toBeGreaterThan(
    EMPTY_COMPOSER_CENTER_TOLERANCE,
  );
});
