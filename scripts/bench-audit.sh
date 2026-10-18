#!/usr/bin/env bash
# Performance audit: run sequentially so benchmarks do not compete for CPU; raw results are
# kept inside the ignored target directory.
#
# Why sequential: these benchmarks measure single-core/multi-core throughput, and concurrent
# runs would make the medians meaningless.
# Why bench-collect.mjs is called at the end: the numbers in the paper and docs/experiments
# must come from the same raw artifacts; copying them by hand is both error-prone and
# irreproducible.
#
# Usage: bash scripts/bench-audit.sh [quick|full]
#   quick — covers all Criterion benchmarks + a 60s soak, for routine regression
#   full  — 300s soak, full recording-to-disk capture, and the Modbus load sweep, for pre-release evidence
set -euo pipefail
# Pin audit symbol overhead without changing the default benchmark/profiling profiles.
export CARGO_PROFILE_BENCH_DEBUG=0
export VOFA_SOAK_EVAL_STALL_MS=0 VOFA_SOAK_INGEST_STALL_MS=0
audit_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
audit_mode="${1:-quick}"
case "$audit_mode" in
  quick) audit_seconds=60; audit_storage_bytes=16777216 ;;
  full) audit_seconds=300; audit_storage_bytes=67108864 ;;
  *) echo 'usage: bash scripts/bench-audit.sh [quick|full]' >&2; exit 2 ;;
esac
audit_out="$audit_root/server/target/bench-audit/$(date +%Y%m%d-%H%M%S)"
mkdir -p "$audit_out"
echo "benchmark output: $audit_out"
# Collect the remaining independent scenarios even if one fails, then report failure at the end
# so results such as the frontend audit are not lost.
audit_failures=0
audit_logs=()
audit_run() {
  local audit_log="$1"
  shift
  audit_logs+=("$audit_out/$audit_log.log")
  if "$@" 2>&1 | tee "$audit_out/$audit_log.log"; then
    return 0
  fi
  # Must be PIPESTATUS[0]: the pipeline exit code comes from tee, so a bare `$?` is always 0 —
  # which is exactly why the old script treated a compile failure as a pass.
  local audit_status=${PIPESTATUS[0]}
  audit_failures=$((audit_failures + 1))
  echo "scenario failed: $audit_log (exit $audit_status)" >&2
  # Always return 0: the call site is a plain command under `set -e`, and a non-zero return
  # would abort the whole audit and cost the remaining independent scenarios their run.
  # Failures are reported together at the end via audit_failures.
  return 0
}
cd "$audit_root/server"

# Package and bench names follow `cargo metadata`; after a crate rename this must be updated,
# or cargo fails outright with "package ID specification did not match".
# The key is the package name and the value is the bench target to run in that package.
audit_benches=(
  'lissio-pipeline ingest_bench'
  'lissio-pipeline eval_bench'
  'lissio-waveform waveform_pyramid_bench'
  'lissio-recording storage'
  'lissio-app waveform_wire'
  'lissio-gpu envelope_bench'
  'lissio-graph compile_bench'
  'lissio-eval eval_run_bench'
  'lissio-trigger trigger_bench'
  'lissio-frame-decoder frame_decoder_bench'
  'lissio-graph-ops graph_ops_bench'
  'lissio-modbus-adapter modbus_adapter'
)

audit_packages=""
for audit_spec in "${audit_benches[@]}"; do
  read -r audit_package _ <<< "$audit_spec"
  case " $audit_packages " in
    *" $audit_package "*) ;;
    *) audit_packages="$audit_packages $audit_package" ;;
  esac
done
audit_build_args=()
for audit_package in $audit_packages; do
  audit_build_args+=(-p "$audit_package")
