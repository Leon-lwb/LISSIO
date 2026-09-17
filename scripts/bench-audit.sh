#!/usr/bin/env bash
# 性能审计：顺序执行，避免不同基准互抢 CPU；原始结果保存在已忽略的 target 内。
#
# 为什么必须顺序执行：这些基准度量的是单核/多核吞吐，并发运行会让中位数失去意义。
# 为什么最后调用 bench-collect.mjs：论文与 docs/experiments 的数字必须来自同一份原始
# 产物，人工抄写既易错又无法复现。
#
# 用法: bash scripts/bench-audit.sh [quick|full]
#   quick — 覆盖全部 Criterion 基准 + 60s 长跑，用于日常回归
#   full  — 长跑 300s、录制全量落盘与 Modbus 负载扫描，用于发布前取证
set -euo pipefail
# 固定基准的符号开销；不覆盖用户的 Release 调试/火焰图配置。
export CARGO_PROFILE_BENCH_DEBUG=0
export VOFA_SOAK_EVAL_STALL_MS=0 VOFA_SOAK_INGEST_STALL_MS=0
audit_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
audit_mode="${1:-quick}"
case "$audit_mode" in
  quick) audit_seconds=60; audit_storage_bytes=16777216 ;;
  full) audit_seconds=300; audit_storage_bytes=67108864 ;;
  *) echo '用法: bash scripts/bench-audit.sh [quick|full]' >&2; exit 2 ;;
esac
audit_out="$audit_root/src-tauri/target/bench-audit/$(date +%Y%m%d-%H%M%S)"
mkdir -p "$audit_out"
echo "基准输出: $audit_out"
# 单项失败仍采集后续独立场景，最终统一返回失败，避免遗漏前端等审计结果。
audit_failures=0
audit_logs=()
audit_run() {
  local audit_log="$1"
  shift
  audit_logs+=("$audit_out/$audit_log.log")
  if "$@" 2>&1 | tee "$audit_out/$audit_log.log"; then
    return 0
  fi
  # 必须是 PIPESTATUS[0]：管道的退出码来自 tee，直接 `$?` 永远是 0，
  # 这正是旧版脚本会把编译失败当成通过的原因。
  local audit_status=${PIPESTATUS[0]}
  audit_failures=$((audit_failures + 1))
  echo "场景失败: $audit_log (exit $audit_status)" >&2
  # 始终返回 0：调用点在 `set -e` 下是普通命令，返回非零会直接终止整轮审计，
  # 让后续独立场景失去采集机会。失败通过 audit_failures 在末尾统一上报。
  return 0
}
cd "$audit_root/src-tauri"

# 包名与 bench 名以 `cargo metadata` 为准；crate 改名后此处必须同步，
# 否则 cargo 会以 "package ID specification did not match" 直接失败。
# 键是包名，值是该包下要跑的 bench 目标。
audit_benches=(
  'pipeline ingest_bench'
  'pipeline eval_bench'
  'waveform waveform_pyramid_bench'
  'recording storage'
  'app waveform_wire'
  'gpu envelope_bench'
  'buffer_graph node_graph_bench'
  'graph compile_bench'
  'eval eval_run_bench'
  'trigger trigger_bench'
  'frame-decoder frame_decoder_bench'
  'graph_ops graph_ops_bench'
  'modbus-adapter modbus_adapter'
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
# 编译失败时后续每个场景都会以同样的错误失败，噪声远大于信息量，因此直接终止。
audit_logs+=("$audit_out/build.log")
set +e
cargo bench "${audit_build_args[@]}" --no-run 2>&1 | tee "$audit_out/build.log"
audit_build_status=${PIPESTATUS[0]}
set -e
if (( audit_build_status != 0 )); then
  echo "基准目标编译失败 (exit $audit_build_status)，终止审计" >&2
  exit 1
fi

# 上一次的 Criterion 结果会留在 target/criterion 里；不清空就无法区分新旧，
# 采集器会把已删除的旧基准名一并算进本次结果。
rm -rf target/criterion

for audit_spec in "${audit_benches[@]}"; do
  read -r audit_package audit_bench <<< "$audit_spec"
  case "$audit_spec" in
    # storage 是自定义 main 的 JSON 产物，不接受 Criterion 参数。
    'recording storage')
      audit_run "$audit_bench" env VOFA_STORAGE_BENCH_BYTES="$audit_storage_bytes" \
        cargo bench -p "$audit_package" --bench "$audit_bench"
      ;;
    *)
      audit_run "$audit_bench" cargo bench -p "$audit_package" --bench "$audit_bench" -- --noplot
      ;;
  esac
done

# 长跑：墙钟限速摄入 + 异步图求值 + 30 Hz 查询与订阅并发，断言 >10 MB/s 与零丢弃。
for audit_graph in raw math; do
  audit_run "soak-$audit_graph" env VOFA_SOAK_SECONDS="$audit_seconds" VOFA_SOAK_GRAPH="$audit_graph" VOFA_SOAK_GENERATOR=1 \
    cargo bench -p pipeline --bench pipeline_soak
done
audit_run soak-synthetic env VOFA_SOAK_SECONDS="$audit_seconds" VOFA_SOAK_GRAPH=math VOFA_SOAK_GENERATOR=0 \
  cargo bench -p pipeline --bench pipeline_soak
audit_run soak-stall-100ms env VOFA_SOAK_SECONDS=30 VOFA_SOAK_GRAPH=math VOFA_SOAK_GENERATOR=1 VOFA_SOAK_EVAL_STALL_MS=100 \
  cargo bench -p pipeline --bench pipeline_soak
audit_run soak-ingest-stall-500ms env VOFA_SOAK_SECONDS=30 VOFA_SOAK_GRAPH=math VOFA_SOAK_GENERATOR=1 VOFA_SOAK_INGEST_STALL_MS=500 \
  cargo bench -p pipeline --bench pipeline_soak

# Modbus 采集负载（进程内模拟服务 + 纯 CPU 轮询扫描）。扫描矩阵有 36 个场景，
# 只在 full 模式跑，否则 quick 回归会慢到没人愿意执行。
if [[ "$audit_mode" == 'full' ]]; then
  audit_run modbus-load env LISSIO_MODBUS_BENCH_SECONDS=2 \
    cargo bench -p modbus-adapter --bench modbus_load
fi

cd "$audit_root"
audit_run frontend pnpm exec vitest bench --run --outputJson "$audit_out/frontend.json"

# 归一化产物：无论上面是否有场景失败都执行，保证部分结果也可用于诊断。
# 注意 `${arr[@]+...}` 的写法：macOS 自带 bash 3.2 在 `set -u` 下对空数组展开会报
# unbound variable，这里显式处理空数组。
audit_collect=(node scripts/bench-collect.mjs --label "$audit_mode")
for audit_log in ${audit_logs[@]+"${audit_logs[@]}"}; do
  audit_collect+=(--json-log "$audit_log")
done
"${audit_collect[@]}" || audit_failures=$((audit_failures + 1))

if (( audit_failures > 0 )); then
  echo "审计未通过: $audit_failures 个场景失败；完整结果: $audit_out" >&2
  exit 1
fi
echo "完成测量: ${audit_out}（长跑已检查 >10 MB/s 与零丢弃；界面呈现仍须独立验收）"
