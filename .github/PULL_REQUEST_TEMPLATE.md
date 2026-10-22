<!-- lissio-doc
status: maintained
owner: Lissio maintainers
last-reviewed: 2026-10-07
applies-to: Pull request intake and verification checklist
-->
<!--
This checklist mirrors CONTRIBUTING.md. Do not claim a command passed unless it
was actually run successfully.
-->

## Motivation

<!-- Link the issue or explain the problem before describing the solution. -->

Closes #

## Scope

| Area | Changed |
| --- | --- |
| Rust crate (`server/crates/<domain>/<crate>`, or `server/<core\|physical\|data>/crates/<domain>/<crate>`) | |
| Frontend (`src/`) | |
| IPC, event contract, or wire type | |
| Protocol or transport adapter | |
| Documentation | |
| Dependency or third-party resource | |

Before changing Rust, read `server/docs/architecture/crates.md` and run
`pnpm architecture` to identify the owner and reverse dependencies.

## Verification

The checklist below is generated from `scripts/gates.mjs` (the single source of
truth). Tick what you actually ran. `pnpm check:ci-gates` verifies this block
stays in sync with the registry, CI, and the other documents.

<!-- lissio-gates:start -->

**Architecture and contracts**

- [ ] `pnpm check:architecture` — layout, `[package.metadata.lissio]` metadata, domain DAG, layer, adapter, and testkit rules, read from every Cargo workspace of the `server/` repository (`server/`, `server/core/`, `server/physical/`, and `server/data/`)
- [ ] `pnpm check:deps` — centralized third-party dependency versions inherited from each Cargo workspace root manifest across `server/`, `server/core/`, `server/physical/`, and `server/data/`
- [ ] `pnpm check:tauri-versions` — the Tauri npm packages and the `tauri`/`tauri-plugin-*` crates resolved in `client/src-tauri/Cargo.lock` share a major/minor, which `tauri dev` and `tauri build` require before they start
- [ ] `pnpm check:web-contract` — command surface (`rpc-api` SUPPORTED table versus actual dispatch) stays consistent
- [ ] `pnpm check:contracts` — generated TypeScript matches the Rust wire types byte for byte
- [ ] `pnpm check:device-contracts` — the interface, wire, profile, and runtime contracts frozen as `device-contracts-v1` still match their recorded hashes; a legitimate change is an explicit `--update` carrying a `contract:` subject
- [ ] `pnpm check:model-catalog` — catalog fixtures, contract version, and widget kind coverage
- [ ] `pnpm test` — the gate scripts and packaging helpers the umbrella owns keep their own unit tests, so a gate regression is caught by the suite that covers it
- [ ] `pnpm check:tokens` — color/opacity token unification plus the frosted-glass structural budget; see `client/docs/architecture/ui-color-tokens.md`
- [ ] `pnpm check:motion` — every `transition`/`@keyframes` property stays on the paint layer; layout animations run in C++ and are invisible to the browser probe, so only a static check can catch them
- [ ] `pnpm check:layers` — frontend implementation/interaction/effects/view layers must not cross their boundaries
- [ ] `pnpm check:docs` — LICENSE/NOTICE integrity, license fields across the workspace, documentation index and links, translation metadata, and review-record metadata; see `docs/governance/`
- [ ] `pnpm check:ci-gates` — documentation and `.forgejo` workflows match this file; keeps the gate list from being re-written by hand

**Frontend**

- [ ] `pnpm typecheck` — TypeScript compiles under strict mode
- [ ] `pnpm lint:ci` — lint with zero warnings tolerated
- [ ] `pnpm test:client` — frontend unit tests, colocated with the code they cover; the umbrella delegates with `test:client`

**Rust**

- [ ] `pnpm check:rust-size` — production Rust files in every `server/` crate root stay within 500 lines; test files and benches are exempt
- [ ] `(cd server && cargo fmt --check)` — formatting of the `server/` workspace has no diff
- [ ] `(cd server && cargo clippy --workspace --all-targets --locked)` — the `server/` workspace lints deny all/pedantic/nursery/cargo, and `--locked` fails on a `Cargo.lock` the manifest outgrew so a stale lockfile cannot pass here and break a `--locked` release build
- [ ] `(cd server && cargo test --workspace --locked)` — every test target of the `server/` workspace, including test-target compilation; `--locked` refuses to resolve a `Cargo.lock` the manifests outgrew; `server/core`, `server/physical`, and `server/data` are separate Cargo workspaces whose own repository CI runs their tests

**Release**

- [ ] `pnpm check:changes` — every change file declares a known package, a valid bump, and a declared tag, so covector cannot drop a release note silently; see `.changes/README.md`
- [ ] `pnpm check:release-sync` — the umbrella and client `package.json`, `client/src-tauri/tauri.conf.json`, every Cargo workspace root manifest (`server/`, `server/core/`, `server/physical/`, `server/data/`, `client/src-tauri/`), and the lockfiles they resolve agree on one version, and `CHANGELOG.md` carries that version; see `RELEASING.md`

**Frontend (slow: complete flow only)**

- [ ] `pnpm build:web` — production frontend build; catches bundling errors that type checking cannot see
- [ ] `pnpm test:e2e` — browser smoke tests; install with `pnpm exec playwright install --with-deps chromium`
- [ ] `bash scripts/perf-gate.sh` — measures per-frame cost in a real browser, then compares against the committed baseline; counts per frame, never wall-clock fps. `pnpm perf:baseline` overwrites the baseline and is only for an intended change; see `client/docs/performance/frontend-render-budget.md`

**Rust (slow: complete flow only)**

- [ ] `(cd server && cargo deny --locked check)` — advisories, licenses, bans, and sources for the `server/` workspace; requires cargo-deny 0.20.2, and `--locked` stops the audit from resolving a `Cargo.lock` the manifests outgrew

<!-- lissio-gates:end -->

- [ ] UI changes were opened and exercised in `pnpm dev:desktop`

Write "not run" and the reason here if a required toolchain is unavailable.

## Compatibility

- [ ] No contract change
- [ ] Rust serde owners and generated TypeScript were updated and compared
- [ ] Persisted files, IPC payloads, and configuration use only the current format
- [ ] User-visible, contract, packaging, or command changes are recorded as one
      change file in `.changes/` (`pnpm changes:add`), and `CHANGELOG.md` was not
      edited by hand

## Visual and interaction behavior

- [ ] No UI change
- [ ] UI screenshots cover light/dark themes and text scaling
- [ ] Motion follows `client/docs/architecture/ui-motion.md` and reduced-motion behavior
- [ ] User-visible strings were added to both i18n language directories

## Licensing and third parties

- [ ] No new third-party code, fonts, icons, data, or specification text
- [ ] New material has confirmed rights and is recorded in `docs/governance/third-party-licenses.md`
- [ ] New Rust dependencies use root `[workspace.dependencies]` and an allowed license
- [ ] License, attribution, and notice statements were preserved

## Risk and rollback

<!-- Describe affected behavior, rollback steps, and any manual operations. -->

## Contribution terms

Submitting this pull request confirms acceptance of `CLA.md` and that the
submitter has authority to provide the contribution.
