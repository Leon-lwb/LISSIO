# Lissio repository guide

## Read before editing

Before changing Rust code, read `docs/architecture/crates.md` and run
`pnpm architecture`. Use its direct and reverse dependency columns to find the
type owner and affected crates.

## Layout

Lissio is an independent Rust backend delivered through a Tauri 2 desktop
shell, Web frontend, MCP server, and headless CLI. React/TypeScript lives in
`src/`; Rust is in `src-tauri/`. Rust members use
`src-tauri/crates/<domain>/<crate>`. The domain directory is visual
organization only; `[package.metadata.lissio]` records both domain and
dependency layer. `lissio`, `backend-server`, and `backend-cli` are composition
roots; `backend-host` owns shared product assembly, and the Tauri root only owns
platform-shell commands and supervised `lissio-server` lifecycle.

## Dependency decisions

- A crate has one clear reason to change. Keep phases of one capability in the
  responsibility crate that owns them; `graph` orchestrates the existing
  `kind`/`hir`/`plane`/`lower`/`eval` compiler crates through one facade.
- Create a crate only for an independent capability, dependency-inversion port,
  heavy optional adapter, or cross-crate test support.
- Dependencies may go to the same or any lower layer and must follow the domain
  DAG in `docs/architecture/crates.md`. Never add an adjacent-layer facade.
- L0-L3 cannot depend on Tauri, Keychain, `genai`, `rmcp`, `serialport`, `nusb`,
  or `wgpu`. Define a port below and inject its L4 implementation through
  `backend-host`, which every composition root reuses.
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
- `pnpm check:web-contract` — command surface (`rpc-api` SUPPORTED ↔ dispatch) consistency
- `pnpm check:contracts` — generated TypeScript must match the Rust wire types byte for byte
- `pnpm generate:contracts` — regenerate `src/types/generated` after a wire change; local
  step only, CI verifies its output via `check:contracts`
- `pnpm check:model-catalog` — catalog fixtures, contract version, and widget kind coverage
- `pnpm check:docs` — LICENSE/NOTICE integrity, license fields across the workspace,
  documentation index and links, review-record metadata; see `docs/governance/`
- `pnpm check:tokens` — color/opacity token unification (text/symbol layer) plus the
  frosted-glass structural budget; see `docs/architecture/ui-color-tokens.md`
- `pnpm check:motion` — every `transition`/`@keyframes` property must stay on the
  paint layer. Layout animations are invisible to the browser perf probe (they run
  in C++, not JS), so they can only be caught statically
- `pnpm typecheck`, `pnpm lint:ci` (zero warnings), `pnpm test`
- `pnpm build:web` — production frontend build
- `pnpm test:e2e` — Playwright browser smoke tests
- `pnpm perf:check` — frontend render budget: per-frame cost rates for interaction
  scenarios against a committed baseline. Gate counts per frame, never wall-clock fps
  (headless has no vsync); see `docs/performance/frontend-render-budget.md` before
  changing a budget or adding a scenario. `pnpm perf:baseline` overwrites the baseline
  and is only for an intended change.
- `cd src-tauri && cargo fmt --check`
- `cd src-tauri && cargo clippy --workspace --all-targets`
- `cd src-tauri && cargo test --workspace`
- `cd src-tauri && cargo deny check`

That list is what CI (`.github/workflows/build.yml`, job `quality`) runs — all of it,
not a subset. Do not treat a green subset as a green build.

Rust production files are limited to 500 lines; split implementation modules
without changing the stable crate API. No legacy-format compatibility: persisted
files, IPC payloads, and configuration are read and written in the current
format only — never migrate or accept data from older releases. Keep TypeScript
strict, use two-space indentation and single-quoted imports, and colocate
Vitest tests.

Never commit secrets or generated `dist/`, `target/`, or local application state.
