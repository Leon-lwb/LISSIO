# Lissio repository guide

<!-- lissio-doc
status: maintained
owner: Lissio maintainers
last-reviewed: 2026-10-08
applies-to: Repository development instructions
-->
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

## Commit messages

Commits use Conventional Commits: a `type(scope): summary` subject, an
explanatory body, and `Files:` / `Refs:` trailers when the change maps to a
known set of paths and issues.

```text
<type>(<scope>): <summary> (#issue)

<body: why the change is needed, what behavior changes, and the trade-off>

Files: path/one.rs,
       path/two.tsx
Refs: #4, #9
```

- `type` is `feat`, `fix`, `refactor`, `perf`, `docs`, `test`, `build`, `ci`, or
  `chore`; `scope` names the crate, directory, or surface, and is dropped when no
  single one fits.
- The summary names the change rather than the process, and the body carries what
  a reviewer cannot read off the diff. Write in English, and leave a blank line
  before the trailers.
- `Files:` lists every touched path, comma-separated with continuation lines
  aligned under the key. A repo-wide change describes its scope in the body
  instead.
- `Refs:` lists the issues or discussions the commit closes or advances.

## Release changes

Record user-visible, contract, packaging, and command changes as one change file
in `.changes/` (`pnpm changes:add` prompts for the package, bump, section, and
summary). `pnpm release:prepare` turns the accumulated files into the next
version and the `CHANGELOG.md` entry; never edit a version field or
`CHANGELOG.md` by hand. `RELEASING.md` owns the release sequence, and
`check:changes` / `check:release-sync` enforce the invariants along the way.

## Commands

The gate list below is generated from `scripts/gates.mjs`, which is the single
source of truth. `pnpm check:ci-gates` fails if this block, `CONTRIBUTING.md`, the
pull-request template, or the `.forgejo` workflows disagree with the registry.
Change the registry, then run `pnpm check:ci-gates --fix`.

<!-- lissio-gates:start -->

**Architecture and contracts**

- `pnpm architecture` — crate/domain/layer/responsibility/dependency inventory for finding the type owner; prints a report and never fails, so it is informational — `check:architecture` is the gate that enforces these rules
- `pnpm check:architecture` — layout, `[package.metadata.lissio]` metadata, domain DAG, layer, adapter, and testkit rules
- `pnpm check:deps` — centralized third-party dependency versions inherited from the root workspace
- `pnpm check:tauri-versions` — the Tauri npm packages and the `tauri`/`tauri-plugin-*` crates resolved in `src-tauri/Cargo.lock` share a major/minor, which `tauri dev` and `tauri build` require before they start
- `pnpm check:web-contract` — command surface (`rpc-api` SUPPORTED table versus actual dispatch) stays consistent
- `pnpm check:contracts` — generated TypeScript matches the Rust wire types byte for byte
- `pnpm check:model-catalog` — catalog fixtures, contract version, and widget kind coverage
- `pnpm check:tokens` — color/opacity token unification plus the frosted-glass structural budget; see `docs/architecture/ui-color-tokens.md`
- `pnpm check:motion` — every `transition`/`@keyframes` property stays on the paint layer; layout animations run in C++ and are invisible to the browser probe, so only a static check can catch them
- `pnpm check:layers` — frontend implementation/interaction/effects/view layers must not cross their boundaries
- `pnpm check:docs` — LICENSE/NOTICE integrity, license fields across the workspace, documentation index and links, and review-record metadata; see `docs/governance/`
- `pnpm check:ci-gates` — documentation and `.forgejo` workflows match this file; keeps the gate list from being re-written by hand

**Frontend**

- `pnpm typecheck` — TypeScript compiles under strict mode
- `pnpm lint:ci` — lint with zero warnings tolerated
- `pnpm test` — frontend unit tests, colocated with the code they cover

**Rust**

- `pnpm check:rust-size` — production Rust files stay within 500 lines; test files and benches are exempt
- `(cd src-tauri && cargo fmt --check)` — formatting has no diff
- `(cd src-tauri && cargo clippy --workspace --all-targets)` — workspace lints deny all/pedantic/nursery/cargo
- `(cd src-tauri && cargo test --workspace)` — every workspace test target, including test-target compilation

**Release**

- `pnpm check:changes` — every change file declares a known package, a valid bump, and a declared tag, so covector cannot drop a release note silently; see `.changes/README.md`
- `pnpm check:release-sync` — `package.json`, `tauri.conf.json`, `Cargo.toml`, and `Cargo.lock` agree on one version, and `CHANGELOG.md` carries that version; see `RELEASING.md`

**Frontend (slow: complete flow only)**

- `pnpm build:web` — production frontend build; catches bundling errors that type checking cannot see
- `pnpm test:e2e` — browser smoke tests; install with `pnpm exec playwright install --with-deps chromium`
- `bash scripts/perf-gate.sh` — measures per-frame cost in a real browser, then compares against the committed baseline; counts per frame, never wall-clock fps. `pnpm perf:baseline` overwrites the baseline and is only for an intended change; see `docs/performance/frontend-render-budget.md`

**Rust (slow: complete flow only)**

- `(cd src-tauri && cargo deny check)` — advisories, licenses, bans, and sources; requires cargo-deny 0.20.2

<!-- lissio-gates:end -->

That list is what CI runs — all of it, not a subset. Do not treat a green subset
as a green build. Two notes that do not fit the one-line form above:

- `pnpm generate:contracts` is a local step, not a gate: run it after a wire
  change to regenerate `src/types/generated`; CI verifies its output with
  `check:contracts`.
- `pnpm perf:baseline` overwrites the committed render baseline and is only for
  an intended change; the gate itself only compares.

Rust production files are limited to 500 lines; split implementation modules
without changing the stable crate API. No legacy-format compatibility: persisted
files, IPC payloads, and configuration are read and written in the current
format only — never migrate or accept data from older releases. Keep TypeScript
strict, use two-space indentation and single-quoted imports, and colocate
Vitest tests.

Never commit secrets or generated `dist/`, `target/`, or local application state.