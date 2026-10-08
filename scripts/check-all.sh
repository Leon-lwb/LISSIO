#!/usr/bin/env bash
#
# check-all.sh — one-shot formatting + full quality gate
#
# Checks come from the single source of truth scripts/gates.mjs (no hand-written list
# here, to avoid drift):
#   1. formatting (on by default): cargo fmt / eslint --fix / regenerate frontend
#      contracts — writes fixes
#   2. checks: run every gate registered in gates.mjs in order; a failure does not stop
#      the run, and everything is summarized at the end
#   3. summary: pass/fail list + a reproduction command per item + the tail of the
#      failure log and the full log path
#
# Usage:
#   pnpm check:all                # full: full tier (includes build:web / e2e / perf / cargo deny)
#   pnpm check:all -- --quick     # quick: pr tier (CI merge gates)
#   pnpm check:all -- --no-fix    # read-only: skip formatting writes, only check
#   pnpm check:all -- --list      # only list the planned checks, do not run them
#   pnpm check:all -- -h          # help
#
# Query the gate list itself: pnpm gates --list [--set pr|full]
set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

MODE_FULL=true
FIX=true
LIST_ONLY=false

usage() {
  awk 'NR==1 {next} /^#/ {sub(/^# ?/, ""); print; next} {exit}' "${BASH_SOURCE[0]}"
}

while [ $# -gt 0 ]; do
  case "$1" in
    -q|--quick) MODE_FULL=false; shift ;;
    --full)     MODE_FULL=true; shift ;;
    --no-fix)   FIX=false; shift ;;
    --fix)      FIX=true; shift ;;
    --list)     LIST_ONLY=true; shift ;;
    -h|--help)  usage; exit 0 ;;
    --)         shift ;;  # pnpm run forwards the argument separator `--` too; ignore it
    *) echo "unknown argument: $1" >&2; echo; usage; exit 1 ;;
  esac
done

# ── Colors (honor NO_COLOR and non-TTY) ────────────────────────────
if [ -t 1 ] && [ -z "${NO_COLOR:-}" ]; then
  C_RED=$'\033[31m'; C_GREEN=$'\033[32m'; C_YELLOW=$'\033[33m'
  C_BLUE=$'\033[34m'; C_DIM=$'\033[2m'; C_BOLD=$'\033[1m'; C_RESET=$'\033[0m'
else
  C_RED=''; C_GREEN=''; C_YELLOW=''; C_BLUE=''; C_DIM=''; C_BOLD=''; C_RESET=''
fi

LOG_DIR="$REPO_ROOT/output/check-all"
rm -rf "$LOG_DIR"
mkdir -p "$LOG_DIR"

# ── Check plan: "group|label|dir|command" ──────────────────────
PLAN=()
add_plan() { PLAN+=("$1|$2|$3|$4"); }

build_plan() {
  PLAN=()
  # The formatting phase is a local-only "write" step, not a CI gate, so it does not go into gates.mjs.
  if [ "$FIX" = true ]; then
    add_plan "Formatting" "cargo fmt (write)"          "tauri" "cargo fmt"
    add_plan "Formatting" "eslint --fix (write)"       "root"  "pnpm lint:fix"
    add_plan "Formatting" "generate frontend contracts (write)" "root" "pnpm generate:contracts"
  fi
  # Checks all come from the single source of truth scripts/gates.mjs — no hand-written
  # list here, or there would be a fifth gate list free to drift. --quick is the PR tier,
  # full is the full tier.
  local tier="full"
  [ "$MODE_FULL" = false ] && tier="pr"
  local line
  while IFS= read -r line; do
    [ -n "$line" ] && PLAN+=("$line")
  done < <(node "$REPO_ROOT/scripts/gates.mjs" --plan --set "$tier")
}

build_plan

