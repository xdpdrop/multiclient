#!/usr/bin/env bash
set -uo pipefail

file="${1:-AGENTS.md}"
grep -F "Grok only" "$file" | grep -F "one try per rung" | grep -F "Marek's explicit approval" >/dev/null \
  || { echo "$file needs one Models line containing: Grok only, one try per rung, Marek's explicit approval"; exit 1; }
