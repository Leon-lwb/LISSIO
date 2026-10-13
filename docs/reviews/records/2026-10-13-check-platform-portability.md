# Check portability and confinement review

<!-- lissio-review
date: 2026-10-13
scope: platform and confinement portability of the documentation, gate, token, and contract checks
reviewer: implementation agent; maintainer sign-off pending
verdict: passed-with-conditions
-->

## Scope

Read `scripts/check-docs.mjs`, `scripts/check-ci-gates.mjs`,
`scripts/check-ui-tokens.mjs`, `scripts/check-contracts.mjs`, the gate registry
`scripts/gates.mjs`, `.changes/README.md`, and `docs/governance/document-review.md`.
The subject is the four PR-tier checks that failed on a Windows checkout with
`core.autocrlf=true` inside a confined environment while passing on the Linux CI
checkout, plus the environment failure that blocked `cargo test --workspace`.

## Findings

- `check:docs` hashed `LICENSE` byte for byte against the canonical Apache-2.0
  digest. `core.autocrlf=true` rewrites the working copy to CRLF, so the digest
  was `1eb85fc9…` while the canonical LF text hashes to `c71d239d…`; `LICENSE`
  itself was unmodified. The check now normalizes line endings first, which is
  what `check-contracts.mjs` already does for the generated contracts.
- `check:ci-gates` extracted the runner registration with an LF-only code-fence
  pattern. Against the CRLF `docs/ci.md` it matched no block, so the documented
  runner label read as `null` and all four workflow jobs were reported as pinned
  to an unregistered label. The same LF assumption would also have reported the
  three generated gate blocks as out of date on a fresh CRLF checkout, and
  `--fix` spliced LF content into CRLF documents. The fence pattern is now
  CRLF-tolerant, the block comparison ignores line endings, and `--fix` rewrites
  each document with one consistent line ending.
- `check:tokens` used `path.relative(...)` — `src\styles\theme.css` on Windows —
  for exemptions written as `endsWith('styles/theme.css')`. The exemptions
  therefore never matched, and the two exempt files were checked as ordinary
  component files: 17 reports, all inside `theme.css` and
  `component-tokens.css`, with no real violation. The normalized path the script
  already computed is now used for every path predicate, including the
  `__tests__` and `.test.`/`.spec.` test-file exemption.
- `check:contracts` exported into `mkdtempSync(tmpdir(), …)`. The exporter is a
  child process, and this environment denies those processes writes outside the
  checkout: with `TS_RS_EXPORT_DIR` under `%TEMP%` the exporter wrote 0 files and
  reported an IO error for every type; pointed inside the workspace it wrote 190
  files and exited 0 with no other change. It now exports into the gitignored
  `src-tauri/target/contracts-check-*` and removes that directory afterwards, so
  the check no longer depends on where the checkout is allowed to write.
- The same confinement explains the `cl.exe` D8050 failures that blocked
  `cargo test --workspace`. The message reads as a command-line limit, but length
  is not the cause: `ring`'s much shorter C compile failed identically, and the
  5.5 kB DuckDB compile succeeds from a shell that can write temporary files.
  MSVC needs a writable directory for its temporary debug records; with `TMP` and
  `TEMP` inside the checkout, `ring` rebuilt in 3.7 s. This is a property of the
  confined host session, not of the repository, and it does not affect CI.
- With the temp directory relocated, `cargo test --workspace` builds and runs on
  this host for what appears to be the first time: the bundled DuckDB C++ build
  completes (341 objects and `duckdb.lib`), and every test binary that ran passed
  except `lissio-recording`'s
  `recording.rs::persists_and_queries_all_domains_without_loss`. It fails at
  `store.history_page(...)` with DuckDB's "Cannot open file …: another program is
  using this file". `RecordingStore::open` leaves `reader: None` — the documented
  fallback in which reads "degrade to a private connection" — while the writer
  task holds the same file, and Windows' mandatory locking rejects the second
  handle. The failure reproduces with the temp directory inside
  `src-tauri/target` and inside the repository root alike, so it is not an
  artifact of the relocation, and neither the crate nor any of its dependencies
  differs from HEAD. It is a pre-existing, Windows-only defect in the recording
  read path; POSIX locking lets the same code pass on the Linux CI checkout.
- The same run failed three doctests (`lissio-filter`, `lissio-schema-types`,
  `lissio-spectrum`) with `link.exe` LNK2001 for `__CxxFrameHandler3` rather than
  a test assertion. Tauri's build script replaces `msvcrt.lib` in its output
  directory with an 82-byte stub so the app links the static CRT without that
  symbol; `tauri-build` 2.6.3 wrote the stub into a reused
  `target/debug/build/lissio-*/out`, and 2.7.2 writes a content-hashed name
  instead but never removes the old file. The stale stub stays on the doctest link
  search path and shadows the real `msvcrt.lib`. Deleting the two stale stubs made
  the doctest pass, and neither was recreated, so this is leftover build state
  from the upgrade rather than a source defect.
- No product source, wire contract, or user-visible behaviour changed. All four
  fixes are confined to check scripts, and the change file records them as
  `noop:ci`.

## Follow-ups

1. Maintainer sign-off.
2. Anyone running the Rust gates inside a confined or sandboxed Windows host must
   point `TMP` and `TEMP` at a writable path inside the checkout, or MSVC fails
   with D8050 before the first test runs. No repository change can carry that,
   and CI is unaffected. Owner: maintainers.
3. The generated gate blocks are now compared with line endings normalized, so a
   mixed-ending document no longer reports drift; `pnpm check:ci-gates --fix`
   normalizes it to one ending. Owner: maintainers.
4. Decide whether the recording read path should keep the "private connection"
   fallback: under Windows mandatory locking it cannot work while a writer holds
   the file, so `RecordingStore::open` plus `Recorder::start` must either route
   reads through the writer's single connection or the test must construct its
   store through `RecordingHub`. Pre-existing and platform-specific; out of scope
   for the check-portability change. Owner: maintainers.
5. Pulling the `tauri-build` upgrade onto a Windows machine with an existing
   `target/` leaves a stale `msvcrt.lib` stub in each reused
   `target/debug/build/lissio-*/out`. Delete those files, or run
   `cargo clean -p lissio`, when unrelated doctests fail with LNK2001 for
   `__CxxFrameHandler3`. No repository change can carry this. Owner: maintainers.
