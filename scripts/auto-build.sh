#!/usr/bin/env bash
#
# auto-build.sh — 本地自动构建 (仅 macOS 宿主), 行为对齐 .forgejo/workflows/release.yml
#
# 对应关系:
#   release workflow 校验 → --bump / --version 升版本 (+0.0.1, 取 tag/当前版本较大者, 交互确认)
#                         + pnpm set-version (--commit 时提交)
#   release 打包矩阵     → --target macos-arm64|macos-amd64|windows|linux 或 --all / --all-macos
#                         macos-*  : 本机构建 (amd64 走 rustup 交叉)
#                         windows  : cargo-xwin 交叉编译 (MSVC, 打包 NSIS)
#                         linux    : Docker ubuntu:24.04 容器内构建 (WebKit/GTK 无法在 macOS 直接交叉链接)
#   CI 签名 secrets     → --key-file / --key-password 或环境变量 TAURI_SIGNING_PRIVATE_KEY(_PASSWORD)
#   CI macOS 产物重命名 → 自动给 .app.tar.gz(.sig) 补架构后缀 (防 Release 上传 422 冲突)
#   CI 产物收集         → 产物收集到 output/build/artifacts-<name>/
#
# 用法示例:
#   scripts/auto-build.sh                                  # 当前 Mac 原生 target
#   scripts/auto-build.sh --all-macos                      # 两个 macOS target
#   scripts/auto-build.sh --all                            # 全部: macOS x2 + Windows + Linux
#   scripts/auto-build.sh --target windows                 # 交叉编译 Windows (cargo-xwin + NSIS)
#   scripts/auto-build.sh --target linux                   # Docker 容器内构建 Linux
#   scripts/auto-build.sh --bump --commit --all-macos      # 升版本、提交并构建 (等同完整 CI 流程)
#   scripts/auto-build.sh --version 0.7.0 --dry-run        # 只打印计划, 不执行
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

VERSION=""
BUMP=false
COMMIT=false
SKIP_INSTALL=false
COLLECT=true
DRY_RUN=false
OUT_DIR="output/build"
EXTRA_BUNDLES=""
KEY_FILE=""
KEY_PASSWORD=""
TARGETS=()

usage() {
  awk 'NR==1 {next} /^#/ {sub(/^# ?/, ""); print; next} {exit}' "${BASH_SOURCE[0]}"
}

while [ $# -gt 0 ]; do
  case "$1" in
    --version)      VERSION="$2"; shift 2 ;;
    --bump)         BUMP=true; shift ;;
    --commit)       COMMIT=true; shift ;;
    --target)       TARGETS+=("$2"); shift 2 ;;
    --all-macos)    TARGETS+=(macos-arm64 macos-amd64); shift ;;
    --all)          TARGETS+=(macos-arm64 macos-amd64 windows linux); shift ;;
    --bundles)      EXTRA_BUNDLES="$2"; shift 2 ;;
    --key-file)     KEY_FILE="$2"; shift 2 ;;
    --key-password) KEY_PASSWORD="$2"; shift 2 ;;
    --out-dir)      OUT_DIR="$2"; shift 2 ;;
    --skip-install) SKIP_INSTALL=true; shift ;;
    --no-collect)   COLLECT=false; shift ;;
    --dry-run)      DRY_RUN=true; shift ;;
    -h|--help)      usage; exit 0 ;;
    *) echo "未知参数: $1" >&2; usage; exit 1 ;;
  esac
done

run() {
  if [ "$DRY_RUN" = true ]; then
    echo "  [dry-run] $*"
  else
    "$@"
  fi
}

# ── 宿主检测: 仅支持 macOS ───────────────────────────────────
if [ "$(uname -s)" != "Darwin" ]; then
  echo "错误: 本脚本仅支持在 macOS 上运行" >&2
  exit 1
fi
HOST_ARCH="$(uname -m)"

# ── target 解析 (对应 CI build matrix) ───────────────────────
if [ ${#TARGETS[@]} -eq 0 ]; then
  if [ "$HOST_ARCH" = "arm64" ]; then TARGETS=(macos-arm64); else TARGETS=(macos-amd64); fi
fi

target_triple() {
  case "$1" in
    macos-arm64) echo aarch64-apple-darwin ;;
    macos-amd64) echo x86_64-apple-darwin ;;
    windows)     echo x86_64-pc-windows-msvc ;;
    linux)       echo x86_64-unknown-linux-gnu ;;
  esac
}

target_updater_arch() {
  case "$1" in
    macos-arm64) echo aarch64 ;;
    macos-amd64) echo x64 ;;
  esac
}

