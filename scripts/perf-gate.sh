#!/usr/bin/env bash
# Frontend render budget gate: measure in a real browser first, then compare against the baseline.
#
# Why two steps instead of one command: `pnpm test:perf` only writes the raw data to disk,
# `pnpm perf:check` only judges. Once split, "was this red light the code changing or the
# machine running hot" can be re-checked by replaying the same raw data — re-running the
# browser cannot do that. This matches the bench-audit.sh / bench-collect.mjs split.
#
# Why a separate script: check-all.sh's check plan is "one plan = one command", but this gate
# is inherently two stages. Cramming it into `bash -c` would turn the reproduce command in
# the log into a pile of escapes.
#
# Usage:
#   bash scripts/perf-gate.sh            # measure + judge
#   bash scripts/perf-gate.sh --baseline # measure + overwrite baseline (confirm the change is intentional)
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

BASELINE=false
if [ "${1:-}" = "--baseline" ]; then
  BASELINE=true
fi

# playwright's webServer starts the frontend and backend; print an explicit hint once here,
# so a long stretch with no output does not look like a hang.
echo "Frontend render budget: starting browser measurement (serial; the first run may be slow)…"
pnpm test:perf

if [ "$BASELINE" = true ]; then
  echo "Frontend render budget: overwriting the baseline with this run's results…"
  pnpm perf:baseline
  exit 0
fi

pnpm perf:check