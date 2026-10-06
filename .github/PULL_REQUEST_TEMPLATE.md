<!-- lissio-doc
status: maintained
owner: Lissio maintainers
last-reviewed: 2026-10-07
language: en
authoritative: true
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
| Rust crate (`src-tauri/crates/<domain>/`) | |
| Frontend (`src/`) | |
| IPC, event contract, or wire type | |
| Protocol or transport adapter | |
| Documentation | |
| Dependency or third-party resource | |

Before changing Rust, read `docs/architecture/crates.md` and run
`pnpm architecture` to identify the owner and reverse dependencies.

## Verification

- [ ] `pnpm architecture`, `pnpm check:architecture`, `pnpm check:deps`
- [ ] `pnpm check:web-contract`, `pnpm check:contracts`, `pnpm check:model-catalog`, `pnpm check:tokens`
- [ ] `pnpm check:docs`
- [ ] `pnpm typecheck`, `pnpm lint:ci`, `pnpm test`, `pnpm build:web`, `pnpm test:e2e`
- [ ] `pnpm perf:check`
- [ ] `cargo fmt --check`, `cargo clippy --workspace --all-targets`, `cargo test --workspace`, `cargo deny check`
- [ ] UI changes were opened and exercised in `pnpm dev:desktop`

Write “not run” and the reason here if a required toolchain is unavailable.

## Compatibility

- [ ] No contract change
- [ ] Rust serde owners and generated TypeScript were updated and compared
- [ ] Persisted files, IPC payloads, and configuration use only the current format
- [ ] Public changes are recorded in `CHANGELOG.md`

## Visual and interaction behavior

- [ ] No UI change
- [ ] UI screenshots cover light/dark themes and text scaling
- [ ] Motion follows `docs/architecture/ui-motion.md` and reduced-motion behavior
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
