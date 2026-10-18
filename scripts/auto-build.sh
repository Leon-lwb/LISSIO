#!/usr/bin/env bash
#
# auto-build.sh — local automated build (macOS host only), behavior aligned with .forgejo/workflows/release.yml
#
# Correspondence:
#   release workflow validation → --bump / --version to raise the version (+0.0.1, taking the
#                                 larger of tag/current version, interactive confirmation)
#                               + pnpm set-version (committed when --commit is given)
#   release packaging matrix    → --target macos-arm64|macos-amd64|windows|linux or --all / --all-macos
#                                 macos-* : native build (amd64 goes through a rustup cross target)
#                                 windows : cargo-xwin cross-compilation (MSVC, packaged as NSIS)
#                                 linux   : build inside a Docker ubuntu:24.04 container (WebKit/GTK cannot be cross-linked directly on macOS)
#   CI signing secrets          → --key-file / --key-password or the TAURI_SIGNING_PRIVATE_KEY(_PASSWORD) env vars
#   CI macOS artifact rename    → append the architecture suffix to .app.tar.gz(.sig) automatically (prevents Release upload 422 conflicts)
#   CI artifact collection      → collect artifacts into output/build/artifacts-<name>/
#
# Usage examples:
#   scripts/auto-build.sh                                  # current Mac native target
#   scripts/auto-build.sh --all-macos                      # both macOS targets
#   scripts/auto-build.sh --all                            # all: macOS x2 + Windows + Linux
#   scripts/auto-build.sh --target windows                 # cross-compile Windows (cargo-xwin + NSIS)
#   scripts/auto-build.sh --target linux                   # build Linux inside a Docker container
#   scripts/auto-build.sh --bump --commit --all-macos      # raise the version, commit, and build (equivalent to the full CI flow)
#   scripts/auto-build.sh --version 0.7.0 --dry-run        # print the plan only, do not execute
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
    *) echo "unknown argument: $1" >&2; usage; exit 1 ;;
  esac
done

run() {
  if [ "$DRY_RUN" = true ]; then
    echo "  [dry-run] $*"
  else
    "$@"
  fi
}

# ── Host detection: macOS only ───────────────────────────────────
if [ "$(uname -s)" != "Darwin" ]; then
  echo "error: this script only runs on macOS" >&2
  exit 1
fi
HOST_ARCH="$(uname -m)"

# ── target resolution (corresponds to the CI build matrix) ───────────────────────
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
    macos-arm64) [ "$HOST_ARCH" = "arm64" ] || { echo "error: macos-arm64 requires an Apple Silicon Mac" >&2; exit 1; } ;;
    macos-amd64) [ "$HOST_ARCH" = "x86_64" ] || [ "$HOST_ARCH" = "arm64" ] || { echo "error: macos-amd64 requires an Intel Mac" >&2; exit 1; } ;;
    windows|linux) ;;
    *) echo "error: unknown target '$t' (options: macos-arm64 macos-amd64 windows linux)" >&2; exit 1 ;;
  esac
done

echo "=== Local automated build ==="
echo "host: macOS ($HOST_ARCH)"
echo "targets: ${TARGETS[*]}"

# ── Version resolution (corresponds to the set-version job) ──────────────────────────
# Version comparison: returns 0 when $1 > $2 (compares major.minor.patch only)
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
    echo "error: --bump and --version cannot be used together" >&2
    exit 1
  fi
  CURRENT="$(node -p "require('./package.json').version")"
  # base is the larger of the current version and the latest tag, so a release that has not
  # been tagged yet does not recompute the same version
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
  echo "auto bump (+0.0.1): current $CURRENT / latest tag ${LAST_TAG:-<none>} -> $VERSION"

  # Prompt for confirmation: Enter accepts, or type another version to override
  if [ -t 0 ]; then
    printf "press Enter to use v%s, or type another version: " "$VERSION"
    read -r INPUT_VERSION
    if [ -n "$INPUT_VERSION" ]; then
      VERSION="$INPUT_VERSION"
      echo "using manually entered version: $VERSION"
    fi
  else
    echo "non-interactive environment, using $VERSION directly"
  fi
fi
[ -n "$VERSION" ] && echo "version: $VERSION" || echo "version: unchanged"

