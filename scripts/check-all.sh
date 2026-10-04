#!/usr/bin/env bash
#
# check-all.sh — 一键格式化 + 全量质量门禁 (行为对齐 .github/workflows/build.yml 的 quality job)
#
# 阶段:
#   1. 格式化 (默认开启): cargo fmt / eslint --fix / 重新生成前端合同 —— 写入修复
#   2. 检查: 依次跑架构、前端、Rust 全部门禁, 失败不中断, 全部跑完再汇总
#   3. 汇总: 通过/失败清单 + 每项复现命令 + 失败日志末尾片段与完整日志路径
#
# 用法:
#   pnpm check:all                # 全量: 含 build:web / e2e / cargo deny
#   pnpm check:all -- --quick     # 快速: 跳过 build:web / e2e / cargo deny
#   pnpm check:all -- --no-fix    # 只读: 跳过格式化写入, 仅检查
#   pnpm check:all -- --list      # 只列出计划执行的检查项, 不运行
#   pnpm check:all -- -h          # 帮助
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
    --)         shift ;;  # pnpm run 会把参数分隔符 `--` 一并透传, 直接忽略
    *) echo "未知参数: $1" >&2; echo; usage; exit 1 ;;
  esac
done

# ── 颜色 (尊重 NO_COLOR 与非 TTY) ────────────────────────────
if [ -t 1 ] && [ -z "${NO_COLOR:-}" ]; then
  C_RED=$'\033[31m'; C_GREEN=$'\033[32m'; C_YELLOW=$'\033[33m'
  C_BLUE=$'\033[34m'; C_DIM=$'\033[2m'; C_BOLD=$'\033[1m'; C_RESET=$'\033[0m'
else
  C_RED=''; C_GREEN=''; C_YELLOW=''; C_BLUE=''; C_DIM=''; C_BOLD=''; C_RESET=''
fi

LOG_DIR="$REPO_ROOT/output/check-all"
rm -rf "$LOG_DIR"
mkdir -p "$LOG_DIR"

# ── 检查计划: "group|label|dir|command" ──────────────────────
PLAN=()
add_plan() { PLAN+=("$1|$2|$3|$4"); }

build_plan() {
  PLAN=()
  if [ "$FIX" = true ]; then
    add_plan "格式化" "cargo fmt (写入)"          "tauri" "cargo fmt"
    add_plan "格式化" "eslint --fix (写入)"       "root"  "pnpm lint:fix"
    add_plan "格式化" "生成前端合同 (写入)"        "root"  "pnpm generate:contracts"
  fi
  # 架构与契约门禁
  add_plan "架构" "crate 架构清单"                 "root" "pnpm architecture"
  add_plan "架构" "架构门禁 (领域/层级/适配器)"     "root" "pnpm check:architecture"
  add_plan "架构" "第三方依赖版本统一"             "root" "pnpm check:deps"
  add_plan "架构" "命令出口契约"                   "root" "pnpm check:web-contract"
  add_plan "架构" "Rust↔TS 合同一致"               "root" "pnpm check:contracts"
  add_plan "架构" "模型目录"                       "root" "pnpm check:model-catalog"
  add_plan "架构" "UI 颜色令牌"                    "root" "pnpm check:tokens"
  add_plan "架构" "文档与许可证"                   "root" "pnpm check:docs"
  # 前端
  add_plan "前端" "TypeScript 类型"                "root" "pnpm typecheck"
  add_plan "前端" "ESLint (零警告)"                "root" "pnpm lint:ci"
  add_plan "前端" "Vitest 单测"                    "root" "pnpm test"
  # Rust
  add_plan "Rust" "cargo fmt --check"              "tauri" "cargo fmt --check"
  add_plan "Rust" "cargo clippy --all-targets"     "tauri" "cargo clippy --workspace --all-targets"
  add_plan "Rust" "cargo test --workspace"         "tauri" "cargo test --workspace"
  # 慢项 (仅全量)
  if [ "$MODE_FULL" = true ]; then
    add_plan "前端·慢" "Web 生产构建"              "root"  "pnpm build:web"
    add_plan "前端·慢" "Playwright E2E"            "root"  "pnpm test:e2e"
    add_plan "Rust·慢" "cargo deny"                "tauri" "cargo deny check"
  fi
}

build_plan

if [ "$LIST_ONLY" = true ]; then
  mode=$([ "$MODE_FULL" = true ] && echo "全量" || echo "快速")
  fixstate=$([ "$FIX" = true ] && echo "含格式化" || echo "只读")
  echo "check:all 计划 (模式: $mode, $fixstate):"
  for entry in "${PLAN[@]}"; do
    IFS='|' read -r g l d c <<< "$entry"
    printf '  %s[%-8s]%s %-32s (%s)  $ %s\n' "$C_BLUE" "$g" "$C_RESET" "$l" "$d" "$c"
  done
  exit 0
