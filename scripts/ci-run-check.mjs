import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';

/**
 * @param {unknown} payload
 * @returns {{ id: number, run_attempt: number, status: string, conclusion: string | null, head_sha: string }}
 */
export function parseRunPayload(payload) {
  if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new Error('GitHub run payload must be a JSON object');
  }
  const record = payload;
  const id = record.id;
  if (typeof id !== 'number' || !Number.isFinite(id)) {
    throw new Error('GitHub run payload missing or invalid id');
  }
  const runAttempt = record.run_attempt;
  if (typeof runAttempt !== 'number' || !Number.isFinite(runAttempt)) {
    throw new Error('GitHub run payload missing or invalid run_attempt');
  }
  const status = record.status;
  if (typeof status !== 'string' || status.length === 0) {
    throw new Error('GitHub run payload missing or invalid status');
  }
  const conclusion = record.conclusion;
  if (conclusion !== null && typeof conclusion !== 'string') {
    throw new Error('GitHub run payload has invalid conclusion');
  }
  const headSha = record.head_sha;
  if (typeof headSha !== 'string' || headSha.length === 0) {
    throw new Error('GitHub run payload missing or invalid head_sha');
  }
  return {
    id,
    run_attempt: runAttempt,
    status,
    conclusion,
    head_sha: headSha,
  };
}

/**
 * @param {{ run: ReturnType<typeof parseRunPayload>, gateText?: string }} input
 * @returns {{ ok: boolean, reason: string }}
 */
export function evaluateRun({ run, gateText = '' }) {
  if (run.status !== 'completed') {
    return {
      ok: false,
      reason: `run ${run.id} is not completed (status=${run.status})`,
    };
  }

  if (run.run_attempt > 1) {
    const approvalPattern = new RegExp(`^rerun-approval: ${run.id} \\S`);
    const hasApproval = gateText.split('\n').some((line) => approvalPattern.test(line));
    if (!hasApproval) {
      return {
        ok: false,
        reason:
          `run ${run.id} is attempt ${run.run_attempt}: manual reruns are not allowed unless the gate file has ` +
          `"rerun-approval: ${run.id} <Marek's approval>"`,
      };
    }
  }

  const sha7 = run.head_sha.slice(0, 7);
  const conclusion = run.conclusion ?? 'none';
  return {
    ok: true,
    reason: `PASS run ${run.id} attempt ${run.run_attempt} ${conclusion} ${sha7}`,
  };
}

function usage() {
  console.error(
    'Usage: node scripts/ci-run-check.mjs --repo <owner/name> --run <run-id> [--gate <gate-file-path>]',
  );
}

function lastLine(text) {
  const lines = text.trim().split('\n').filter(Boolean);
  return lines.length > 0 ? lines[lines.length - 1] : 'gh command failed';
}

/**
 * @param {string} repo
 * @param {number} runId
 * @returns {ReturnType<typeof parseRunPayload>}
 */
export function fetchRunFromGh(repo, runId) {
  const endpoint = `repos/${repo}/actions/runs/${runId}`;
  let stdout;
  try {
    stdout = execFileSync('gh', ['api', endpoint], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (error) {
    const stderr =
      error && typeof error === 'object' && 'stderr' in error && typeof error.stderr === 'string'
        ? error.stderr
        : '';
    console.error(lastLine(stderr));
    throw error;
  }
  const raw = JSON.parse(stdout);
  return parseRunPayload({
    id: raw.id,
    run_attempt: raw.run_attempt,
    status: raw.status,
    conclusion: raw.conclusion,
    head_sha: raw.head_sha,
  });
}

function main() {
  const { values } = parseArgs({
    options: {
      repo: { type: 'string' },
      run: { type: 'string' },
      gate: { type: 'string' },
    },
    strict: true,
  });

  if (!values.repo || !values.run) {
    usage();
    process.exit(2);
  }

  const runId = Number(values.run);
  if (!Number.isFinite(runId) || runId <= 0) {
    usage();
    process.exit(2);
  }

  let gateText = '';
  if (values.gate) {
    try {
      gateText = readFileSync(values.gate, 'utf8');
    } catch {
      console.error(`could not read gate file: ${values.gate}`);
      process.exit(2);
    }
  }

  let run;
  try {
    run = fetchRunFromGh(values.repo, runId);
  } catch {
    process.exit(2);
  }

  const result = evaluateRun({ run, gateText });
  if (!result.ok) {
    console.error(`FAIL ${result.reason}`);
    process.exit(1);
  }
  console.log(result.reason);
  process.exit(0);
}

const isMainModule = process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1]);
if (isMainModule) {
  main();
}