for t in "${TARGETS[@]}"; do
  case "$t" in
    macos-arm64) [ "$HOST_ARCH" = "arm64" ] || { echo "错误: macos-arm64 需要 Apple Silicon Mac" >&2; exit 1; } ;;
    macos-amd64) [ "$HOST_ARCH" = "x86_64" ] || [ "$HOST_ARCH" = "arm64" ] || { echo "错误: macos-amd64 需要 Intel Mac" >&2; exit 1; } ;;
    windows|linux) ;;
    *) echo "错误: 未知 target '$t' (可选: macos-arm64 macos-amd64 windows linux)" >&2; exit 1 ;;
  esac
done

echo "=== 本地自动构建 ==="
echo "宿主: macOS ($HOST_ARCH)"
echo "targets: ${TARGETS[*]}"

# ── 版本解析 (对应 set-version job) ──────────────────────────
# 版本比较: $1 > $2 时返回 0 (仅比较 major.minor.patch)
ver_gt() {
  local a1 a2 a3 b1 b2 b3
  IFS='.' read -r a1 a2 a3 <<< "$1"
  IFS='.' read -r b1 b2 b3 <<< "$2"
  if [ "$a1" -ne "$b1" ]; then [ "$a1" -gt "$b1" ]; return; fi
  if [ "$a2" -ne "$b2" ]; then [ "$a2" -gt "$b2" ]; return; fi
  [ "$a3" -gt "$b3" ]
}

if [ "$BUMP" = true ]; then
  if [ -n "$VERSION" ]; then
    echo "错误: --bump 与 --version 不能同时使用" >&2
    exit 1
  fi
  CURRENT="$(node -p "require('./package.json').version")"
  # base 取「当前版本」与「最近 tag」中较大者, 避免发布后未打 tag 时重复算出同版本
  BASE="${CURRENT%%-*}"
  LAST_TAG="$(git tag --list 'v[0-9]*' --sort=-v:refname | head -n1)"
  if [ -n "$LAST_TAG" ]; then
    TAG_BASE="${LAST_TAG#v}"; TAG_BASE="${TAG_BASE%%-*}"
    if ver_gt "$TAG_BASE" "$BASE"; then
      BASE="$TAG_BASE"
    fi
  fi
  IFS='.' read -r MAJ MIN PATCH <<< "$BASE"
  VERSION="$MAJ.$MIN.$((PATCH+1))"
  echo "自动提升 (+0.0.1): 当前 $CURRENT / 最近 tag ${LAST_TAG:-<none>} -> $VERSION"

  # 主动询问确认: 回车确认, 或输入其他版本号覆盖
  if [ -t 0 ]; then
    printf "回车确认使用 v%s, 或输入其他版本号: " "$VERSION"
    read -r INPUT_VERSION
    if [ -n "$INPUT_VERSION" ]; then
      VERSION="$INPUT_VERSION"
      echo "使用手动输入版本: $VERSION"
    fi
  else
    echo "非交互环境, 直接使用 $VERSION"
  fi
fi
[ -n "$VERSION" ] && echo "版本: $VERSION" || echo "版本: 不修改"

if [ -n "$VERSION" ]; then
  echo "--- 设置版本号: $VERSION ---"
  run pnpm set-version "$VERSION"
  if [ "$COMMIT" = true ] && [ "$DRY_RUN" = false ]; then
    git add package.json src-tauri/tauri.conf.json src-tauri/Cargo.toml src-tauri/Cargo.lock
    if git diff --cached --quiet; then
      echo "已是 v$VERSION, 无需提交"
    else
      git commit -m "chore: bump version to v$VERSION [skip ci]"
    fi
  elif [ "$COMMIT" = true ]; then
    echo "  [dry-run] git add ... && git commit -m 'chore: bump version to v$VERSION [skip ci]'"
  fi
fi

# ── 签名密钥 (对应 CI secrets) ───────────────────────────────
if [ -n "$KEY_FILE" ]; then
  export TAURI_SIGNING_PRIVATE_KEY="$(cat "$KEY_FILE")"
fi
if [ -n "$KEY_PASSWORD" ]; then
  export TAURI_SIGNING_PRIVATE_KEY_PASSWORD="$KEY_PASSWORD"
fi
if [ -z "${TAURI_SIGNING_PRIVATE_KEY:-}" ]; then
  echo "警告: 未设置 TAURI_SIGNING_PRIVATE_KEY, updater 签名产物可能无法生成"
  echo "      (可用 --key-file <路径> 或 export TAURI_SIGNING_PRIVATE_KEY=...)"