if [ "$LIST_ONLY" = true ]; then
  mode=$([ "$MODE_FULL" = true ] && echo "full" || echo "quick")
  fixstate=$([ "$FIX" = true ] && echo "with formatting" || echo "read-only")
  echo "check:all plan (mode: $mode, $fixstate):"
  for entry in "${PLAN[@]}"; do
    IFS='|' read -r g l d c <<< "$entry"
    printf '  %s[%-8s]%s %-32s (%s)  $ %s\n' "$C_BLUE" "$g" "$C_RESET" "$l" "$d" "$c"
  done
  exit 0
fi

# ── Execute and record ───────────────────────────────────────────────
CHECK_LABELS=(); CHECK_GROUPS=(); CHECK_DIRS=(); CHECK_LOGS=()
CHECK_CMDS=(); CHECK_STATUS=(); CHECK_DURATIONS=()

slugify() { printf '%s' "$1" | tr -c '[:alnum:]' '-' | sed -e 's/-\+/-/g' -e 's/^-//' -e 's/-$//'; }

_exec_check() {
  local group="$1" label="$2" dir="$3"; shift 3
  local idx=${#CHECK_LABELS[@]}
  local log="$LOG_DIR/$(printf '%02d' "$idx")-$(slugify "$label").log"
  CHECK_LABELS+=("$label")
  CHECK_GROUPS+=("$group")
  CHECK_DIRS+=("$dir")
  CHECK_LOGS+=("$log")
  CHECK_CMDS+=("$*")

  printf '%s▶ [%s] %s%s\n' "$C_DIM" "$group" "$label" "$C_RESET"
  local start=$SECONDS
  ( cd "$dir" && "$@" ) >"$log" 2>&1
  local code=$?
  local elapsed=$((SECONDS - start))
  CHECK_STATUS+=("$code")
  CHECK_DURATIONS+=("$elapsed")

  if [ "$code" -eq 0 ]; then
    printf '  %s✓ passed%s (%ss)\n' "$C_GREEN" "$C_RESET" "$elapsed"
  else
    printf '  %s✗ failed%s (exit %s, %ss) → %s\n' "$C_RED" "$C_RESET" "$code" "$elapsed" "$log"
  fi
  return 0
}

check() {
  local g="$1" l="$2"; shift 2
  _exec_check "$g" "$l" "$REPO_ROOT" "$@"
}
check_tauri() {
  local g="$1" l="$2"; shift 2
  _exec_check "$g" "$l" "$REPO_ROOT/src-tauri" "$@"
}

# Safe wrapper around contract regeneration: generate-contracts.mjs first rmSync's the
# output directory and then compiles the export, so a Rust compile failure would wipe the
# committed src/types/generated. Generate into a temporary directory first and replace the
# workspace files only on success; on failure leave the original directory untouched
# (generate-contracts.mjs supports LISSIO_CONTRACTS_OUT to override the output directory).
guarded_generate_contracts() {
  local out="$REPO_ROOT/src/types/generated"
  local tmp code
  tmp="$(mktemp -d)"
  LISSIO_CONTRACTS_OUT="$tmp" pnpm generate:contracts
  code=$?
  if [ "$code" -eq 0 ]; then
    rm -rf "$out"
    mkdir -p "$out"
    cp -R "$tmp/." "$out/"
  else
    echo "generate:contracts failed: src/types/generated left unchanged (not replaced)"
  fi
  rm -rf "$tmp"
  return "$code"
}

mode=$([ "$MODE_FULL" = true ] && echo "full" || echo "quick")
fixstate=$([ "$FIX" = true ] && echo "on" || echo "off")
echo "${C_BOLD}=== check:all ===${C_RESET}"
echo "mode: $mode   formatting: $fixstate   log directory: $LOG_DIR"
echo ""

for entry in "${PLAN[@]}"; do
  IFS='|' read -r g l d c <<< "$entry"
  if [ "$c" = "pnpm generate:contracts" ]; then
    check "$g" "$l" guarded_generate_contracts
  elif [ "$d" = "tauri" ]; then
    # shellcheck disable=SC2086
    check_tauri "$g" "$l" $c
  else
    # shellcheck disable=SC2086
    check "$g" "$l" $c
  fi
done

# ── Formatting-change notice ───────────────────────────────────────────
if [ "$FIX" = true ]; then
  changed="$(git -C "$REPO_ROOT" status --short -- src src-tauri | wc -l | tr -d ' ')"
  if [ "$changed" -gt 0 ]; then
    echo ""
    echo "${C_YELLOW}the formatting phase changed $changed files (including generated output):${C_RESET}"
    git -C "$REPO_ROOT" status --short -- src src-tauri | head -n 40 | sed 's/^/  /'
  fi
fi

# ── Summary ─────────────────────────────────────────────────────
pass=0; fail=0; total_time=0
for i in "${!CHECK_LABELS[@]}"; do
  total_time=$((total_time + CHECK_DURATIONS[i]))
  if [ "${CHECK_STATUS[i]}" -eq 0 ]; then pass=$((pass + 1)); else fail=$((fail + 1)); fi
done

echo ""
echo "${C_BOLD}================ check:all summary ================${C_RESET}"
printf 'mode: %s%s%s   passed: %s%d%s   failed: %s%d%s   total time: %ss\n' \
  "$C_BLUE" "$mode" "$C_RESET" \
  "$C_GREEN" "$pass" "$C_RESET" \
  "$C_RED" "$fail" "$C_RESET" "$total_time"
echo "------------------------------------------------"
for i in "${!CHECK_LABELS[@]}"; do
  if [ "${CHECK_STATUS[i]}" -eq 0 ]; then
    printf '  %s✓%s [%s] %s (%ss)\n' \
      "$C_GREEN" "$C_RESET" "${CHECK_GROUPS[i]}" "${CHECK_LABELS[i]}" "${CHECK_DURATIONS[i]}"
  else
    printf '  %s✗%s [%s] %s (exit %s, %ss)\n' \
      "$C_RED" "$C_RESET" "${CHECK_GROUPS[i]}" "${CHECK_LABELS[i]}" "${CHECK_STATUS[i]}" "${CHECK_DURATIONS[i]}"
  fi
done

# ── Failure details ─────────────────────────────────────────────────
if [ "$fail" -gt 0 ]; then
  echo ""
  echo "${C_BOLD}---------------- failure details (last 40 lines of each) ----------------${C_RESET}"
  for i in "${!CHECK_LABELS[@]}"; do
    [ "${CHECK_STATUS[i]}" -eq 0 ] && continue
    echo ""
    echo "${C_RED}✗ [${CHECK_GROUPS[i]}] ${CHECK_LABELS[i]}${C_RESET}  (exit ${CHECK_STATUS[i]})"
    echo "  reproduce: (cd ${CHECK_DIRS[i]} && ${CHECK_CMDS[i]})"
    echo "  log: ${CHECK_LOGS[i]}"
    echo "  ${C_DIM}----------------------------------------${C_RESET}"
    tail -n 40 "${CHECK_LOGS[i]}" | sed 's/^/  /'
  done

  # Targeted hints for environment-related failures
  hints=()
  for i in "${!CHECK_LABELS[@]}"; do
    [ "${CHECK_STATUS[i]}" -eq 0 ] && continue
    case "${CHECK_LABELS[i]}" in
      *"Playwright E2E"*) hints+=("E2E needs a browser: pnpm exec playwright install --with-deps chromium") ;;
      *"cargo deny"*)     hints+=("cargo deny is not installed: cargo install cargo-deny --version 0.20.2") ;;
    esac
  done
  if [ "${#hints[@]}" -gt 0 ]; then
    echo ""
    echo "${C_YELLOW}environment hints:${C_RESET}"
    printf '  - %s\n' "${hints[@]}"
  fi
fi

echo ""
if [ "$fail" -gt 0 ]; then
  echo "${C_RED}${C_BOLD}check:all failed: $fail items did not pass${C_RESET}  (log: $LOG_DIR)"
  exit 1
fi
echo "${C_GREEN}${C_BOLD}check:all passed ($pass items)${C_RESET}  (log: $LOG_DIR)"
