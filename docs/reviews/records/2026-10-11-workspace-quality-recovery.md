# Workspace quality recovery documentation review

<!-- lissio-review
date: 2026-10-11
scope: Floating-point test assertions, performance-monitor startup readiness, and complete quality validation
reviewer: Codex automated review
verdict: passed
-->

## Scope

Reviewed the follow-up to
[onboarding and shared settings persistence](2026-10-11-onboarding-settings-persistence.md)
at commit `5dda7c5`. This record supersedes that record's workspace-gate
failure conclusion and closes its first follow-up; the historical record is
unchanged.

## Findings

- The architecture inventory identifies `performance` as the L4 metric owner
  and `kind` as the L1 node-semantics owner. Dependency edges and ownership
  remain unchanged.
- Clippy first stopped at five performance-metric assertions. Correcting them
  exposed five more floating-point assertions in widget snapping tests.
  Nine arithmetic assertions now use epsilon bounds; the zero assertion
  compares bit patterns to verify normalization from negative to positive zero.
  Production Rust logic, generated contracts, dependencies, and lint rules are
  unchanged.
- The first complete rerun passed Clippy but exposed an intermittent browser
  startup race. The status-bar performance entry could be clicked before
  `hydrateWorkspaceFromBackend` replaced the data-tab list, losing the newly
  opened panel. `StatusBar.tsx` now disables that entry until
  `workspaceReady` is true.
- The browser regression holds actual `workspace_get` requests until it has
  checked the entry's disabled state, then releases restoration and opens the
  monitor through the real UI. It failed before the fix and passed afterward,
  including the frontend and backend metric assertions. It adds no fixed delay
  or retry allowance.
- The existing onboarding change file also records the monitor-readiness fix.
  Version fields and `CHANGELOG.md` are untouched; the change still has one
  release change file.
- The final `pnpm check:all -- --no-fix` run passed all 24 entries, including
  the informational architecture inventory and all 23 enforcing gates.
  Vitest passed 186 files and 1329 tests. The Rust workspace passed 1512 tests
  with two ignored. All 10 functional browser tests and all three frontend
  performance scenarios passed. The committed performance baseline is unchanged.
- Validation retains one Vitest worker, one Playwright worker, two Cargo build
  jobs, and one Rust test thread, with gates executed sequentially.
- Checklist review: paths, identifiers, commands and counts match source and
  check output (1.3–1.5); no new external claims or hosting changes (1.6);
  license, attribution, dependencies and notices remain unchanged (1.1–1.2,
  1.8, 2.1–2.7). This English record is indexed with complete metadata and local
  links (1.7, 3.1–3.7). Source authority, gate ownership, and review triggers are
  explicit (4.1–4.5); complete gates, the release note and review index are
  synchronized (5.1–5.5).

## Follow-ups

No quality-gate blocker remains. Repeat this review when the metric assertions,
workspace-restoration boundary, or validation concurrency changes. Owner:
maintainers; review at the next such change.

The earlier review's Windows-environment validation remains outside this
quality-recovery scope. Owner: maintainers; review by 2026-10-18 or before
release, whichever is earlier.
