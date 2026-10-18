# Contributing to Lissio

<!-- lissio-doc
status: maintained
owner: Lissio maintainers
last-reviewed: 2026-10-16
applies-to: Issue, pull request, documentation, and release contributions
-->

Thank you for helping improve Lissio. By submitting a contribution, you agree to
`CLA.md` and the Apache-2.0 terms for the current source tree.

## Before you start

- Search existing issues and documentation before opening a new issue.
- Use a focused issue for bugs, feature proposals, security reports, or
  documentation corrections.
- Never include credentials, private keys, device captures containing secrets,
  or local application state.
- Security and intellectual-property reports must follow `SECURITY.md`, not a
  public issue.

## Development setup

Install a current pnpm release, the stable Rust toolchain, and platform packages
required by Tauri 2. Then run:

```bash
pnpm install
pnpm dev:desktop
```

The desktop mode in [`scripts/local-env.mjs`](scripts/local-env.mjs), invoked by
`pnpm dev:desktop`, keeps the Windows WebView2 browser profile in
`output/desktop-webview`, separate from the installed application's profile.
This avoids startup failures caused by an inaccessible or occupied application
profile. The directory is reused across restarts; browser-stored layout and
preferences start fresh on the first run. Backend settings and recordings keep
their existing location. An explicit `WEBVIEW2_USER_DATA_FOLDER` takes precedence.

Repository conventions are maintained in `AGENTS.md`. Rust members are grouped
under `server/crates/<domain>/<crate>` (or `<submodule>/crates/<domain>/<crate>` for the `core/`, `physical/`, and `data/` submodules). Before changing Rust, read
`server/docs/architecture/crates.md` and run `pnpm architecture` to identify the type
owner and affected dependents.

`pnpm build:all` builds the headless binaries and desktop installers. Release
builds disable debug information and strip symbols from both the desktop shell
and its server sidecar; on Linux, embedded DWARF would otherwise dominate the
deb and AppImage sizes. AppImage also bundles WebKit/GTK libraries, so it remains
larger than the deb package, which uses system dependencies.

For optimized performance analysis with full symbols, use the separate
`profiling` profile:

```bash
cargo build --manifest-path server/Cargo.toml --profile profiling -p lissio-backend-server
```

The executable is written to `server/target/profiling/lissio-server` (with
`.exe` on Windows). Development and benchmark builds retain their debug information;
the benchmark audit script continues to disable it explicitly.

## Required checks

Run the complete quality surface before requesting review. The list is generated
from `scripts/gates.mjs` (the single source of truth); `pnpm check:ci-gates`
verifies that this file, `AGENTS.md`, the pull-request template, and the
`.forgejo` workflows all agree with it.

<!-- lissio-gates:start -->

**Architecture and contracts**

- `pnpm check:architecture` — layout, `[package.metadata.lissio]` metadata, domain DAG, layer, adapter, and testkit rules, read from every Cargo workspace of the `server/` repository (`server/`, `server/core/`, and `server/data/`)
- `pnpm check:deps` — centralized third-party dependency versions inherited from each Cargo workspace root manifest across `server/`, `server/core/`, and `server/data/`
- `pnpm check:tauri-versions` — the Tauri npm packages and the `tauri`/`tauri-plugin-*` crates resolved in `client/src-tauri/Cargo.lock` share a major/minor, which `tauri dev` and `tauri build` require before they start
- `pnpm check:web-contract` — command surface (`rpc-api` SUPPORTED table versus actual dispatch) stays consistent
- `pnpm check:contracts` — generated TypeScript matches the Rust wire types byte for byte
- `pnpm check:model-catalog` — catalog fixtures, contract version, and widget kind coverage
- `pnpm test` — the gate scripts and packaging helpers the umbrella owns keep their own unit tests, so a gate regression is caught by the suite that covers it
- `pnpm check:tokens` — color/opacity token unification plus the frosted-glass structural budget; see `client/docs/architecture/ui-color-tokens.md`
- `pnpm check:motion` — every `transition`/`@keyframes` property stays on the paint layer; layout animations run in C++ and are invisible to the browser probe, so only a static check can catch them
- `pnpm check:layers` — frontend implementation/interaction/effects/view layers must not cross their boundaries
- `pnpm check:docs` — LICENSE/NOTICE integrity, license fields across the workspace, documentation index and links, translation metadata, and review-record metadata; see `docs/governance/`
- `pnpm check:ci-gates` — documentation and `.forgejo` workflows match this file; keeps the gate list from being re-written by hand

