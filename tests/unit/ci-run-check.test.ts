import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const { evaluateRun, parseRunPayload } = createRequire(import.meta.url)(
  '../../scripts/ci-run-check.mjs',
) as {
  evaluateRun: (input: {
    run: {
      id: number;
      run_attempt: number;
      status: string;
      conclusion: string | null;
      head_sha: string;
    };
    gateText?: string;
  }) => { ok: boolean; reason: string };
  parseRunPayload: (payload: unknown) => {
    id: number;
    run_attempt: number;
    status: string;
    conclusion: string | null;
    head_sha: string;
  };
};

const completedRun = {
  id: 39567957339,
  run_attempt: 1,
  status: 'completed',
  conclusion: 'success',
  head_sha: 'abcdef1234567890abcdef1234567890abcdef12',
};

describe('parseRunPayload', () => {
  it('rejects a payload missing run_attempt', () => {
    expect(() =>
      parseRunPayload({
        id: 1,
        status: 'completed',
        conclusion: 'success',
        head_sha: 'abc',
      }),
    ).toThrow(/run_attempt/);
  });
});

describe('evaluateRun', () => {
  it('passes attempt 1', () => {
    const result = evaluateRun({ run: completedRun });
    expect(result.ok).toBe(true);
    expect(result.reason).toContain('PASS run 39567957339 attempt 1');
  });

  it('fails attempt 2 without approval', () => {
    const result = evaluateRun({
      run: { ...completedRun, id: 39573175794, run_attempt: 2 },
    });
    expect(result.ok).toBe(false);
    expect(result.reason).toContain('manual reruns are not allowed');
  });

  it('passes attempt 2 with a matching rerun-approval line', () => {
    const result = evaluateRun({
      run: { ...completedRun, id: 39573175794, run_attempt: 2 },
      gateText: 'rerun-approval: 39573175794 approved in Slack thread',
    });
    expect(result.ok).toBe(true);
  });

  it('does not accept rerun-approval for a different run id', () => {
    const result = evaluateRun({
      run: { ...completedRun, id: 39573175794, run_attempt: 2 },
      gateText: 'rerun-approval: 39567957339 approved in Slack thread',
    });
    expect(result.ok).toBe(false);
  });

  it('fails when status is not completed', () => {
    const result = evaluateRun({
      run: { ...completedRun, status: 'in_progress' },
    });
    expect(result.ok).toBe(false);
    expect(result.reason).toContain('not completed');
  });
});
