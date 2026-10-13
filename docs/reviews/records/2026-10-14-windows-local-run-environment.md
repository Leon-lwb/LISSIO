# Windows local run environment review

<!-- lissio-review
date: 2026-10-14
scope: Windows portability of the tier driver and of every build and development script, and the temp-directory failures it exposed
reviewer: implementation agent; maintainer sign-off pending
verdict: passed-with-conditions
-->

## Scope

Read `scripts/gates.mjs`, `scripts/check-all.sh`, `scripts/check-ci-gates.mjs`,
`scripts/local-env.mjs`, `scripts/check-all.mjs`, `package.json`, `docs/ci.md`,
`CONTRIBUTING.md`, and the review records for the dependency upgrade and the
check-portability work. The subject is the `pnpm build:all` frontend failure and
the Windows local quality surface.

## Findings

- `pnpm build:all` → `build:desktop` → `tauri build` → `beforeBuildCommand:
  "pnpm build"` failed inside `vite build` with `[vite:esbuild-transpile] remove
  %TEMP%\esbuild-…: Access is denied`: esbuild creates a temporary file and cannot
  delete it. With `TMP`/`TEMP`/`TMPDIR` pointed inside the checkout the same
  command succeeds (exit 0, 58 files and 13 MB under `dist/`).
- This is the third symptom of one confinement. The other two were already known:
  MSVC `cl.exe` D8050, which blocked `cargo test --workspace` because the compiler
  cannot create its temporary debug records, and the contract exporter's IO error.
  One prelude now covers all three, and only on Windows — CI keeps using the system
  temp directory.
- `pnpm check:all` could not run on Windows at all: the package script invoked
  `bash scripts/check-all.sh`, and bash is not on the Windows PATH
  (`'bash' is not recognized`). The driver is now `scripts/check-all.mjs`, a port
  of the shell driver with the same behaviour — plan from `pnpm gates --plan`, the
  formatting phase, one log per check under `output/check-all`, no stop on failure,
  and a summary with a reproduce command per failure. `scripts/check-all.sh`
  remains as the entry point the tier commands and the workflows name and forwards
  unchanged, so `TIER_COMMANDS` and the workflow text are untouched; the two
  drivers cannot disagree, because the Node one still reads the registry plan.
- The gate machinery keeps its anchors. `TIER_DRIVERS` in `scripts/gates.mjs`
  names both files, and the orphan check exempts a `check:*` script that invokes
  either of them — a structural reason, not an allowlist entry.
  `scripts/check-all.mjs` joins `GATE_MACHINERY`, because the shim now only
  executes it, so a workflow step that rewrote it would disarm every gate that
  follows.
- The build and development scripts (`dev*`, the `build:*` leaves,
  `prepare:sidecar*`, `test:e2e`, `test:perf`, `perf:*`) run through the same
  prelude, so the fix is not limited to the quality surface. `build:all`, `build`,
  and `server` compose already-wrapped scripts and were left unchanged.
- Verified on this Windows host: `node scripts/check-all.mjs --quick --list`
  prints the registry plan; `pnpm check:ci-gates` passes (24 gates, 20 on PR);
  `pnpm lint:ci` passes; `pnpm build:web` passes through the wrapper with no
  environment set by hand; the prelude removed three stale `msvcrt.lib` stubs on
  its first run and removes nothing afterwards.

## Follow-ups

1. Maintainer sign-off.
2. The render-budget gate runs `scripts/perf-gate.sh` and therefore still needs
   bash (Git Bash) on Windows. The driver reports that as an environment hint when
   the gate fails, and CI is unaffected. Owner: maintainers.
3. `output/local-tmp` accumulates tool temporary files like any temp directory. It
   is gitignored through `/output/` and is deliberately not wiped on every run, so
   a tool that re-uses its own scratch state keeps working; nothing depends on its
   contents. Owner: maintainers.
