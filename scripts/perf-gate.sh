#!/usr/bin/env bash
# 前端渲染预算门禁：先在真实浏览器里计量，再与基线比较。
#
# 为什么是两步而不是一条命令：`pnpm test:perf` 只负责落盘原始数据，
# `pnpm perf:check` 只负责判定。分开之后，"这次红灯到底是代码变了还是
# 机器热了"可以靠重放同一份原始数据复查——重新跑一遍浏览器是做不到的。
# 这与 bench-audit.sh / bench-collect.mjs 的分工一致。
#
# 为什么单独一个脚本：check-all.sh 的检查计划是"一条计划 = 一个命令"，
# 而门禁天然是两段。硬塞成 `bash -c` 会让日志里的复现命令变成一坨转义。
#
# 用法:
#   bash scripts/perf-gate.sh            # 计量 + 判定
#   bash scripts/perf-gate.sh --baseline # 计量 + 覆盖基线 (确认改动是有意的)
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

BASELINE=false
if [ "${1:-}" = "--baseline" ]; then
  BASELINE=true
fi

# playwright 的 webServer 会拉起前后端；这里显式提示一次，免得长时间无输出
# 让人以为卡死。
echo "前端渲染预算：启动浏览器计量（串行，首次可能较慢）…"
pnpm test:perf

if [ "$BASELINE" = true ]; then
  echo "前端渲染预算：用本次结果覆盖基线…"
  pnpm perf:baseline
  exit 0
fi

pnpm perf:check