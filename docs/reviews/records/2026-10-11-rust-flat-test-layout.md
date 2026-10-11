# Rust flat test-layout review

<!-- lissio-review
date: 2026-10-11
scope: Moving every Rust unit test out of a per-module `tests.rs` directory into a flat `<module>_tests.rs` file, the rewritten Test layout section of docs/architecture/crates.md, and the architecture-gate rule that enforces both
reviewer: implementation agent; maintainer sign-off pending
verdict: passed-with-conditions
-->

## Scope

Reviewed the change that completes the in-flight Rust test extraction without
adding directories:

- 139 test-only directories removed: 135 created by the in-flight extraction and
  4 pre-existing tracked ones (`app/src/models/describe`,
  `app/src/models/prepare`, `control-api/src/panel_data`,
  `pipeline/src/runtime/tickers`);
- 140 flat test files created: 134 `<module>_tests.rs` files plus 6 named suites
  in 5 directories (`types_adapter_registry_tests.rs`,
  `transport_ops_bitrate_tests.rs`,
  `protocol_node_state_sample_clock_tests.rs`, `backend_flow_tests.rs`,
  `backend_typed_flow_tests.rs`, `filter_ipc_serde_tests.rs`);
- 139 module files rewritten to declare the moved suite as
  `#[cfg(test)] #[path = "<file>"] mod <name>;`; the `#[path]` attribute keeps
  the `use super::*` chain, so no test needed a visibility change;
- the rewritten Test layout section of
  [`../../architecture/crates.md`](../../architecture/crates.md), and the
  test-only-directory rule in
  [`../../../scripts/check-crate-architecture.mjs`](../../../scripts/check-crate-architecture.mjs).

## Findings

- The repository had two test layouts at once: a flat `*_tests.rs` convention
  (`compile_tests.rs`, `equiv_tests.rs`, `rtu_tests.rs`, `device_tree_tests.rs`)
  and the directory convention this extraction introduced. The flat convention
  now applies everywhere a module does not already own a directory.
- The rule is "tests never add a directory", not "tests are always one kind of
  file": a module that already owns a directory keeps `src/<module>/tests.rs`
  (`str_op`, `widgets`, `measure`, `catalog`, `stream`, `server`), and a crate
  root keeps the single module file `src/tests.rs`, whose child suites live in
  `src/tests/`.
- All 142 `#[path]` attributes now resolve (140 new test declarations plus the 2
  pre-existing `production_support.rs` and `source_ports.rs`); a byte-for-byte
  copy preserved every test body, and `cargo test --workspace` compiles and runs
  them.
- The architecture gate fails on both violations and was probed with injected
  offenders: a test-only directory and an inline `#[cfg(test)] mod tests { ... }`
  each produced exactly one error, and both probes were removed afterwards.
- `pnpm check:architecture`, `pnpm check:rust-size`, and `pnpm check:docs` pass;
  the size script already exempted flat `tests.rs` and `*_tests.rs` files, so
  its change is comment-only.
- `cargo test --workspace` passes 1512 tests with 0 failures and 2 ignored;
  `cargo fmt --check` is clean and `cargo clippy --workspace --all-targets`
  exits 0. Clippy still reports two pre-existing warnings outside this change
  (`device-tree/tests/support/mod.rs` `TestRuntime` dead code, and the
  `AiError` import in `ai-host/src/secret_tests.rs` that is only used under
  `cfg(target_os = "macos")`), plus the pre-existing unknown-lint warning for
  `clippy::assert_is_empty` in `src-tauri/Cargo.toml`.
- No production behavior, public API, wire contract, or dependency edge
  changed; the diff is file moves, `#[path]` declarations, two gate scripts, and
  the architecture document.

## Follow-ups

- `scripts/check-crate-size.mjs` still skips any directory named `target`
  (rather than Cargo's `CACHEDIR.TAG`-marked build directory, as the
  architecture gate now does). No production file currently sits in a directory
  named `target`, so this is latent only. Owner: maintainers; fix with the next
  change to that script.
- The abstraction-unification survey requested alongside this cleanup is
  delivered separately; its accepted candidates are recorded in the cleanup
  register before implementation.
