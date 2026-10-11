# Onboarding and shared settings persistence documentation review

<!-- lissio-review
date: 2026-10-11
scope: Automatic onboarding dismissal, shared backend settings persistence, failure recovery, and bounded validation concurrency
reviewer: Codex automated review
verdict: passed-with-conditions
-->

## Scope

Reviewed the settings client, startup flow, onboarding and Help controls,
`backend-host::SettingsStore`, the backend HTTP adapter, dependency removal,
and validation worker limits. Updated README, Web architecture, the release
change file, license inventory, and this indexed review after rebasing onto
`923d63d` from `origin/develop`.

## Findings

- Ending and completing the tour persist `showOnboarding: false` immediately.
  Skipping an individual step only advances; Help offers manual replay.
  Automatic entry requires a successful settings read and the enabled switch.
  Version metadata cannot force a tour, and an open tour blocks later dialogs.
- Desktop and Web use the authenticated current backend for settings. Client
  writes are serialized across store instances and wait for persistence
  acknowledgement. Requests captured before a connection replacement cannot
  write to the replacement backend.
- Missing files produce an empty document. Invalid JSON, non-object documents,
  and I/O errors remain errors. Failed reads do not authorize default writes;
  read and write errors offer visible retry actions. The backend flushes a
  temporary file before replacement and preserves the current document shape.
- Removing the Tauri store plugin adds no replacement dependency. Regenerated
  Cargo metadata contains 772 external crates; pnpm inventories contain 391
  production packages and 820 including development. The license inventory
  reflects the rebased graph without changing license policy or attribution.
- Applied the upstream English-only documentation policy, retaining the removal
  of translated documentation backups and keeping product Chinese localization.
  Release prose uses one `.changes/` file; the upstream 0.8.0 version fields and
  `CHANGELOG.md` remain unchanged. Commit metadata follows Conventional Commits
  with complete `Files:` and `Refs:` trailers.
- Validation defaults are one Vitest worker, one Playwright worker, two Cargo
  build jobs, and one Rust test thread. The full runner executes gates
  sequentially. `pnpm check:all -- --no-fix` against the rebased tree executed
  all 24 entries: 23 passed, including the informational architecture inventory,
  and Clippy failed. This is not a green full build.
- Passing checks include architecture rules, dependency policy, Web command
  surface, all 190 generated contracts, model catalog, UI tokens, motion, UI
  layers, documentation, CI gate consistency, TypeScript, zero-warning ESLint,
  Rust source size, formatting, change-file validity, release sync, Web production
  build, frontend render budget, and `cargo deny check`.
- Vitest passed 186 files and 1329 tests. The Rust workspace passed 1512 tests
  with two ignored. All 10 browser tests passed, including the three new
  real-backend regressions: dismissal survives backend restart and permits Help
  replay, corrupt settings remain untouched until repaired and retried, and a
  failed save can retry the latest dismissal preference. All three performance
  scenarios passed; the committed performance baseline was not changed.
- Clippy rejects five existing direct floating-point comparisons in
  `performance/src/model.rs` and `performance/src/monitor.rs`. These files are
  identical to `origin/develop`. The earlier catalog compilation and browser
  assertion failures no longer occur on the rebased tree.
- Checklist coverage: factual paths, identifiers, formats and inventory (1.3–1.5);
  unchanged license and attribution policy with a removed dependency (1.1–1.2,
  1.8, 2.1–2.7); document placement, metadata, English-only policy and indexes
  (1.7, 3.1–3.7); named code authority and explicit review triggers (4.1–4.5);
  documentation gate, synchronized release prose and this indexed record
  (5.1, 5.3–5.5). External links were not comprehensively revalidated (1.6).
  The workspace Clippy failure prevents a full pass for checklist 5.2.

## Follow-ups

1. Resolve the existing `performance` floating-comparison lint failures before
   claiming a green workspace build. Owner: maintainers. Review by 2026-10-18
   or before release, whichever is earlier.
2. Confirm behavior in the issue reporter's Windows environment; the automated
   persistence regression uses a Linux backend and Chromium. Owner: maintainers.
   Review by 2026-10-18 or before release, whichever is earlier; repeat this
   review on storage-format or startup-flow changes.
