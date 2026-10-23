import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const { evaluateRun, parsePositiveRunIdText, parseRerunApprovalLine, parseRunPayload } =
  createRequire(import.meta.url)('../../scripts/ci-run-check.mjs') as {
    evaluateRun: (input: {
      run: {
        id: number;
        run_attempt: number;
        status: string;
        conclusion: string | null;
        head_sha: string;
      };
      gateText?: string;
      shaPrefix?: string;
    }) => { ok: boolean; reason: string };
    parsePositiveRunIdText: (text: string) => number | null;
    parseRerunApprovalLine: (line: string, expectedRunId: number) => boolean;
    parseRunPayload: (payload: unknown) => {
      id: number;
      run_attempt: number;
      status: string;
      conclusion: string | null;
      head_sha: string;
    };
  };

const approvalLine = 'rerun-approval: 39573175794 by Marek 2026-10-22: "approved in Slack thread"';

const completedRun = {
  id: 39567957339,
  run_attempt: 1,
  status: 'completed',
  conclusion: 'success',
  head_sha: '4fdb337abcdef1234567890abcdef1234567890',
};

describe('parsePositiveRunIdText', () => {
  it('rejects fractional run ids', () => {
    expect(parsePositiveRunIdText('39567957339.5')).toBeNull();
  });
});

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

  it('rejects run_attempt below 1', () => {
    expect(() =>
      parseRunPayload({
        id: 1,
        run_attempt: 0,
        status: 'completed',
        conclusion: 'success',
        head_sha: 'abc',
      }),
    ).toThrow(/run_attempt/);
  });

  it('rejects non-integer run_attempt', () => {
    expect(() =>
      parseRunPayload({
        id: 1,
        run_attempt: 1.5,
        status: 'completed',
        conclusion: 'success',
        head_sha: 'abc',
      }),
    ).toThrow(/run_attempt/);
  });
});

describe('parseRerunApprovalLine', () => {
  it('accepts a structured approval line', () => {
    expect(parseRerunApprovalLine(approvalLine, 39573175794)).toBe(true);
  });

  it('rejects denied shorthand', () => {
    expect(parseRerunApprovalLine('rerun-approval: 39573175794 denied', 39573175794)).toBe(false);
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

  it('passes attempt 2 with a matching structured approval line', () => {
    const result = evaluateRun({
      run: { ...completedRun, id: 39573175794, run_attempt: 2 },
      gateText: approvalLine,
    });
    expect(result.ok).toBe(true);
  });

  it('does not accept rerun-approval for a different run id', () => {
    const result = evaluateRun({
      run: { ...completedRun, id: 39573175794, run_attempt: 2 },
      gateText: 'rerun-approval: 39567957339 by Marek 2026-10-22: "approved in Slack thread"',
    });
    expect(result.ok).toBe(false);
  });

  it('does not accept a longer id that shares the same digit prefix', () => {
    const result = evaluateRun({
      run: { ...completedRun, id: 39573175794, run_attempt: 2 },
      gateText: 'rerun-approval: 395731757940 by Marek 2026-10-22: "approved in Slack thread"',
    });
    expect(result.ok).toBe(false);
  });

  it('does not accept a shorter id that is a digit prefix of the run id', () => {
    const result = evaluateRun({
      run: { ...completedRun, id: 39573175794, run_attempt: 2 },
      gateText: 'rerun-approval: 3957317579 by Marek 2026-10-22: "approved in Slack thread"',
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

  for (const conclusion of ['failure', 'cancelled', 'timed_out', null] as const) {
    it(`fails when conclusion is ${conclusion ?? 'null'}`, () => {
      const result = evaluateRun({
        run: { ...completedRun, conclusion },
      });
      expect(result.ok).toBe(false);
      expect(result.reason).toBe(`run ${completedRun.id} concluded ${conclusion ?? 'null'}`);
    });
  }

  it('passes when head_sha matches the sha prefix', () => {
    const result = evaluateRun({
      run: completedRun,
      shaPrefix: '4fdb337',
    });
    expect(result.ok).toBe(true);
  });

  it('fails when head_sha does not match the sha prefix', () => {
    const result = evaluateRun({
      run: completedRun,
      shaPrefix: 'deadbee',
    });
    expect(result.ok).toBe(false);
    expect(result.reason).toContain('head_sha does not start with deadbee');
  });
});
