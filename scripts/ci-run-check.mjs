import { execFileSync } from 'node:child_process';
import { readFileSync, realpathSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';

const RERUN_LINE_RE = /^rerun-approval: (\d+) by Marek (\d{4}-\d{2}-\d{2}): "(.+)"$/;
const USAGE =
  'Usage: node scripts/ci-run-check.mjs --repo <owner/name> --run <run-id> [--gate <path>] [--sha <prefix>]';

export function parsePositiveRunIdText(text) {
  if (typeof text !== 'string' || !/^\d+$/.test(text)) return null;
  const value = Number(text);
  if (!Number.isSafeInteger(value) || value <= 0 || String(value) !== text) return null;
  return value;
}

function validApprovalDate(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  return date.getFullYear() === y && date.getMonth() === m - 1 && date.getDate() === d;
}

export function parseRunPayload(payload) {
  if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new Error('GitHub run payload must be a JSON object');
  }
  const { id, run_attempt: runAttempt, status, conclusion, head_sha: headSha } = payload;
  if (typeof id !== 'number' || !Number.isSafeInteger(id) || id <= 0) {
    throw new Error('GitHub run payload missing or invalid id');
  }
  if (typeof runAttempt !== 'number' || !Number.isInteger(runAttempt) || runAttempt < 1) {
    throw new Error('GitHub run payload missing or invalid run_attempt');
  }
  if (typeof status !== 'string' || !status) {
    throw new Error('GitHub run payload missing or invalid status');
  }
  if (conclusion !== null && typeof conclusion !== 'string') {
    throw new Error('GitHub run payload has invalid conclusion');
  }
  if (typeof headSha !== 'string' || !headSha) {
    throw new Error('GitHub run payload missing or invalid head_sha');
  }
  return { id, run_attempt: runAttempt, status, conclusion, head_sha: headSha };
}

export function parseRerunApprovalLine(line, expectedRunId) {
  const match = line.replace(/\r$/, '').match(RERUN_LINE_RE);
  if (!match || !match[3] || !validApprovalDate(match[2])) return false;
  const runId = parsePositiveRunIdText(match[1]);
  return runId !== null && runId === expectedRunId;
}

const SKIP_CI_SUBJECT = /\[(?:skip ci|ci skip|no ci|skip actions|actions skip)\]/i;

export function commitSubject(message) {
  if (typeof message !== 'string' || !message.trim()) {
    throw new Error('GitHub commit payload missing message');
  }
  return message.split(/\r?\n/, 1)[0];
}

export function evaluateRun({ run, gateText = '', shaPrefix, headSubject }) {
  if (typeof headSubject !== 'string')
    return { ok: false, reason: 'head commit subject is required' };
  if (SKIP_CI_SUBJECT.test(headSubject))
    return { ok: false, reason: 'head commit subject contains [skip ci]' };
  if (run.status !== 'completed') {
    return { ok: false, reason: `run ${run.id} is not completed (status=${run.status})` };
  }
  if (run.conclusion !== 'success') {
    const label = run.conclusion === null ? 'null' : run.conclusion;
    return { ok: false, reason: `run ${run.id} concluded ${label}` };
  }
  if (shaPrefix !== undefined) {
    if (!shaPrefix || !/^[\da-f]+$/i.test(shaPrefix)) {
      return { ok: false, reason: 'invalid sha prefix' };
    }
    const prefix = shaPrefix.toLowerCase();
    if (!run.head_sha.toLowerCase().startsWith(prefix)) {
      return { ok: false, reason: `run ${run.id} head_sha does not start with ${prefix}` };
    }
  }
  if (
    run.run_attempt > 1 &&
    !gateText.split('\n').some((line) => parseRerunApprovalLine(line, run.id))
  ) {
    return {
      ok: false,
      reason:
        `run ${run.id} is attempt ${run.run_attempt}: manual reruns are not allowed unless the gate file has ` +
        `"rerun-approval: ${run.id} by Marek <YYYY-MM-DD>: \\"<quote>\\""`,
    };
  }
  return {
    ok: true,
    reason: `PASS run ${run.id} attempt ${run.run_attempt} ${run.conclusion} ${run.head_sha.slice(0, 7)}`,
  };
}

function exitError(message) {
  console.error(`ERROR ${message}`);
  process.exit(2);
}

export function fetchRunFromGh(repo, runId) {
  let stdout;
  try {
    stdout = execFileSync('gh', ['api', `repos/${repo}/actions/runs/${runId}`], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (error) {
    const stderr =
      error && typeof error === 'object' && 'stderr' in error && typeof error.stderr === 'string'
        ? error.stderr
        : '';
    const lines = stderr.trim().split('\n').filter(Boolean);
    throw new Error(lines.at(-1) ?? 'gh command failed');
  }
  try {
    return parseRunPayload(JSON.parse(stdout));
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new Error('GitHub run response was not valid JSON');
    }
    throw error;
  }
}

function fetchCommitMessage(repo, sha) {
  let stdout;
  try {
    stdout = execFileSync('gh', ['api', `repos/${repo}/commits/${sha}`], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (error) {
    const stderr = typeof error?.stderr === 'string' ? error.stderr : '';
    throw new Error(stderr.trim().split('\n').filter(Boolean).at(-1) ?? 'gh command failed');
  }
  let payload;
  try {
    payload = JSON.parse(stdout);
  } catch {
    throw new Error('GitHub commit response was not valid JSON');
  }
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new Error('GitHub commit payload must be a JSON object');
  }
  return commitSubject(payload.commit?.message);
}

function main() {
  let values;
  try {
    ({ values } = parseArgs({
      options: {
        repo: { type: 'string' },
        run: { type: 'string' },
        gate: { type: 'string' },
        sha: { type: 'string' },
      },
      strict: true,
    }));
  } catch (error) {
    exitError(error instanceof Error ? error.message : 'invalid arguments');
  }

  const runId = values.run ? parsePositiveRunIdText(values.run) : null;
  if (!values.repo || runId === null) exitError(USAGE);

  let gateText = '';
  if (values.gate) {
    try {
      gateText = readFileSync(values.gate, 'utf8');
    } catch {
      exitError(`could not read gate file: ${values.gate}`);
    }
  }

  if (values.sha !== undefined && (values.sha.length < 7 || !/^[\da-f]+$/i.test(values.sha))) {
    exitError('sha prefix must be at least 7 hexadecimal characters');
  }

  let run;
  try {
    run = fetchRunFromGh(values.repo, runId);
  } catch (error) {
    exitError(error instanceof Error ? error.message : 'failed to load GitHub run');
  }

  let headSubject;
  try {
    headSubject = fetchCommitMessage(values.repo, run.head_sha);
  } catch (error) {
    exitError(error instanceof Error ? error.message : 'failed to load head commit');
  }

  const result = evaluateRun({
    run,
    gateText,
    headSubject,
    ...(values.sha !== undefined ? { shaPrefix: values.sha } : {}),
  });
  if (!result.ok) {
    console.error(`FAIL ${result.reason}`);
    process.exit(1);
  }
  console.log(result.reason);
  process.exit(0);
}

function shouldRunMain() {
  if (!process.argv[1]) return true;
  try {
    return realpathSync(fileURLToPath(import.meta.url)) === realpathSync(resolve(process.argv[1]));
  } catch {
    return true;
  }
}

if (shouldRunMain()) main();
