# Build-all bundle finalization review

<!-- lissio-review
date: 2026-10-15
scope: Fixed in-project bundle outputs and cross-platform build-all finalization
reviewer: implementation agent; maintainer sign-off pending
verdict: passed-with-conditions
-->

## Scope

Reviewed `package.json`, `scripts/finalize-bundles.mjs`, its tests, the native
`scripts/windows-integrity.ps1` helper, the build, CI, and release guides, and
the onboarding persistence assertion in `e2e/settings-persistence.spec.ts`.
This record supersedes the export workflow described in the earlier
[Windows installer integrity review](2026-10-15-windows-installer-integrity.md).
The earlier diagnosis and installation acceptance remain applicable.

## Findings

- The artifact export command was `export:windows`. `generate:contracts`
  generates source wire types; artifact collection in `auto-build` belongs to
  the existing macOS-host release matrix. Neither is another native
  delivery-export command.
- At the user's request, the independent exporter, desktop wrapper, configurable
  destination, and build receipt have been removed. `pnpm build:all` now builds
  the server and desktop, then finalizes current-version NSIS/MSI files in the
  original `src-tauri/target/release/bundle/` subfolders. It creates no artifact
  copies or output directories outside the project. The existing local temp
  prelude also applies to this final step.
- The finalizer raises labels below Medium, verifies native numeric SIDs and
  unchanged SHA256, and preserves existing Medium or higher labels. Process
  confinement, a denied update, or a failed verification returns nonzero with
  an ordinary-terminal recovery instruction. Directory labels and persisted
  environment variables are unchanged.
- Changing the current NSIS file's label in its original bundle location
  produced `S-1-16-8192` with the same SHA256. Twelve focused tests passed,
  including a native Windows file with spaces and Chinese characters, repeated
  finalization, Low-process rejection, permission failures, byte tampering,
  current-version discovery, and Linux/macOS skip branches. Native macOS/Linux
  execution is not established by the branch tests.
- The complete `pnpm build:all` run succeeded and left both installers in their
  original folders. NSIS has Medium integrity and SHA256
  `6186383b7c56f5763b267cf79d4cd8a33a00d7182baffa606b9dddd203f5d937`;
  MSI retains High integrity and SHA256
  `f1bbafdbde0b40c4a4f5a18ce423595ecc28afa4bf3209f011403077b84f5445`.
  Repeating finalization preserved both labels and hashes. A real Low-integrity
  Node process was rejected with `S-1-16-4096` before any label update.
  Evidence is in `output/bundle-finalization-validation/build-all.log`,
  `finalize-repeat.log`, and `low-process.log`. Native checks in
  `directory-labels.log` confirm the checkout and bundle directories retain
  their original Low labels.
- The complete `pnpm check:all --no-fix` run executed all 24 enforcing gates
  and the informational inventory. All items passed except the onboarding E2E
  assertion: 199 unit-test files and 1,427 tests, Rust formatting/Clippy/tests,
  production web build, render budget, release checks, and `cargo deny` passed.
  The E2E failure reproduced on a full browser-suite retry. Language selection
  saves before confirmation asynchronously obtains the version, so the test's
  language poll could finish before `lastSeenVersion` was written. The assertion
  now polls the version marker's string type as well, still rejecting null and
  missing fields. After this test-only timing correction, all 15 browser tests
  and zero-warning lint on the changed test passed. The other successful gates
  were not repeated. Evidence is in `check-all-summary.log`, `e2e-retry.log`,
  and `e2e-final.log` under `output/bundle-finalization-validation/`.
- The maintained English documents name the implementation authority and the
  fixed output locations. The change file records packaging behavior. No Rust
  API, dependency, license, version, changelog, or render baseline is changed.
  Agent checklist review does not constitute human maintainer sign-off.

## Follow-ups

1. Complete maintainer checklist review and installation acceptance on every
   published Windows version and architecture. Owner: Lissio maintainers.
   Due: before merge or release; review date: 2026-10-15.
2. Verify native macOS/Linux builds on those hosts before release. Owner:
   Lissio maintainers. Due: before release; review date: 2026-10-15.
