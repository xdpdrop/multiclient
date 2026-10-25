import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

type Run = {
  id: number;
  run_attempt: number;
  status: string;
  conclusion: string | null;
  head_sha: string;
};

const importedCiRunCheckApi = createRequire(import.meta.url)('../../scripts/ci-run-check.mjs');
const realEvaluateRun = importedCiRunCheckApi.evaluateRun;
const evaluateRun = (input: object) =>
  realEvaluateRun({ headSubject: 'Refresh the gate', ...input });
const { parsePositiveRunIdText, parseRerunApprovalLine, parseRunPayload } =
  importedCiRunCheckApi as {
    parsePositiveRunIdText: (text: string) => number | null;
    parseRerunApprovalLine: (line: string, expectedRunId: number) => boolean;
    parseRunPayload: (payload: unknown) => Run;
  };

const approval = 'rerun-approval: 39573175794 by Marek 2026-10-22: "approved"';
const run: Run = {
  id: 39567957339,
  run_attempt: 1,
  status: 'completed',
  conclusion: 'success',
  head_sha: '4fdb337abcdef1234567890abcdef1234567890',
};
const rerun: Run = { ...run, id: 39573175794, run_attempt: 2 };
const basePayload = {
  id: 1,
  run_attempt: 1,
  status: 'completed',
  conclusion: 'success',
  head_sha: 'abc',
};

describe('parsePositiveRunIdText', () => {
  it('rejects fractional run ids', () => {
    expect(parsePositiveRunIdText('39567957339.5')).toBeNull();
  });
});

describe('parseRunPayload', () => {
  it('rejects missing run_attempt', () => {
    expect(() => parseRunPayload({ ...basePayload, run_attempt: undefined })).toThrow(
      /run_attempt/,
    );
  });

  it.each([[0], [1.5]])('rejects run_attempt %p', (runAttempt) => {
    expect(() => parseRunPayload({ ...basePayload, run_attempt: runAttempt })).toThrow(
      /run_attempt/,
    );
  });

  it('rejects unsafe integer id', () => {
    expect(() => parseRunPayload({ ...basePayload, id: Number.MAX_SAFE_INTEGER + 1 })).toThrow(
      /invalid id/,
    );
  });
});

describe('parseRerunApprovalLine', () => {
  it('accepts structured approval', () => {
    expect(parseRerunApprovalLine(approval, 39573175794)).toBe(true);
  });

  it('rejects denied shorthand', () => {
    expect(parseRerunApprovalLine('rerun-approval: 39573175794 denied', 39573175794)).toBe(false);
  });

  it.each(['2026-99-99', '2026-02-30'])('rejects impossible date %s', (date) => {
    expect(
      parseRerunApprovalLine(`rerun-approval: 39573175794 by Marek ${date}: "ok"`, 39573175794),
    ).toBe(false);
  });
});

describe('evaluateRun', () => {
  it('passes attempt 1', () => {
    expect(evaluateRun({ run }).ok).toBe(true);
  });

  it('fails attempt 2 without approval', () => {
    expect(evaluateRun({ run: rerun }).reason).toContain('manual reruns are not allowed');
  });

  it('passes attempt 2 with approval and CRLF gate lines', () => {
    expect(evaluateRun({ run: rerun, gateText: `${approval}\r` }).ok).toBe(true);
  });

  it.each([
    ['other id', 'rerun-approval: 39567957339 by Marek 2026-10-22: "ok"'],
    ['longer id', 'rerun-approval: 395731757940 by Marek 2026-10-22: "ok"'],
    ['shorter id', 'rerun-approval: 3957317579 by Marek 2026-10-22: "ok"'],
  ])('rejects mismatched approval (%s)', (_label, gateText) => {
    expect(evaluateRun({ run: rerun, gateText }).ok).toBe(false);
  });

  it('fails when status is not completed', () => {
    expect(evaluateRun({ run: { ...run, status: 'in_progress' } }).reason).toContain(
      'not completed',
    );
  });

  it.each(['failure', 'cancelled', 'timed_out', null])('fails conclusion %p', (conclusion) => {
    const result = evaluateRun({ run: { ...run, conclusion } });
    expect(result.reason).toBe(`run ${run.id} concluded ${conclusion ?? 'null'}`);
  });

  it('matches sha prefix case-insensitively', () => {
    expect(evaluateRun({ run, shaPrefix: '4FDB337' }).ok).toBe(true);
  });

  it('fails on sha mismatch', () => {
    expect(evaluateRun({ run, shaPrefix: 'deadbee' }).reason).toContain('deadbee');
  });

  it('rejects empty sha prefix', () => {
    expect(evaluateRun({ run, shaPrefix: '' }).ok).toBe(false);
  });

  it('fails closed without a head subject and on every CI skip token', () => {
    expect(realEvaluateRun({ run }).ok).toBe(false);
    for (const token of ['[skip ci]', '[ci skip]', '[no ci]', '[skip actions]', '[actions skip]'])
      expect(realEvaluateRun({ run, headSubject: token.toUpperCase() }).ok).toBe(false);
    for (const trailer of ['skip-checks:true', 'skip-checks: true'])
      expect(realEvaluateRun({ run, headSubject: `Subject\n\n${trailer}` }).ok).toBe(false);
    expect(evaluateRun({ run }).ok).toBe(true);
    expect(evaluateRun({ run: { ...run, conclusion: 'failure' } }).ok).toBe(false);
  });
});
