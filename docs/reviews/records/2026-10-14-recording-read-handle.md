# Recording read handle review

<!-- lissio-review
date: 2026-10-14
scope: recording read-path discipline under Windows mandatory file locking, and the store reader contract it exposed
reviewer: implementation agent; maintainer sign-off pending
verdict: passed-with-conditions
-->

## Scope

Read `src-tauri/crates/data/recording/src/store.rs`, `read_model.rs`,
`writer.rs`, `writer/channel.rs`, `hub/spawn.rs`, `hub/wedge.rs`,
`tests/recording.rs`, `benches/storage.rs`, and
`docs/architecture/data-plane.md`. The subject is the one remaining Windows-only
test failure in `cargo test --workspace`:
`recording.rs::persists_and_queries_all_domains_without_loss`.

## Findings

- The failure was not a defect in the recording engine. Every read entry point is
  shaped `if let Some(reader) = self.reader() { reader.x() } else { block_on(private
  read-only connection) }`, and the store opened by that test had no reader: it
  passed `store.clone()` into `Recorder::start`, which attaches the reader to the
  store it keeps and hands the writer thread a `without_reader()` copy. The test
  then read through its own pre-`start` handle, so every query, export, and session
  check in it opened a second DuckDB handle while the writer held the file.
- Under Windows mandatory file locking that second handle fails with "another
  program is using this file", which is what the test reported at
  `history_page`. On the Linux CI checkout POSIX locking lets the same code pass,
  which is why this had never been seen.
- The documented contract already says which handle carries reads: the store the
  recorder owns (`Recorder::store`, exposed to product code as
  `RecordingHub::store`, asserted reader-bearing in `hub/wedge.rs`). Twenty-odd
  other tests in the same file construct through `RecordingHub` and read
  `hub.store()`.
- Blast radius of the direct-open pattern was measured, not assumed. Outside that
  one test it appears three times and never reads while a writer lives:
  `tests/recording.rs:187` passes the store by value and only appends,
  `tests/recording.rs:739` reopens a database whose writer has already stopped,
  and `benches/storage.rs:117` only appends. No product path opens a store
  directly; `hub/spawn.rs` is the only caller and it reads through the recorder.
- Chosen repair: the test now passes the store by value and rebinds the read handle
  to `recorder.store().clone()`, which is the same discipline the rest of the file
  already follows. The product keeps its fallback, which is correct for exactly the
  cases that rely on it (construction, repair, and a store reopened after the writer
  stopped — the last assertion of that same test).
- The rejected alternative was to share the reader slot across clones so any handle
  routes reads to the writer. It would legitimize a second way to obtain reads in
  the repository's most concurrency-sensitive crate, and it would change what
  happens after the writer stops: a stale clone would route into a dead channel
  where today it reads privately, so it needs slot-clearing or error-fallback
  semantics of its own. It also fixes no production call site.
- The limitation is now written down instead of inferred: the `reader` field
  comment in `store.rs` states that the fallback is invalid while a writer holds
  the file, and `docs/architecture/data-plane.md` gains it as structural invariant
  6 with the handle a read must use.
- Verified on this Windows host: `cargo test -p lissio-recording --test recording`
  reports 20 passed, 0 failed (it was 19 passed, 1 failed).
- While validating, `scripts/local-env.mjs` was also corrected: its runner forced
  the repository root as the working directory, which made the documented
  `node scripts/local-env.mjs <command…>` form unusable from `src-tauri`. It now
  keeps the caller's directory; package scripts are unaffected, because pnpm
  already runs them from the root.

## Follow-ups

1. Maintainer sign-off.
2. A read issued on a handle opened before `Recorder::start` will still fail on
   Windows rather than silently serializing. The comment and invariant 6 name the
   handle to use; a gate that forbids the shape would need to recognise store
   clones across the crate, which was judged not worth its false-positive rate.
   Owner: maintainers.
