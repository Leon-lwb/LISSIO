# Windows desktop development and quality gates review

<!-- lissio-review
date: 2026-10-14
scope: Windows desktop development profile isolation, CRLF-safe gate documentation, platform log-directory assertions, and the complete local quality surface
reviewer: implementation agent and independent documentation review agent; maintainer sign-off pending
verdict: failed
-->

## Scope

Reviewed the root `AGENTS.md`, `docs/AGENTS.md`, `CONTRIBUTING.md`,
`RELEASING.md`, `GOVERNANCE.md`, documentation standards and review policy,
`docs/reviews/checklist.md`, and `docs/ci.md`. Implementation authority is
`package.json`, `scripts/local-env.mjs`, `scripts/gates.mjs`,
`scripts/check-ci-gates.mjs`, the colocated script tests,
`src-tauri/src/logging.rs`, and `src-tauri/src/logging_tests.rs`. The earlier
[check-portability review](2026-10-13-check-platform-portability.md) and
[Windows local-run review](2026-10-14-windows-local-run-environment.md) provide
historical context and remain unchanged.

## Findings

- The reported desktop failure occurred in the user's own PowerShell or
  Windows Terminal session. The log-directory warning used the existing
  checkout-local fallback; the fatal error was WebView2 returning
  `HRESULT(0x800700AA)` while creating the window. The Windows desktop launcher
  now selects `output/desktop-webview` before starting Tauri. It reuses that
  directory across restarts, respects an explicit `WEBVIEW2_USER_DATA_FOLDER`,
  and does not change the environment on Linux or macOS. Existing application
  data is preserved. The initial browser profile starts with fresh browser
  preferences; backend settings and recordings keep their existing location.
- The earlier implementation verification reported a successful
  `pnpm dev:desktop` smoke test, visible main window, healthy backend, four
  passing launcher regression cases, and a passing lint check. These targeted
  results did not constitute a complete quality run.
- The previous CRLF comparison normalized the extracted block only after
  `extractDocBlock()` had trimmed LF-only boundary newlines. A CRLF boundary
  starts with `\r`, so leading blank lines survived trimming and became extra
  LF lines during comparison. Content-equivalent generated documentation was
  therefore reported as stale on Windows. `extractDocBlock()` now normalizes
  CRLF before trimming boundary blank lines. The independent review confirmed
  that spaces, tabs, standalone carriage returns, content differences, and
  invalid-marker handling retain their existing meaning.
- `scripts/gates.mjs` remains the gate inventory. The full local run is
  `pnpm check:all --no-fix`, including the production frontend build, browser
  smoke tests, render-budget measurement, and `cargo deny check`. A green
  subset is insufficient, and the committed performance baseline must not be
  regenerated merely to obtain a pass.
- Checklist review: documentation and tooling prose are English; current
  behavior is described in `CONTRIBUTING.md` with its source command and
  environment override; the new record is indexed in `docs/reviews/README.md`,
  which is reachable from `docs/README.md`. No dependency, asset, license,
  copyright, patent, branding, wire contract, version field, or published
  release artifact is changed. No third-party inventory addition is needed.
  The completed `check:docs` gate verified `LICENSE`, SPDX consistency,
  metadata, relative links, and index integrity. All three modified maintained
  documents have `last-reviewed: 2026-10-14`.
- The implementation agent and an independent review agent completed the
  technical and documentation review recorded here. This is not a maintainer
  signature or merge approval. No human maintainer sign-off has been recorded;
  the maintainer checklist review remains a pre-merge obligation.
- The gate regression suite covers all three generated-document styles with
  LF, CRLF, and mixed line endings; repair round trips preserve surrounding
  prose; changed commands, removed gates, and spacing remain detectable.
  It also covers standalone carriage returns and missing or reversed markers.
  Before the fix, 10 of 20 cases failed; after the fix, all 20 passed.
