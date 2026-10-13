# Tauri npm and crate version alignment review

<!-- lissio-review
date: 2026-10-13
scope: Tauri npm package and Rust crate version alignment restoring pnpm dev:desktop, and the gate added to keep them aligned
reviewer: implementation agent; maintainer sign-off pending
verdict: passed-with-conditions
-->

## Scope

Read the repository guides and documentation (root `AGENTS.md`, `docs/`,
`RELEASING.md`, `CONTRIBUTING.md`, `.changes/`), the Tauri CLI version check
itself (`tauri-cli` 2.12.1 `info::plugins::check_mismatched_packages` and its
`cargo_manifest`/`npm` helpers), `package.json`, `pnpm-lock.yaml`,
`src-tauri/Cargo.lock`, `src-tauri/deny.toml`, and the third-party inventory. The
reported failure is `pnpm dev:desktop` aborting with "Found version mismatched
Tauri packages".

## Findings

- The failure is not a compile error. `tauri-cli` compares every Tauri npm
  package with its Rust crate and exits before it builds. The crate version comes
  from `src-tauri/Cargo.lock`; the npm version comes from the version installed
  under `node_modules` (for pnpm the CLI resolves it with
  `pnpm list <name> --parseable --depth 0`). Only `major.minor` is compared, and
  only for pairs where both sides exist.
- At `d7f37e22` the drift was `tauri` 2.11.5 / `tauri-plugin-opener` 2.5.5
  against `@tauri-apps/api` 2.12.1 / `@tauri-apps/plugin-opener` 2.7.0. The npm
  side was raised in `cac85aad` without a matching Rust update, while the
  lockfile had resolved `tauri` 2.11.5 since 2026-09-29. Both mismatched pairs
  and the three consistent pairs (`plugin-dialog` 2.7.3, `plugin-fs` 2.5.2,
  `plugin-process` 2.3.1) match the CLI's pairing rule exactly.
- The Rust side was moved up to satisfy it: `tauri` 2.12.3, `tauri-build`,
  `tauri-codegen` and `tauri-macros` 2.7.2, `tauri-plugin` and
  `tauri-plugin-opener` 2.7.1, `tauri-runtime` and `tauri-runtime-wry` 2.12.1,
  `tauri-utils` 2.10.1, with the transitive stack (tao 0.37.1, muda 0.20.0,
  tray-icon 0.25.1, wry 0.57.0, webview2-com 0.39.1). `src-tauri/Cargo.lock`
  changed 338 lines; no manifest and no Rust source changed.
- `pnpm exec tauri info` no longer prints the mismatch, and the new gate passes.
- `scripts/check-tauri-versions.mjs` is registered as the PR-tier gate
  `check-tauri-versions` in `scripts/gates.mjs`, with its `package.json` script
  and regenerated blocks in `AGENTS.md`, `CONTRIBUTING.md` and the pull-request
  template. It reads the two sources the CLI reads. Verified against four
  fixture trees: the exact reported mismatch fails, an aligned pair passes, a
  patch-only difference passes, and a declared-but-uninstalled package fails.
- Nothing covered this class before. `pnpm check:deps` checks Rust manifest
  inheritance only, and `pnpm dev:desktop` is deliberately not a gate
  (`NON_GATE_SCRIPTS`), so the tree passed while the command could not start.
- Rust verification passed on the upgraded graph: `cargo clippy --workspace
  --all-targets` exit 0 with only the pre-existing `unknown lint:
  clippy::assert_is_empty` toolchain warning and one pre-existing dead-code
  warning in a device-tree test support module, and `cargo deny check` reports
  "advisories ok, bans ok, licenses ok, sources ok".