fi

# ── 依赖安装 (macOS 本机 targets) ────────────────────────────
NEEDS_HOST_INSTALL=false
for t in "${TARGETS[@]}"; do
  case "$t" in macos-*) NEEDS_HOST_INSTALL=true ;; esac
done
if [ "$SKIP_INSTALL" = true ] || [ "$NEEDS_HOST_INSTALL" = false ]; then
  echo "--- 跳过本机依赖安装 ---"
else
  echo "--- 安装前端依赖 (pnpm install --frozen-lockfile) ---"
  run pnpm install --frozen-lockfile
fi

# ── 交叉编译前确保 Rust std 目标已安装 ──────────────────────
ensure_rust_target() {
  command -v rustup >/dev/null 2>&1 || { echo "错误: 未安装 rustup" >&2; exit 1; }
  echo "--- rustup target add $1 ---"
  run rustup target add "$1"
}

# ── Linux: Docker 容器内构建 ─────────────────────────────────
build_linux() {
  echo "--- Linux: 检查 Docker ---"
  if ! command -v docker >/dev/null 2>&1; then
    echo "错误: 未安装 Docker (brew install --cask docker)" >&2
    exit 1
  fi
  if [ "$DRY_RUN" = true ]; then
    echo "  [dry-run] docker run ubuntu:24.04: 安装 CI 同款依赖 → Node 26 + pnpm 10 + Rust stable → pnpm install → pnpm tauri build"
    return 0
  fi
  if ! docker info >/dev/null 2>&1; then
    echo "错误: Docker daemon 未运行, 请先启动 Docker Desktop" >&2
    exit 1
  fi

  local IMAGE="ubuntu:24.04"
  docker image inspect "$IMAGE" >/dev/null 2>&1 || docker pull "$IMAGE"

  # 仓库挂载进容器; cargo/rustup 目录用命名卷持久化, 避免每次全量重下工具链和依赖
  # 注意: 容器内 pnpm install 会写入 Linux 平台二进制, 构建完成后 macOS 需重新 pnpm install
  docker run --rm \
    -v "$REPO_ROOT":/work -w /work \
    -v lissio-cargo-home:/root/.cargo \
    -v lissio-rustup-home:/root/.rustup \
    -e APPIMAGE_EXTRACT_AND_RUN=1 \
    -e CARGO_NET_GIT_FETCH_WITH_CLI=true \
    ${TAURI_SIGNING_PRIVATE_KEY:+-e TAURI_SIGNING_PRIVATE_KEY} \
    ${TAURI_SIGNING_PRIVATE_KEY_PASSWORD:+-e TAURI_SIGNING_PRIVATE_KEY_PASSWORD} \
    "$IMAGE" bash -s <<'DOCKER_SCRIPT'
set -euo pipefail
export DEBIAN_FRONTEND=noninteractive
echo "[容器] 安装系统依赖 (与 CI 一致)"
apt-get update
apt-get install -y --no-install-recommends \
  libwebkit2gtk-4.1-dev libayatana-appindicator3-dev librsvg2-dev patchelf \
  libudev-dev pkg-config libfuse2t64 \
  build-essential curl ca-certificates git xz-utils

echo "[容器] 安装 Node 26 + pnpm 10"
NODE_TARBALL=$(curl -fsSL https://nodejs.org/dist/latest-v26.x/ | grep -o 'node-v[0-9.]*-linux-x64.tar.xz' | head -n1)
curl -fsSL "https://nodejs.org/dist/latest-v26.x/$NODE_TARBALL" -o /tmp/node.tar.xz
mkdir -p /opt/node
tar -xJf /tmp/node.tar.xz -C /opt/node --strip-components=1
export PATH="/opt/node/bin:$PATH"
npm install -g pnpm@10

echo "[容器] 安装 Rust stable"
rustup_bin="$HOME/.cargo/bin/rustup"
if [ ! -x "$rustup_bin" ]; then
  curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y --profile minimal
fi
export PATH="$HOME/.cargo/bin:$PATH"

echo "[容器] pnpm install"
pnpm install --frozen-lockfile

echo "[容器] pnpm tauri build"
pnpm tauri build ${EXTRA_BUNDLES:+--bundles "$EXTRA_BUNDLES"}
DOCKER_SCRIPT
}

# ── macOS 产物重命名 (对应 CI "Rename macOS updater artifacts") ──
rename_macos_artifacts() {
  local arch="$1"
  if [ "$DRY_RUN" = true ]; then
    echo "  [dry-run] 重命名 .app.tar.gz(.sig) → *_$arch.*"
    return 0
  fi
  find src-tauri/target -type f -name "*.app.tar.gz*" -path "*/bundle/*" | while read -r f; do
    case "$f" in
      *_aarch64.app.tar.gz|*_x64.app.tar.gz) continue ;;  # 已带后缀, 幂等跳过
      *.app.tar.gz)     mv -v "$f" "${f%.app.tar.gz}_$arch.app.tar.gz" ;;
      *.app.tar.gz.sig) mv -v "$f" "${f%.app.tar.gz.sig}_$arch.app.tar.gz.sig" ;;
    esac
  done
}