done
# On a build failure every later scenario would fail the same way, which is far more noise than
# signal, so stop immediately.
audit_logs+=("$audit_out/build.log")
set +e
cargo bench "${audit_build_args[@]}" --no-run 2>&1 | tee "$audit_out/build.log"
audit_build_status=${PIPESTATUS[0]}
set -e
if (( audit_build_status != 0 )); then
  echo "benchmark target build failed (exit $audit_build_status), aborting audit" >&2
  exit 1
fi

# The previous Criterion results stay in target/criterion; without clearing them old and new
# cannot be told apart, and the collector counts deleted benchmark names into this run.
rm -rf target/criterion

for audit_spec in "${audit_benches[@]}"; do
  read -r audit_package audit_bench <<< "$audit_spec"
  case "$audit_spec" in
    # storage is a JSON artifact with a custom main and does not accept Criterion arguments.
    'lissio-recording storage')
      audit_run "$audit_bench" env VOFA_STORAGE_BENCH_BYTES="$audit_storage_bytes" \
        cargo bench -p "$audit_package" --bench "$audit_bench"
      ;;
    *)
      audit_run "$audit_bench" cargo bench -p "$audit_package" --bench "$audit_bench" -- --noplot
      ;;
  esac
done

# Soak: wall-clock-rate-limited ingest + async graph evaluation + 30 Hz query and subscription
# concurrency, asserting >10 MB/s and zero drops.
for audit_graph in raw math; do
  audit_run "soak-$audit_graph" env VOFA_SOAK_SECONDS="$audit_seconds" VOFA_SOAK_GRAPH="$audit_graph" VOFA_SOAK_GENERATOR=1 \
    cargo bench -p lissio-pipeline --bench pipeline_soak
done
audit_run soak-synthetic env VOFA_SOAK_SECONDS="$audit_seconds" VOFA_SOAK_GRAPH=math VOFA_SOAK_GENERATOR=0 \
  cargo bench -p lissio-pipeline --bench pipeline_soak
audit_run soak-stall-100ms env VOFA_SOAK_SECONDS=30 VOFA_SOAK_GRAPH=math VOFA_SOAK_GENERATOR=1 VOFA_SOAK_EVAL_STALL_MS=100 \
  cargo bench -p lissio-pipeline --bench pipeline_soak
audit_run soak-ingest-stall-500ms env VOFA_SOAK_SECONDS=30 VOFA_SOAK_GRAPH=math VOFA_SOAK_GENERATOR=1 VOFA_SOAK_INGEST_STALL_MS=500 \
  cargo bench -p lissio-pipeline --bench pipeline_soak

# Modbus acquisition load (in-process mock service + pure-CPU polling sweep). The sweep matrix
# has 36 scenarios and only runs in full mode; otherwise the quick regression would be too slow
# for anyone to run.
if [[ "$audit_mode" == 'full' ]]; then
  audit_run modbus-load env LISSIO_MODBUS_BENCH_SECONDS=2 \
    cargo bench -p lissio-modbus-adapter --bench modbus_load
fi

cd "$audit_root"
# The frontend benchmarks live with the frontend; vitest is installed there.
audit_run frontend pnpm --dir client exec vitest bench --run --outputJson "$audit_out/frontend.json"

# Normalize the artifacts: run this whether or not a scenario failed above, so partial results
# remain usable for diagnosis.
# Note the `${arr[@]+...}` form: bash 3.2 shipped with macOS raises "unbound variable" when
# expanding an empty array under `set -u`, so handle the empty array explicitly here.
audit_collect=(node scripts/bench-collect.mjs --label "$audit_mode")
for audit_log in ${audit_logs[@]+"${audit_logs[@]}"}; do
  audit_collect+=(--json-log "$audit_log")
done
"${audit_collect[@]}" || audit_failures=$((audit_failures + 1))

if (( audit_failures > 0 )); then
  echo "audit failed: $audit_failures scenarios failed; full results: $audit_out" >&2
  exit 1
fi
echo "measurement complete: ${audit_out} (soak checked >10 MB/s and zero drops; UI presentation still needs separate acceptance)"
