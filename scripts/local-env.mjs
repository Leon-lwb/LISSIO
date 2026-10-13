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
 * It also drops the stale `msvcrt.lib` stub an older Tauri build script left
 * behind. `tauri-build` 2.6.3 wrote an 82-byte stub into its reused
 * `target/<profile>/build/lissio-<hash>/out` so the app would link the static CRT;
 * 2.7.2 writes a content-hashed name instead and never removes the old file. The
 * leftover stays on the link search path of unrelated doctests and shadows the
 * real `msvcrt.lib`, so they fail with LNK2001 for `__CxxFrameHandler3`. Only
 * files that are demonstrably that stub are removed: under 4 KiB and without the
 * `__CxxFrameHandler3` symbol, so a real import library is never touched.
 *
 * Usage:
 *   node scripts/local-env.mjs print             # resolved temp directory
 *   node scripts/local-env.mjs <command…>        # run one command with the env
 *   node scripts/local-env.mjs run "<command>"   # run a shell string (for `&&` chains)
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

/** A stub is tiny; a real import library is hundreds of kilobytes. */
const STUB_MAX_BYTES = 4096;

/** The symbol the stub exists to *not* provide; its absence proves it is the stub. */
const CXX_FRAME_HANDLER = '__CxxFrameHandler3';

/** Subdirectories of a directory, ignoring files and symlinks. */
function subdirectories(dir) {
  return readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);
}

/**
 * Delete the stale Tauri `msvcrt.lib` stubs. Returns the removed paths so the
 * caller can report them; a machine that never built an older `tauri-build` has
 * nothing to remove and nothing is printed.
 */
function removeStaleMsvcrtStubs() {
  const targetRoot = join(repoRoot, 'src-tauri', 'target');
  if (!existsSync(targetRoot)) return [];
  const removed = [];
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
      `local-env: removed ${removed.length} stale msvcrt.lib stub(s) left by an older tauri-build`,
    );
  }
  return { applied: true, tmpDir: LOCAL_TMP_DIR, removed };
}

/** Run one command with inherited streams, resolving Windows `.cmd` shims. */
function run(argv, { shell }) {
  // The caller's directory, not the repository root: pnpm already runs package
  // scripts from the root, and an ad-hoc `node scripts/local-env.mjs cargo …` from
  // `src-tauri` must stay there.
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
  if (mode === 'run') {
    const command = rest.join(' ');
    if (!command) {
      console.error('local-env: run needs a command string, for example: run "pnpm build:web"');
      process.exit(2);
    }
    applyLocalEnv();
    process.exit(run([command], { shell: true }).status ?? 1);
  }
  if (mode !== undefined) {
    applyLocalEnv();
    process.exit(run(process.argv.slice(2), { shell: false }).status ?? 1);
  }
  console.error('usage: node scripts/local-env.mjs print | run "<command>" | <command…>');
  process.exit(2);
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  main();
}
