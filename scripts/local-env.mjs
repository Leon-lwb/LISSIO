#!/usr/bin/env node
/**
 * local-env.mjs — the local run environment for Windows checkouts
 *
 * Why this file exists: several tools here need a writable OS temp directory, and
 * a confined Windows session (sandboxed agent, restricted token) denies that to
 * child processes under `%TEMP%`. The failures then look unrelated to their cause:
 *
 *   - MSVC aborts with `cl.exe` D8050, "failed to put the command line into the
 *     debug record", because it cannot create its temporary debug records — this
 *     blocked `cargo test --workspace` and every C/C++ dependency build;
 *   - esbuild aborts `vite build` with `remove %TEMP%\esbuild-…: Access is denied`,
 *     which failed `pnpm build:web`, and therefore `pnpm build:all`;
 *   - the contract exporter could not write its output directory.
 *
 * All three have one fix: point `TMP`/`TEMP`/`TMPDIR` at a directory inside the
 * checkout before the tool starts. On Windows that directory is
 * `output/local-tmp` (gitignored through `/output/`); elsewhere this is a no-op,
 * so CI keeps using the system temp directory.
 *
 * It also drops cached `msvcrt.lib` stubs left by Tauri builds. Both
 * `tauri-build` 2.6.3 and 2.7.2 write an 82-byte stub into
 * `target/<profile>/build/lissio-<hash>/out` for static CRT linking. The
 * repository build script removes each newly generated exact placeholder;
 * this prelude also cleans cached build outputs. A leftover shadows the
 * real `msvcrt.lib`, so they fail with LNK2001 for `__CxxFrameHandler3`. Cached
 * candidates are limited to 4 KiB and must lack the `__CxxFrameHandler3` symbol.
 * The build script uses the exact upstream bytes for newly generated files.
 *
 * Usage:
 *   node scripts/local-env.mjs print             # resolved temp directory
 *   node scripts/local-env.mjs <command…>        # run one command with the env
 *   node scripts/local-env.mjs run "<command>"   # run a shell string (for `&&` chains)
 *   node scripts/local-env.mjs desktop "<command>" # also isolate Windows WebView2 data
 *
 * `scripts/check-all.mjs` imports `applyLocalEnv()` directly.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** Stands in for the OS temp directory on Windows; gitignored via `/output/`. */
export const LOCAL_TMP_DIR = join(repoRoot, 'output', 'local-tmp');

/** Persistent development profile, separate from installed-app data and temp files. */
export const DESKTOP_WEBVIEW_DIR = join(repoRoot, 'output', 'desktop-webview');

/** Select a Windows desktop development profile before Tauri starts either window. */
export function applyDesktopEnv(env = process.env, platform = process.platform) {
  if (platform !== 'win32') return null;
  // Respect an explicitly selected profile; never reset or delete existing data.
  if (!env.WEBVIEW2_USER_DATA_FOLDER) {
    mkdirSync(DESKTOP_WEBVIEW_DIR, { recursive: true });
    env.WEBVIEW2_USER_DATA_FOLDER = DESKTOP_WEBVIEW_DIR;
  }
  return env.WEBVIEW2_USER_DATA_FOLDER;
}

/** Bound the cached placeholder candidates considered for cleanup. */
const STUB_MAX_BYTES = 4096;

/** Preserve any cached candidate that supplies this CRT symbol. */
const CXX_FRAME_HANDLER = '__CxxFrameHandler3';

/** Subdirectories of a directory, ignoring files and symlinks. */
function subdirectories(dir) {
  return readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);
}

/**
 * The `target/` trees that can hold a cached Tauri build-script output: the Rust
 * workspace (`server/`) and the Tauri shell (`client/src-tauri/`). Exported so the
 * self-test can pin both roots — the split moved them out of the repository root,
 * and a path that silently stopped being scanned would let the placeholder shadow
 * the real library again.
 */
