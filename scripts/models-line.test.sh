#!/usr/bin/env bash
set -uo pipefail

cd "$(dirname "$0")/.." || exit 1
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

fail() { echo "FAIL: $1"; exit 1; }

grep -Fx "run_step models-line models_line" scripts/check.sh >/dev/null || fail "scripts/check.sh does not run the models-line step"
grep -F "scripts/models-line.sh" scripts/check.sh >/dev/null || fail "scripts/check.sh models_line does not call scripts/models-line.sh"
bash scripts/models-line.sh AGENTS.md >/dev/null || fail "AGENTS.md is rejected"

phrases=("Grok only" "one try per rung" "Marek's explicit approval")
[ "${#phrases[@]}" -gt 0 ] || fail "no phrases to test"
content="$(cat AGENTS.md)"
for phrase in "${phrases[@]}"; do
  printf '%s\n' "${content//"$phrase"/removed}" >"$tmp/AGENTS.md"
  if bash scripts/models-line.sh "$tmp/AGENTS.md" >/dev/null; then
    fail "models-line.sh accepts AGENTS.md without \"$phrase\""
  fi
done
printf '%s\n' "${content//"Marek's explicit approval"/explicitly approved}" >"$tmp/AGENTS.md"
if bash scripts/models-line.sh "$tmp/AGENTS.md" >/dev/null; then
  fail "models-line.sh accepts \"explicitly approved\""
fi
echo "models-line tests passed"
