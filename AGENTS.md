# Lissio repository guide

## Read before editing

Before changing Rust code, read `docs/architecture/crates.md` and run
`pnpm architecture`. Use its direct and reverse dependency columns to find the
type owner and affected crates.

## Layout

Lissio is a Tauri 2 application. React/TypeScript lives in `src/`; Rust is in
`src-tauri/`. Rust members use `src-tauri/crates/<domain>/<crate>`. The domain
directory is visual organization only; `[package.metadata.lissio]` records both
domain and dependency layer. The root `lissio` package is the sole composition
root and owns Tauri IPC modules under `src-tauri/src/commands/`.

## Dependency decisions

- A crate has one clear reason to change. Keep phases of one capability as
  private modules; `graph::compiler::{hir, plane, lower}` is the model.
- Create a crate only for an independent capability, dependency-inversion port,
  heavy optional adapter, or cross-crate test support.
- Dependencies may go to the same or any lower layer and must follow the domain
  DAG in `docs/architecture/crates.md`. Never add an adjacent-layer facade.
- L0-L3 cannot depend on Tauri, Keychain, `genai`, `rmcp`, `serialport`, `nusb`,
  or `wgpu`. Define a port below and inject its L4 implementation in `lissio`.
- Depend directly on the crate that defines a type. No facade-only crate,
  cross-crate glob re-export, repeated DTO, or public mutable lock.
- `graph-testkit` is dev-dependency only.
- Names describe responsibility. Do not use `lissio-*`, `vofa-*`, layer
  prefixes, or standalone `core`, `runtime`, `types`, or `common` for crates,
  lib targets, or directories. Only the crates.io package name is namespaced:
  it must be `lissio-` + the directory name (underscores as hyphens), remapped
  via `package =` in `[workspace.dependencies]` while dep keys keep the short
  name.
- A new crate requires metadata, documentation, architecture tests, and a root
  workspace dependency entry inherited by consumers.

## Commands

- `pnpm architecture` — crate/domain/layer/responsibility/dependency inventory
- `pnpm check:architecture` — layout, metadata, DAG, layer, adapter, and testkit rules
- `pnpm check:deps` — centralized third-party dependency versions
- `cd src-tauri && cargo fmt --check`
- `cd src-tauri && cargo clippy --workspace --all-targets`
- `cd src-tauri && cargo test --workspace`
- `cd src-tauri && cargo deny check`
- `pnpm typecheck && pnpm test && pnpm build`

Rust production files are limited to 500 lines; split implementation modules
without changing the stable crate API. Preserve serialization, command, event,
and persisted-file compatibility. Keep TypeScript strict, use two-space
indentation and single-quoted imports, and colocate Vitest tests.

Never commit secrets or generated `dist/`, `target/`, or local application state.