# ── 收集产物 (对应 upload-artifact) ──────────────────────────
collect_artifacts() {
  local t="$1" dest="$2"
  mkdir -p "$dest"
  find src-tauri/target -type f -path "*/bundle/*" \( \
    -name "*.dmg" -o -name "*.deb" -o -name "*.AppImage" -o -name "*.msi" \
    -o -name "*.exe" -o -name "*.app.tar.gz" -o -name "*.nsis.zip" -o -name "*.sig" \
  \) -exec cp -v {} "$dest/" \;
  local count
  count=$(find "$dest" -type f | wc -l | tr -d ' ')
  if [ "$count" -eq 0 ]; then
    echo "错误: 未收集到任何 $t 产物" >&2
    exit 1
  fi
  echo "$t: 收集到 $count 个文件 → $dest"
}

# ── 逐 target 构建 ───────────────────────────────────────────
LINUX_BUILT=false
for t in "${TARGETS[@]}"; do
  echo ""
  echo "=== 构建 $t ($(target_triple "$t")) ==="

  case "$t" in
    linux)
      EXTRA_BUNDLES="$EXTRA_BUNDLES" build_linux
      LINUX_BUILT=true
      ;;
    macos-*)
      TRIPLE="$(target_triple "$t")"
      if [ "$TRIPLE" != "${HOST_ARCH}-apple-darwin" ]; then
        ensure_rust_target "$TRIPLE"
      fi
      BUILD_ARGS=(--target "$TRIPLE")
      [ -n "$EXTRA_BUNDLES" ] && BUILD_ARGS+=(--bundles "$EXTRA_BUNDLES")
      echo "--- pnpm tauri build ${BUILD_ARGS[*]} ---"
      if [ "$DRY_RUN" = true ]; then
        echo "  [dry-run] pnpm tauri build ${BUILD_ARGS[*]}"
      else
        pnpm tauri build "${BUILD_ARGS[@]}"
      fi
      rename_macos_artifacts "$(target_updater_arch "$t")"
      ;;
    windows)
      # macOS 交叉编译: cargo-xwin 提供 MSVC 工具链; MSI 依赖 WiX 无法交叉打包, 默认只出 NSIS
      ensure_rust_target "$(target_triple "$t")"
      BUILD_ARGS=(--runner cargo-xwin --target "$(target_triple "$t")")
      BUILD_ARGS+=(--bundles "${EXTRA_BUNDLES:-nsis}")
      if ! command -v cargo-xwin >/dev/null 2>&1 && [ "$DRY_RUN" = false ]; then
        echo "错误: 未安装 cargo-xwin (cargo install cargo-xwin)" >&2
        exit 1
      fi
      echo "--- pnpm tauri build ${BUILD_ARGS[*]} ---"
      if [ "$DRY_RUN" = true ]; then
        echo "  [dry-run] pnpm tauri build ${BUILD_ARGS[*]}"
      else
        pnpm tauri build "${BUILD_ARGS[@]}"
      fi
      ;;
  esac

  if [ "$COLLECT" = true ]; then
    echo "--- 收集产物 ---"
    if [ "$DRY_RUN" = true ]; then
      echo "  [dry-run] 收集到 $OUT_DIR/artifacts-$t/"
    else
      collect_artifacts "$t" "$OUT_DIR/artifacts-$t"
    fi
  fi
done

echo ""
echo "=== 构建完成 (版本: ${VERSION:-不变}) ==="
if [ "$LINUX_BUILT" = true ] && [ "$DRY_RUN" = false ]; then
  echo "提示: Linux 容器构建已重装 node_modules (Linux 二进制), 回到 macOS 开发前请运行 pnpm install"
fi
if [ "$COLLECT" = true ] && [ "$DRY_RUN" = false ]; then
  echo "产物目录: $OUT_DIR/"
  find "$OUT_DIR" -type f -exec ls -lh {} \; 2>/dev/null | awk '{print "  " $9 " (" $5 ")"}'
fi