- The rest of the PR-tier surface was run on this Windows host. Passing:
  `check:tauri-versions`, `check:architecture`, `check:deps`, `check:rust-size`,
  `check:web-contract`, `check:model-catalog`, `check:changes`,
  `check:release-sync`, `check:motion`, `check:layers`, `typecheck`, `lint:ci`,
  `test`, `cargo fmt --check`, `cargo clippy --workspace --all-targets` and
  `cargo deny check`. Five failures surfaced in the same session; each was
  reproduced as independent of this change and is repaired by the
  check-portability change recorded in
  [2026-10-13-check-platform-portability.md](2026-10-13-check-platform-portability.md):
  - `cargo test --workspace` first failed inside `libduckdb-sys`'s bundled DuckDB
    build, reported as `cl.exe` D8050. Command-line length is not the cause: the
    same 5.5 kB command compiles when it can write a temporary file, and under
    the cargo build the much shorter `ring` compile failed identically. Those
    child processes cannot create the compiler's temporary debug records because
    writes outside the checkout are denied to them; pointing `TMP`/`TEMP` inside
    the checkout repairs it.
  - `pnpm check:contracts` exports into `%TEMP%`. Run by hand, the exporter
    writes 190 files and exits 0 when `TS_RS_EXPORT_DIR` points inside the
    workspace, and writes nothing but an IO error when it points at `%TEMP%` —
    the same confinement. It now exports into the gitignored `src-tauri/target`.
  - `pnpm check:docs` compared `LICENSE` against the canonical Apache-2.0 digest
    without normalizing line endings. With `core.autocrlf=true` the checkout is
    CRLF (`sha256 1eb85fc9…`) while the canonical LF text hashes to `c71d239d…`
    exactly. `LICENSE` is unmodified.
  - `pnpm check:ci-gates` found no runner label because its code-fence pattern
    was LF-only against the CRLF `docs/ci.md`, which then reported five workflow
    label mismatches against a `null` expectation.
  - `pnpm check:tokens` reported 17 violations in `src/styles/theme.css` and
    `src/styles/component-tokens.css` — precisely the two files its own
    exemptions exclude. `path.relative` returns backslashes on Windows, so the
    exemptions never matched.
- `cargo deny` also reports unused advisory ignores. Comparing the pre-change and
  post-change lockfiles isolated five `rust-unic` entries (`RUSTSEC-2025-0075`,
  `-0080`, `-0081`, `-0098`, `-0100`) as newly dead: `urlpattern` 0.6.0 no longer
  depends on the `unic` family, so their comment named a dependency path that no
  longer exists. The entries were removed from `deny.toml`. The ten
  `RUSTSEC-2024-0411`–`-0420` gtk3 entries report `advisory-not-detected` on both
  locks; that is pre-existing and was left unchanged.
- The Rust license snapshot in `docs/governance/third-party-licenses.md` was
  regenerated from `cargo metadata`: 766 external crates (was 772), `MIT` 164
  (163), `Apache-2.0 OR MIT` 64 (66), `MIT/Apache-2.0` 29 (34), the remaining
  rows unchanged. The counting method was validated first by reproducing all ten
  published figures from the pre-change lockfile exactly.
- One change file records the fix; version fields and `CHANGELOG.md` were not
  edited.

## Follow-ups

1. Maintainer sign-off on the dependency upgrade and on the new gate. Owner:
   maintainers.
2. Launch `pnpm dev:desktop` in a real desktop session. The version check was
   verified through `tauri info`, which runs the same code path, but the GUI
   development launch itself was not run in this environment. Owner:
   maintainers.
3. The line-ending, path-separator, and export-directory failures listed above
   are repaired in the check-portability change; on a confined Windows host
   `cargo test --workspace` additionally needs `TMP`/`TEMP` inside the checkout,
   which is a host property and carries no repository change. See
   [2026-10-13-check-platform-portability.md](2026-10-13-check-platform-portability.md).
   Owner: maintainers.
4. The upgrade leaves two `window-vibrancy` versions in the graph (0.6.0 for the
   shell, 0.8.1 for `tauri` 2.12). `[bans] multiple-versions = "warn"` permits
   this; deduplicating it would change shell code and was not attempted. Owner:
   maintainers.