export const MSVCRT_STUB_TARGET_ROOTS = [
  join(repoRoot, 'server', 'target'),
  join(repoRoot, 'client', 'src-tauri', 'target'),
];

/**
 * Delete the stale Tauri `msvcrt.lib` stubs. Returns the removed paths so the
 * caller can report them; a checkout without a cached placeholder has nothing
 * to remove and nothing is printed. `targetRoots` is parameterisable for the
 * self-test; production callers use the two real trees.
 */
export function removeStaleMsvcrtStubs(targetRoots = MSVCRT_STUB_TARGET_ROOTS) {
  const removed = [];
  for (const targetRoot of targetRoots) {
    if (!existsSync(targetRoot)) continue;
    for (const profile of subdirectories(targetRoot)) {
      const buildDir = join(targetRoot, profile, 'build');
      if (!existsSync(buildDir)) continue;
      for (const crate of subdirectories(buildDir)) {
        if (!crate.startsWith('lissio-')) continue;
        const stub = join(buildDir, crate, 'out', 'msvcrt.lib');
        if (!existsSync(stub)) continue;
        if (statSync(stub).size > STUB_MAX_BYTES) continue;
        if (readFileSync(stub).includes(CXX_FRAME_HANDLER)) continue;
        rmSync(stub, { force: true });
        removed.push(stub);
      }
    }
  }
  return removed;
}

/**
 * Point the temp variables at the checkout-local directory and drop stale stubs.
 *
 * Windows only: on Linux and macOS the system temp directory works, and CI must
 * keep using it. Returns what happened so the caller can report it.
 */
export function applyLocalEnv({ quiet = false } = {}) {
  if (process.platform !== 'win32') {
    return { applied: false, tmpDir: null, removed: [] };
  }
  mkdirSync(LOCAL_TMP_DIR, { recursive: true });
  for (const key of ['TMP', 'TEMP', 'TMPDIR']) process.env[key] = LOCAL_TMP_DIR;
  const removed = removeStaleMsvcrtStubs();
  if (!quiet && removed.length > 0) {
    console.log(
      `local-env: removed ${removed.length} cached Tauri msvcrt.lib stub(s)`,
    );
  }
  return { applied: true, tmpDir: LOCAL_TMP_DIR, removed };
}

/** Run one command with inherited streams, resolving Windows `.cmd` shims. */
function run(argv, { shell }) {
  // The caller's directory, not the repository root: pnpm already runs package
  // scripts from the root, and an ad-hoc `node scripts/local-env.mjs cargo …` from
  // `server` must stay there.
  const options = { stdio: 'inherit' };
  if (process.platform === 'win32') {
    return spawnSync(argv.join(' '), { ...options, shell: true });
  }
  return shell ? spawnSync(argv.join(' '), { ...options, shell: true }) : spawnSync(argv[0], argv.slice(1), options);
}

function main() {
  const [mode, ...rest] = process.argv.slice(2);
  if (mode === 'print') {
    const { applied, tmpDir } = applyLocalEnv();
    console.log(applied ? tmpDir : '(no relocation on this platform)');
    return;
  }
  if (mode === 'run' || mode === 'desktop') {
    const command = rest.join(' ');
    if (!command) {
      console.error(`local-env: ${mode} needs a command string, for example: run "pnpm build:web"`);
      process.exit(2);
    }
    applyLocalEnv();
    if (mode === 'desktop') {
      const webviewDir = applyDesktopEnv();
      if (webviewDir) console.log(`local-env: WebView2 profile ${webviewDir}`);
    }
    process.exit(run([command], { shell: true }).status ?? 1);
  }
  if (mode !== undefined) {
    applyLocalEnv();
    process.exit(run(process.argv.slice(2), { shell: false }).status ?? 1);
  }
  console.error('usage: node scripts/local-env.mjs print | run "<command>" | desktop "<command>" | <command…>');
  process.exit(2);
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  main();
}
