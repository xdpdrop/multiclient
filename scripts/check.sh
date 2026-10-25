#!/usr/bin/env bash
set -uo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

LOG_DIR="$(mktemp -d)"
trap 'rm -rf "$LOG_DIR"' EXIT

run_step() {
  local step="$1"
  shift
  local log="$LOG_DIR/${step}.log"
  if "$@" >"$log" 2>&1; then
    echo "PASS ${step}"
    return 0
  fi
  echo "FAIL ${step}"
  tail -n 40 "$log"
  exit 1
}

models_line() {
  bash scripts/models-line.sh AGENTS.md
}

run_step models-line models_line
run_step models-line-test bash scripts/models-line.test.sh
run_step typecheck npm run typecheck
run_step lint npm run lint
run_step test npm test
run_step build npm run build

echo "ALL CHECKS PASSED"
exit 0
