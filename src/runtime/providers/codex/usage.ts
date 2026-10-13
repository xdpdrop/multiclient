import { z } from 'zod';
import type { ConnectionUsage } from '../../../shared/types';

const windowSchema = z.object({
  usedPercent: z.number(),
  windowDurationMins: z.number().positive().nullish(),
  resetsAt: z.number().nonnegative().max(8640000000000).nullish(),
});
const bucketSchema = z.object({
  limitId: z.string().nullish(),
  limitName: z.string().nullish(),
  primary: z.unknown().optional(),
  secondary: z.unknown().optional(),
});
const responseSchema = z.object({
  rateLimits: z.unknown().optional(),
  rateLimitsByLimitId: z.record(z.string(), z.unknown()).nullish(),
});

function duration(minutes: number | null | undefined, fallback: string) {
  if (!minutes) return fallback;
  if (minutes % 1440 === 0) return `${minutes / 1440} day`;
  if (minutes % 60 === 0) return `${minutes / 60} hour`;
  return `${minutes} minute`;
}

export function parseCodexUsage(value: unknown): ConnectionUsage {
  const response = responseSchema.parse(value);
  const mapped = Object.entries(response.rateLimitsByLimitId ?? {});
  const buckets = mapped.length ? mapped : [['codex', response.rateLimits]];
  const windows: ConnectionUsage['windows'] = [];
  for (const [id, raw] of buckets) {
    const bucket = bucketSchema.safeParse(raw);
    if (!bucket.success) continue;
    const name = bucket.data.limitName || bucket.data.limitId || String(id);
    for (const key of ['primary', 'secondary'] as const) {
      const parsed = windowSchema.safeParse(bucket.data[key]);
      if (!parsed.success) continue;
      const window = parsed.data;
      windows.push({
        id: `${id}:${key}`,
        label: `${name === 'codex' ? 'Codex' : name} · ${duration(window.windowDurationMins, key === 'primary' ? 'Primary limit' : 'Secondary limit')}`,
        remainingPercent: Math.max(0, Math.min(100, 100 - window.usedPercent)),
        ...(window.resetsAt != null ? { resetsAt: window.resetsAt } : {}),
      });
    }
  }
  return { checkedAt: new Date().toISOString(), windows };
}
