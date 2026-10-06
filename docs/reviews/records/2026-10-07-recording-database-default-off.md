# Recording database default-off documentation review

<!-- lissio-review
date: 2026-10-07
scope: Recording database master switch default flips from on to off across frontend settings, backend-host fallback, and RecordingHub state
reviewer: Horldsence
verdict: passed-with-conditions
-->

## Scope

Reviewed the default flip of `AppSettings.data.recordingEnabled` from on to
off: the frontend `DEFAULT_SETTINGS`, the `backend-host` fallback constant
`RECORDING_ENABLED_DEFAULT`, and `RecordingHub`'s default state, together with
`CHANGELOG.md`, `docs/architecture/crates.md`, their Chinese backups under
`docs/community/`, and the affected Rust and Vitest tests. After this change a
fresh install or a settings reset opens no DuckDB connection until the user
enables recording, while a persisted `true` keeps recording on.

## Findings

- All three defaults are off: `DEFAULT_SETTINGS.data.recordingEnabled`,
  `RECORDING_ENABLED_DEFAULT`, and `HubState`'s derived `Default`.
- The backend-host test asserts that a missing or type-invalid
  `app.data.recordingEnabled` falls back to off, and that a persisted `true`
  still enables recording.
- The settings-store test pins the frontend default to off; the cleanup tests
  enable recording explicitly so they keep testing their original condition
  instead of passing because recording is off.
- Fresh-state runtime check on the rebased commit with `pnpm dev:desktop`: the
  sidecar logged `recording disabled by settings: no database connection
  opened`, the config directory contained no `settings.json` and no
  `recordings/`, the frontend persisted `data.recordingEnabled: false`, and no
  DuckDB file appeared.
- `docs/architecture/crates.md` and both Chinese backups now describe the
  default as off. The upstream relicense deleted the 0.7.2 release-notes file,
  so the wording change there was dropped with it.
- Passing gates on the rebased commit: `pnpm check:docs`,
  `check:architecture`, `check:deps`, `check:web-contract`, `check:contracts`,
  `check:model-catalog`, `check:tokens`, `check:motion`, `pnpm typecheck`,
  `pnpm test` (181 files, 1293 tests), `cargo fmt --check`, and
  `cargo test -p lissio-recording -p lissio-backend-host`.
- Frontend gates need Node 22 or newer; the default local Node 20 cannot load
  `jsdom` 30, so they were run with Node 24 (CI uses Node 26).

## Follow-ups

1. `pnpm lint:ci` fails on the upstream tip: `scripts/check-docs.mjs` imports
   `statSync` without using it. Owner: maintainer. Review by the next commit.
2. `cargo clippy --workspace --all-targets` fails on the upstream tip: 11
   `E0433` errors in `lissio-app`'s `models/catalog/tests.rs` because the panel
   module split moved `PanelKind` and friends, plus 10 pre-existing `float_cmp`
   assertions in `lissio-kind` and `lissio-performance`. None are in files this
   change touches. Owner: maintainer. Review by the next commit.
3. `cargo test --workspace` cannot complete until follow-up 2 is fixed, because
   `lissio-app`'s test target does not compile; the affected crates were tested
   on their own. Owner: maintainer. Review by the next commit.
