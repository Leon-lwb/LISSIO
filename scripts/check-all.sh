#!/usr/bin/env bash
#
# check-all.sh — entry point for the tier commands declared in scripts/gates.mjs.
#
# The driver is scripts/check-all.mjs. It lives in Node because one implementation
# has to run on the Linux CI checkout and on Windows, where this shell is not
# guaranteed to exist — there `pnpm check:all` failed before a single gate ran.
# This file stays because TIER_COMMANDS in scripts/gates.mjs and the workflows
# invoke it byte for byte; it forwards every argument unchanged.
#
# Usage: node scripts/check-all.mjs --help
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
exec node "$SCRIPT_DIR/check-all.mjs" "$@"