fi

# ── 执行与记录 ───────────────────────────────────────────────
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
    printf '  %s✓ 通过%s (%ss)\n' "$C_GREEN" "$C_RESET" "$elapsed"
  else
    printf '  %s✗ 失败%s (exit %s, %ss) → %s\n' "$C_RED" "$C_RESET" "$code" "$elapsed" "$log"
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

# 合同重新生成的安全包装: generate-contracts.mjs 会先 rmSync 输出目录再编译导出,
# 若 Rust 编译失败会清空已提交的 src/types/generated。这里先生成到临时目录,
# 仅在成功时才替换工作区文件; 失败则保持原目录不变 (generate-contracts.mjs 支持
# LISSIO_CONTRACTS_OUT 覆盖输出目录)。
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
    echo "generate:contracts 失败: src/types/generated 保持不变 (未替换)"
  fi
  rm -rf "$tmp"
  return "$code"
}

mode=$([ "$MODE_FULL" = true ] && echo "全量" || echo "快速")
fixstate=$([ "$FIX" = true ] && echo "开启" || echo "关闭")
echo "${C_BOLD}=== check:all ===${C_RESET}"
echo "模式: $mode   格式化: $fixstate   日志目录: $LOG_DIR"
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

# ── 格式化改动提示 ───────────────────────────────────────────
if [ "$FIX" = true ]; then
  changed="$(git -C "$REPO_ROOT" status --short -- src src-tauri | wc -l | tr -d ' ')"
  if [ "$changed" -gt 0 ]; then
    echo ""
    echo "${C_YELLOW}格式化阶段改动了 $changed 个文件 (含生成物):${C_RESET}"
    git -C "$REPO_ROOT" status --short -- src src-tauri | head -n 40 | sed 's/^/  /'
  fi
fi

# ── 汇总 ─────────────────────────────────────────────────────
pass=0; fail=0; total_time=0
for i in "${!CHECK_LABELS[@]}"; do
  total_time=$((total_time + CHECK_DURATIONS[i]))
  if [ "${CHECK_STATUS[i]}" -eq 0 ]; then pass=$((pass + 1)); else fail=$((fail + 1)); fi
done

echo ""
echo "${C_BOLD}================ check:all 汇总 ================${C_RESET}"
printf '模式: %s%s%s   通过: %s%d%s   失败: %s%d%s   总耗时: %ss\n' \
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

# ── 失败详情 ─────────────────────────────────────────────────
if [ "$fail" -gt 0 ]; then
  echo ""
  echo "${C_BOLD}---------------- 失败详情 (每项末尾 40 行) ----------------${C_RESET}"
  for i in "${!CHECK_LABELS[@]}"; do
    [ "${CHECK_STATUS[i]}" -eq 0 ] && continue
    echo ""
    echo "${C_RED}✗ [${CHECK_GROUPS[i]}] ${CHECK_LABELS[i]}${C_RESET}  (exit ${CHECK_STATUS[i]})"
    echo "  复现: (cd ${CHECK_DIRS[i]} && ${CHECK_CMDS[i]})"
    echo "  日志: ${CHECK_LOGS[i]}"
    echo "  ${C_DIM}----------------------------------------${C_RESET}"
    tail -n 40 "${CHECK_LOGS[i]}" | sed 's/^/  /'
  done

  # 环境类失败的针对性提示
  hints=()
  for i in "${!CHECK_LABELS[@]}"; do
    [ "${CHECK_STATUS[i]}" -eq 0 ] && continue
    case "${CHECK_LABELS[i]}" in
      *"Playwright E2E"*) hints+=("E2E 需要浏览器: pnpm exec playwright install --with-deps chromium") ;;
      *"cargo deny"*)     hints+=("cargo deny 未安装: cargo install cargo-deny --version 0.20.2") ;;
    esac
  done
  if [ "${#hints[@]}" -gt 0 ]; then
    echo ""
    echo "${C_YELLOW}环境提示:${C_RESET}"
    printf '  - %s\n' "${hints[@]}"
  fi
fi

echo ""
if [ "$fail" -gt 0 ]; then
  echo "${C_RED}${C_BOLD}check:all 失败: $fail 项未通过${C_RESET}  (日志: $LOG_DIR)"
  exit 1
fi
echo "${C_GREEN}${C_BOLD}check:all 全部通过 ($pass 项)${C_RESET}  (日志: $LOG_DIR)"
