# Dependency audit and lockfile enforcement review

<!-- lissio-review
date: 2026-10-21
scope: RustSec advisory remediation for the distrusted emSign roots, the stale data-suite lockfile, and the --locked assertions added to every cargo gate
reviewer: implementation agent; maintainer sign-off pending
verdict: passed-with-conditions
-->

## Scope

Reviewed the `cargo deny check` result that the W6 workstream left as its only
unmet gate, and the lockfile state underneath it:

- `server/Cargo.lock`, `server/data/Cargo.lock`, and `client/src-tauri/Cargo.lock`
  — the three lockfiles that resolve the affected TLS crates;
- `scripts/gates.mjs` and the five repository `scripts/ci.sh` files — the commands
  that decide whether a lockfile mismatch fails a pull request;
- `server/deny.toml` and `server/data/deny.toml` — read to confirm no advisory
  exception was added or widened.

The audit was run against a local snapshot of the RustSec advisory database
(965 crate directories, newest advisory dated 2026-10-20) because this network
resets HTTP/2 connections to `github.com`; the snapshot is the same data
`cargo-deny` would clone. The patched crates were resolved from a crates.io
mirror.

## Findings

- **The audit was not only a network problem.** With a reachable advisory
  database, `cargo deny check advisories` failed on three real advisories for
  distrusted emSign intermediates: `RUSTSEC-2026-0382` (`rustls-webpki`
  0.103.15), `RUSTSEC-2026-0383` (`webpki-root-certs` 1.0.9), and
  `RUSTSEC-2026-0381` (`webpki-roots` 1.0.9). Their private keys are published,
  so a certificate path through those intermediates could be accepted. The fix
  is a patch release in every case: 0.103.16, 1.0.10, and 1.0.10.
- **The patch moves three lockfiles, no manifest.** Reverse-dependency inspection
  reaches them through `reqwest` → `hyper-rustls` → `rustls` (AI, MCP, and update
  adapters), `rustls-platform-verifier` (Tauri), and `ureq` in the `libduckdb-sys`
  build. No dependency constraint, allow-list entry, source API, or advisory
  exception changed; `webpki-roots` 0.26.11 remains as the compatibility wrapper
  and resolves its parent to 1.0.10, which is the unaffected combination its
  advisory names.
- **`server/data/Cargo.lock` was already stale at `HEAD`.** `cargo metadata
  --locked` failed there before the security change: `lissio-data-model` gained
  `lissio-flow` in the catalog v3 contract change, and the data-suite lockfile was
  never regenerated. The refresh in this change carries that resolution, which is
  a record of work already shipped rather than a new dependency decision.
- **No gate asserted a lockfile, which is why the stale one survived.** Every
  cargo command in the five `scripts/ci.sh` files and in the umbrella's registry
  ran without `--locked`, so cargo resolved the outdated lockfile in place and
  reported success. The only command that would have failed is a `--locked`
  release build. The registry's clippy, test, and deny gates and all five scripts
  now pass `--locked`; `cargo fmt` cannot take the flag (it forwards unknown
  arguments to `rustfmt`) and reads no lockfile.
- **Verified, not assumed.** After the change `advisories ok, bans ok, licenses
  ok, sources ok` holds in `server/`, `server/core/`, `server/physical/`,
  `server/data/`, and `client/src-tauri/`; the remaining findings are the
  pre-existing duplicate-version and unmaintained-transitive warnings that
  `deny.toml` already documents. `cargo metadata --locked` succeeds in all four
  Rust workspaces plus the Tauri workspace, and `cargo check --locked` succeeds in
  `server/` and `server/data/`. The `--locked` assertion was confirmed to fail as
  intended: run against the stale lockfile, `cargo clippy --locked` and `cargo
  deny --locked check` both abort instead of resolving it.
- **`server/core` was not clippy-clean under its own workspace.** Running the
  repository's own gate rather than the umbrella's turned up two
  `clippy::pedantic` / `clippy::nursery` errors in
  `server/core/crates/shared/data-model/src/form_hints.rs`
  (`unnecessary_join`, `option_if_let_else`) that the W6 workstream left behind.
  They are invisible from `server/`: `core/` is a path dependency there, not a
  workspace member, so clippy never lints it, and the W6 verification that
  reported core green had exercised it through the server workspace only. The
  two functions now use `collect::<String>()` and `map_or_else`; behaviour and
  the derivation rules are unchanged.
- **The browser gate ran on a substitute binary.** The installed
  `playwright-core` 1.64.1 expects chromium revision 1248; this machine had 1243
  and the 1248 archive is unreachable from this network (`cdn.playwright.dev`
  returns 404 for that path, the `prss.microsoft.com` CDN name does not resolve,
  and the npm mirror stops at 1243). The 1243 build was linked at the 1248 path,
  and the suite then passed 15/15 with `perf-gate` green. This is an environment
  fact, not a repository change: CI installs the real 1248 with
  `pnpm exec playwright install --with-deps chromium`.

## Follow-ups

- The distrusted-roots advisories are closed by version, not by policy. Revisit
  when `rustls`, `webpki-roots`, or `rustls-platform-verifier` move again.
  Owner: Lissio maintainers. Trigger: the next dependency change or `cargo deny`
  finding.
- `client/src-tauri` carries no `deny.toml` and its CI runs no `cargo deny`; its
  advisories were audited here with the umbrella's configuration, which is a
  manual step rather than a gate. Owner: Lissio maintainers. Trigger: a decision
  to give the desktop shell its own audit configuration.
- Actual maintainer checklist review and commit signing remain separate from this
  agent review. Owner: Lissio maintainers. Due: before merge.