**Frontend**

- `pnpm typecheck` — TypeScript compiles under strict mode
- `pnpm lint:ci` — lint with zero warnings tolerated
- `pnpm test:client` — frontend unit tests, colocated with the code they cover; the umbrella delegates with `test:client`

**Rust**

- `pnpm check:rust-size` — production Rust files in every `server/` crate root stay within 500 lines; test files and benches are exempt
- `(cd server && cargo fmt --check)` — formatting of the `server/` workspace has no diff
- `(cd server && cargo clippy --workspace --all-targets)` — the `server/` workspace lints deny all/pedantic/nursery/cargo
- `(cd server && cargo test --workspace)` — every test target of the `server/` workspace, including test-target compilation; `server/core` and `server/data` are separate Cargo workspaces whose own repository CI runs their tests

**Release**

- `pnpm check:changes` — every change file declares a known package, a valid bump, and a declared tag, so covector cannot drop a release note silently; see `.changes/README.md`
- `pnpm check:release-sync` — the umbrella and client `package.json`, `client/src-tauri/tauri.conf.json`, every Cargo workspace root manifest (`server/`, `server/core/`, `server/data/`, `client/src-tauri/`), and the lockfiles they resolve agree on one version, and `CHANGELOG.md` carries that version; see `RELEASING.md`

**Frontend (slow: complete flow only)**

- `pnpm build:web` — production frontend build; catches bundling errors that type checking cannot see
- `pnpm test:e2e` — browser smoke tests; install with `pnpm exec playwright install --with-deps chromium`
- `bash scripts/perf-gate.sh` — measures per-frame cost in a real browser, then compares against the committed baseline; counts per frame, never wall-clock fps. `pnpm perf:baseline` overwrites the baseline and is only for an intended change; see `client/docs/performance/frontend-render-budget.md`

**Rust (slow: complete flow only)**

- `(cd server && cargo deny check)` — advisories, licenses, bans, and sources for the `server/` workspace; requires cargo-deny 0.20.2

<!-- lissio-gates:end -->

A passing subset is not a passing build. Document intentional baseline changes
instead of silently overwriting them. The full surface in one command is
`pnpm check:all`; `pnpm check:all --quick` runs the PR-tier gates only.

## Pull requests

- Keep the change focused and explain the user-visible or architectural effect.
- Add or update tests for changed behavior.
- Record every user-visible, contract, packaging, or command change as one change
  file in `.changes/` (`pnpm changes:add` prompts for it; see
  `.changes/README.md`). The release version and the `CHANGELOG.md` entry are
  generated from those files, so do not edit `CHANGELOG.md` by hand.
- Update the authoritative English documentation when behavior, contracts,
  licensing, packaging, or commands change.
- Include screenshots or recordings for visual changes when practical.
- Do not commit `dist/`, `target/`, secrets, or local application state.

## Documentation

Documentation changes follow `docs/governance/documentation-standards.md` and
the review process in `docs/governance/document-review.md`. Repository prose is
written in English and the English file stays authoritative; the product README
additionally ships a [`README.zh-CN.md`](./README.zh-CN.md) translation that
declares its language and source in metadata.

## Artificial intelligence

AI-generated contributions are allowed only after the submitter has reviewed,
tested, and understood every change. The human submitter is responsible for
correctness, licensing, attribution, and review responses.

## Licensing

The current source tree is Apache-2.0. Third-party code and resources must be
recorded in `docs/governance/third-party-licenses.md` before inclusion. Do not
copy external material without confirming its license and required notices.