if [ -n "$VERSION" ]; then
  echo "--- set version: $VERSION ---"
  run pnpm set-version "$VERSION"
  if [ "$COMMIT" = true ] && [ "$DRY_RUN" = false ]; then
    # `client/` and `server/` are submodules: the version files live in those repositories, and
    # the umbrella cannot stage a path inside a submodule. Commit each side there, then stage the
    # umbrella's own manifest and the updated submodule pointers.
    # (A `case`, not an associative array: macOS still ships bash 3.2.)
    for side in client server; do
      case "$side" in
        client) side_files="src-tauri/tauri.conf.json" ;;
        server) side_files="Cargo.toml Cargo.lock" ;;
      esac
      # shellcheck disable=SC2086 # side_files is a deliberate two-path list for server
      git -C "$side" add -- $side_files
      if ! git -C "$side" diff --cached --quiet; then
        git -C "$side" commit -m "chore: bump version to v$VERSION [skip ci]"
      fi
    done
    git add package.json client server
    if git diff --cached --quiet; then
      echo "already v$VERSION, nothing to commit"
    else
      git commit -m "chore: bump version to v$VERSION [skip ci]"
    fi
  elif [ "$COMMIT" = true ]; then
    echo "  [dry-run] commit package.json, client/src-tauri/tauri.conf.json, and server/{Cargo.toml,Cargo.lock} at v$VERSION"
  fi
fi

# ── Signing keys (corresponds to CI secrets) ───────────────────────────────
if [ -n "$KEY_FILE" ]; then
  export TAURI_SIGNING_PRIVATE_KEY="$(cat "$KEY_FILE")"
fi
if [ -n "$KEY_PASSWORD" ]; then
  export TAURI_SIGNING_PRIVATE_KEY_PASSWORD="$KEY_PASSWORD"
fi
if [ -z "${TAURI_SIGNING_PRIVATE_KEY:-}" ]; then
  echo "warning: TAURI_SIGNING_PRIVATE_KEY is not set; updater signature artifacts may not be generated"
  echo "      (use --key-file <path> or export TAURI_SIGNING_PRIVATE_KEY=...)"
fi

# ── Dependency install (native macOS targets) ────────────────────────────
NEEDS_HOST_INSTALL=false
for t in "${TARGETS[@]}"; do
  case "$t" in macos-*) NEEDS_HOST_INSTALL=true ;; esac
done
if [ "$SKIP_INSTALL" = true ] || [ "$NEEDS_HOST_INSTALL" = false ]; then
  echo "--- skipping native dependency install ---"
else
  echo "--- installing dependencies (pnpm install --frozen-lockfile, umbrella and client/) ---"
  run pnpm install --frozen-lockfile
  run pnpm --dir client install --frozen-lockfile
fi

# ── Ensure the Rust std target is installed before cross-compiling ──────────────────────
ensure_rust_target() {
  command -v rustup >/dev/null 2>&1 || { echo "error: rustup is not installed" >&2; exit 1; }
  echo "--- rustup target add $1 ---"
  run rustup target add "$1"
}

