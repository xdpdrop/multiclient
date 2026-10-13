import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { parseCodexUsage } from '../../src/runtime/providers/codex/usage';
import { ConnectionUsage } from '../../src/renderer/components/ConnectionUsage';

describe('remaining subscription usage', () => {
  it('prefers per-bucket limits without duplicating the legacy window', () => {
    const usage = parseCodexUsage({
      rateLimits: { primary: { usedPercent: 99 } },
      rateLimitsByLimitId: {
        codex: {
          primary: { usedPercent: 25, windowDurationMins: 300, resetsAt: 1800000000 },
          secondary: { usedPercent: 42, windowDurationMins: 10080 },
        },
        other: { limitName: 'Other model', primary: { usedPercent: 100 } },
      },
    });
    expect(usage.windows.map((w) => w.remainingPercent)).toEqual([75, 58, 0]);
    expect(usage.windows[0].label).toBe('Codex · 5 hour');
    expect(usage.windows[0].resetsAt).toBe(1800000000);
    expect(usage.windows[1].label).toBe('Codex · 7 day');
    expect(usage.windows[2].label).toContain('Other model');
  });
  it('does not turn missing, malformed, or null data into unused quota', () => {
    expect(parseCodexUsage({}).windows).toEqual([]);
    expect(
      parseCodexUsage({ rateLimits: { primary: null, secondary: { usedPercent: null } } }).windows,
    ).toEqual([]);
    expect(
      parseCodexUsage({
        rateLimitsByLimitId: {
          bad: false,
          good: { primary: { usedPercent: 12.5 }, secondary: { usedPercent: '20' } },
        },
      }).windows.map((w) => w.remainingPercent),
    ).toEqual([87.5]);
  });
  it('supports legacy limits, clamps excess usage, and does not infer automatic resets', () => {
    const usage = parseCodexUsage({
      rateLimits: { primary: { usedPercent: 110, resetsAt: 1 }, secondary: { usedPercent: -5 } },
    });
    expect(usage.windows.map((w) => w.remainingPercent)).toEqual([0, 100]);
    const html = renderToStaticMarkup(
      createElement(ConnectionUsage, { provider: 'codex', usage, onError: () => {} }),
    );
    expect(html).toContain('0% remaining');
    expect(html).toContain('Reset due');
    expect(html).toContain('Last checked');
    expect(html).toContain('max="100"');
  });
  it('offers the provider page instead of a made-up balance', () => {
    const html = renderToStaticMarkup(
      createElement(ConnectionUsage, { provider: 'claude-code', onError: () => {} }),
    );
    expect(html).not.toContain('<progress');
    expect(html).toContain('View usage');
  });
});
