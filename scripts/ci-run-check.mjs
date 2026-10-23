import { execFileSync } from 'node:child_process';
import { readFileSync, realpathSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';

export function parsePositiveRunIdText(text) {
  if (typeof text !== 'string' || !/^\d+$/.test(text)) {
    return null;
  }
  const value = Number(text);
  if (!Number.isSafeInteger(value) || value <= 0 || String(value) !== text) {
    return null;
  }
  return value;
}

export function parseRunPayload(payload) {
  if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new Error('GitHub run payload must be a JSON object');
  }
  const record = payload;
  const id = record.id;
  if (typeof id !== 'number' || !Number.isInteger(id) || id <= 0) {
    throw new Error('GitHub run payload missing or invalid id');
  }
  const runAttempt = record.run_attempt;
  if (typeof runAttempt !== 'number' || !Number.isInteger(runAttempt) || runAttempt < 1) {
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

export function parseRerunApprovalLine(line, expectedRunId) {
  const prefix = 'rerun-approval: ';
  if (!line.startsWith(prefix)) {
    return false;
  }
  const afterPrefix = line.slice(prefix.length);
  const spaceIndex = afterPrefix.indexOf(' ');
  if (spaceIndex <= 0) {
    return false;
  }
  const idText = afterPrefix.slice(0, spaceIndex);
  const runId = parsePositiveRunIdText(idText);
  if (runId === null || runId !== expectedRunId) {
    return false;
  }
  const remainder = afterPrefix.slice(spaceIndex);
  const approvalMatch = remainder.match(/^ by Marek (\d{4}-\d{2}-\d{2}): "(.+)"$/);
  if (!approvalMatch || approvalMatch[2].length === 0) {
    return false;
  }
  return true;
}

function hasRerunApproval(gateText, runId) {
  return gateText.split('\n').some((line) => parseRerunApprovalLine(line, runId));
}

function formatConclusion(conclusion) {
  return conclusion === null ? 'null' : conclusion;
}

export function evaluateRun({ run, gateText = '', shaPrefix }) {
  if (run.status !== 'completed') {
    return {
      ok: false,
      reason: `run ${run.id} is not completed (status=${run.status})`,
    };
  }

  if (run.conclusion !== 'success') {
    return {
      ok: false,
      reason: `run ${run.id} concluded ${formatConclusion(run.conclusion)}`,
    };
  }

  if (shaPrefix !== undefined) {
    if (!run.head_sha.startsWith(shaPrefix)) {
      return {
        ok: false,
        reason: `run ${run.id} head_sha does not start with ${shaPrefix}`,
      };
    }
  }

  if (run.run_attempt > 1 && !hasRerunApproval(gateText, run.id)) {
    return {
      ok: false,
      reason:
        `run ${run.id} is attempt ${run.run_attempt}: manual reruns are not allowed unless the gate file has ` +
        `"rerun-approval: ${run.id} by Marek <YYYY-MM-DD>: \\"<quote>\\""`,
    };
  }

  const sha7 = run.head_sha.slice(0, 7);
  return {
    ok: true,
    reason: `PASS run ${run.id} attempt ${run.run_attempt} ${run.conclusion} ${sha7}`,
  };
}

function usageMessage() {
  return 'Usage: node scripts/ci-run-check.mjs --repo <owner/name> --run <run-id> [--gate <gate-file-path>] [--sha <prefix>]';
}

function exitError(message) {
  console.error(`ERROR ${message}`);
  process.exit(2);
}

function lastLine(text) {
  const lines = text.trim().split('\n').filter(Boolean);
  return lines.length > 0 ? lines[lines.length - 1] : 'gh command failed';
}

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
    throw new Error(lastLine(stderr));
  }
  let raw;
  try {
    raw = JSON.parse(stdout);
  } catch {
    throw new Error('GitHub run response was not valid JSON');
  }
  return parseRunPayload({
    id: raw.id,
    run_attempt: raw.run_attempt,
    status: raw.status,
    conclusion: raw.conclusion,
    head_sha: raw.head_sha,
  });
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

  if (!values.repo || !values.run) {
    exitError(usageMessage());
  }

  const runId = parsePositiveRunIdText(values.run);
  if (runId === null) {
    exitError(usageMessage());
  }

  let gateText = '';
  if (values.gate) {
    try {
      gateText = readFileSync(values.gate, 'utf8');
    } catch {
      exitError(`could not read gate file: ${values.gate}`);
    }
  }

  if (values.sha !== undefined && values.sha.length < 7) {
    exitError('sha prefix must be at least 7 characters');
  }

  let run;
  try {
    run = fetchRunFromGh(values.repo, runId);
  } catch (error) {
    exitError(error instanceof Error ? error.message : 'failed to load GitHub run');
  }

  const result = evaluateRun({
    run,
    gateText,
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
  if (!process.argv[1]) {
    return true;
  }
  try {
    const scriptPath = realpathSync(fileURLToPath(import.meta.url));
    const argvPath = realpathSync(resolve(process.argv[1]));
    return scriptPath === argvPath;
  } catch {
    return true;
  }
}

if (shouldRunMain()) {
  main();
}