# ── Linux: build inside a Docker container ─────────────────────────────────
build_linux() {
  echo "--- Linux: checking Docker ---"
  if ! command -v docker >/dev/null 2>&1; then
    echo "error: Docker is not installed (brew install --cask docker)" >&2
    exit 1
  fi
  if [ "$DRY_RUN" = true ]; then
    echo "  [dry-run] docker run ubuntu:24.04: install the same dependencies as CI → Node 26 + pnpm 10 + Rust stable → pnpm install → pnpm tauri build"
    return 0
  fi
  if ! docker info >/dev/null 2>&1; then
    echo "error: the Docker daemon is not running; start Docker Desktop first" >&2
    exit 1
  fi

  local IMAGE="ubuntu:24.04"
  docker image inspect "$IMAGE" >/dev/null 2>&1 || docker pull "$IMAGE"

  # Mount the repository into the container; persist the cargo/rustup directories as named
  # volumes so the toolchain and dependencies are not fully re-downloaded each time.
  # Note: pnpm install inside the container writes Linux platform binaries, so macOS needs to
  # run pnpm install again after the build.
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
echo "[container] installing system dependencies (same as CI)"
apt-get update
apt-get install -y --no-install-recommends \
  libwebkit2gtk-4.1-dev libayatana-appindicator3-dev librsvg2-dev patchelf \
  libudev-dev pkg-config libfuse2t64 \
  build-essential curl ca-certificates git xz-utils

echo "[container] installing Node 26 + pnpm 10"
NODE_TARBALL=$(curl -fsSL https://nodejs.org/dist/latest-v26.x/ | grep -o 'node-v[0-9.]*-linux-x64.tar.xz' | head -n1)
curl -fsSL "https://nodejs.org/dist/latest-v26.x/$NODE_TARBALL" -o /tmp/node.tar.xz
mkdir -p /opt/node
tar -xJf /tmp/node.tar.xz -C /opt/node --strip-components=1
export PATH="/opt/node/bin:$PATH"
npm install -g pnpm@10

echo "[container] installing Rust stable"
rustup_bin="$HOME/.cargo/bin/rustup"
if [ ! -x "$rustup_bin" ]; then
  curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y --profile minimal
fi
export PATH="$HOME/.cargo/bin:$PATH"

echo "[container] pnpm install"
pnpm install --frozen-lockfile
pnpm --dir client install --frozen-lockfile

echo "[container] pnpm tauri build"
pnpm tauri build ${EXTRA_BUNDLES:+--bundles "$EXTRA_BUNDLES"}
DOCKER_SCRIPT
}

# ── macOS artifact rename (corresponds to CI "Rename macOS updater artifacts") ──
rename_macos_artifacts() {
  local arch="$1"
  if [ "$DRY_RUN" = true ]; then
    echo "  [dry-run] rename .app.tar.gz(.sig) → *_$arch.*"
    return 0
  fi
  find client/src-tauri/target -type f -name "*.app.tar.gz*" -path "*/bundle/*" | while read -r f; do
    case "$f" in
      *_aarch64.app.tar.gz|*_x64.app.tar.gz) continue ;;  # already suffixed, idempotent skip
      *.app.tar.gz)     mv -v "$f" "${f%.app.tar.gz}_$arch.app.tar.gz" ;;
      *.app.tar.gz.sig) mv -v "$f" "${f%.app.tar.gz.sig}_$arch.app.tar.gz.sig" ;;
    esac
  done
}

# ── Collect artifacts (corresponds to upload-artifact) ──────────────────────────
collect_artifacts() {
  local t="$1" dest="$2"
  mkdir -p "$dest"
  find client/src-tauri/target -type f -path "*/bundle/*" \( \
    -name "*.dmg" -o -name "*.deb" -o -name "*.AppImage" -o -name "*.msi" \
    -o -name "*.exe" -o -name "*.app.tar.gz" -o -name "*.nsis.zip" -o -name "*.sig" \
  \) -exec cp -v {} "$dest/" \;
  local count
  count=$(find "$dest" -type f | wc -l | tr -d ' ')
  if [ "$count" -eq 0 ]; then
    echo "error: no $t artifacts were collected" >&2
    exit 1
  fi
  echo "$t: collected $count files → $dest"
}

# ── Build each target ───────────────────────────────────────────
LINUX_BUILT=false
for t in "${TARGETS[@]}"; do
  echo ""
  echo "=== building $t ($(target_triple "$t")) ==="

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
      # Cross-compile from macOS: cargo-xwin provides the MSVC toolchain; MSI needs WiX and
      # cannot be cross-packaged, so only NSIS is produced by default
      ensure_rust_target "$(target_triple "$t")"
      BUILD_ARGS=(--runner cargo-xwin --target "$(target_triple "$t")")
      BUILD_ARGS+=(--bundles "${EXTRA_BUNDLES:-nsis}")
      if ! command -v cargo-xwin >/dev/null 2>&1 && [ "$DRY_RUN" = false ]; then
        echo "error: cargo-xwin is not installed (cargo install cargo-xwin)" >&2
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
    echo "--- collecting artifacts ---"
    if [ "$DRY_RUN" = true ]; then
      echo "  [dry-run] collected into $OUT_DIR/artifacts-$t/"
    else
      collect_artifacts "$t" "$OUT_DIR/artifacts-$t"
    fi
  fi
done

echo ""
echo "=== build complete (version: ${VERSION:-unchanged}) ==="
if [ "$LINUX_BUILT" = true ] && [ "$DRY_RUN" = false ]; then
  echo "note: the Linux container build reinstalled node_modules (Linux binaries); run pnpm install before developing on macOS again"
fi
if [ "$COLLECT" = true ] && [ "$DRY_RUN" = false ]; then
  echo "artifact directory: $OUT_DIR/"
  find "$OUT_DIR" -type f -exec ls -lh {} \; 2>/dev/null | awk '{print "  " $9 " (" $5 ")"}'
fi