- The host logging test asserted that every platform path ended with the
  application identifier. The production path resolver intentionally places
  `logs` after the identifier on Windows and Linux; only the macOS path ends
  with the identifier. The assertion now compares the exact platform-specific
  path, including the host base directory. Its expected path is constructed
  independently from the production `log_dir()` helper. This is a test
  correction, not a change to logging behavior or an allowance for inaccessible
  log targets.
- The first complete `pnpm check:all --no-fix` run executed all 25 registry
  entries, including the informational architecture inventory, in 693 seconds:
  22 passed and three failed. It passed the architecture, dependency,
  Tauri-version, wire-contract, model-catalog, UI-token, motion, layer,
  documentation, gate-drift, TypeScript,
  lint, Rust-size, Rust-format, workspace-Clippy, change-file, release-sync,
  production frontend build, and render-budget checks. Frontend unit tests
  passed: 197 files and 1,409 tests. The three failed entries were the Rust
  workspace tests, browser smoke tests, and dependency audit.
- The first `cargo test --workspace` attempt failed during compilation with
  Windows error 1455: the paging file was too small for the compiler's memory
  mapping. Missing-crate, type, and derive errors followed that primary resource
  error. No test-result claim is drawn from that attempt. The follow-up run
  retains the complete workspace test scope and sets `CARGO_BUILD_JOBS=1`
  through the command environment; it does not change committed build settings.
- The complete workspace retry exited successfully after compiling its test
  targets in 6 minutes 4 seconds. Independent log aggregation found 211 result
  sections: 1,500 passed, zero failed, two ignored, and zero filtered out. The
  corrected host log-directory test passed. Both ignored cases already exist
  in `HEAD`: the manual release-mode throughput test in
  `src-tauri/crates/desktop/pipeline/tests/byte_router_tests.rs` and the ignored
  example in `src-tauri/crates/protocol/frame-decoder/src/test_data.rs`. This
  change introduced no ignore marker or test filter.
- The first browser run passed 13 of 14 tests and failed the sliding-pill
  animation-sampling assertion. A complete unchanged `pnpm test:e2e` retry
  passed all 14 tests in 34.1 seconds. The original failure remains in the
  first-run log. No browser test, assertion tolerance, or performance baseline
  was changed. The render-budget gate measured all scenarios and passed against
  the committed baseline.
- `cargo deny check` is blocked while fetching the RustSec advisory database.
  The installed tool is the required version, 0.20.2. Normal Git fetching
  failed in Schannel TLS negotiation; a process-local OpenSSL backend with
  certificate verification enabled also failed. HTTP/1 and direct local API
  transport checks did not restore access. An independent connected GitHub
  read verified remote `main` at
  `caee11f41fab07d676c0a4655a2a5dd1f94da97c`, while the local cached database was
  `29d1a60c3361576d366b1740bba2254dc6173434`. The cache was therefore stale, and
  no fetch-disabled audit result was accepted. Certificate verification and
  audit policy remain unchanged; no exception was added.
- Evidence is retained locally under `output/check-all/` and
  `output/check-all-retries/`, including the original failed gates, the full
  browser retry, audit TLS diagnostics, and the independently verified advisory
  references in `cargo-deny-advisory-head.json`. These generated logs remain
  gitignored.
- Final validation status: 23 of the 24 required gates have successful
  full-scope results, and the informational architecture inventory succeeded.
  The dependency audit remains blocked. Missing verification is not a gate
  exception under `docs/governance/document-review.md`, so the review verdict
  remains `failed`. This review does not establish a complete passing build or
  release readiness.

## Follow-ups

1. Restore verified Git access to the current RustSec advisory database and
   rerun `cargo deny check` before accepting the complete quality surface.
   Owner: Lissio maintainers. Due: before merge or release of these changes.
2. Review the final diff and this explicit checklist record before merge.
   Owner: Lissio maintainers. Due: before the next merge of these changes.
3. Re-review when the desktop launcher profile policy, gate-block parser, or
   Windows gate-runner prerequisites change. Owner: Lissio maintainers.
