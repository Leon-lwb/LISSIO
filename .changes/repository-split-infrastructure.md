---
"lissio": minor:changed
---

Re-pointed the umbrella's cross-repository infrastructure at the five-repository
split, and made the umbrella manifest an orchestration entry point rather than a
duplicate of the frontend's.

- The umbrella root now owns only the cross-repository surface: the registry and
  its drivers, the Dockerfile, Playwright, the release and packaging scripts, and
  the change files. `dev`, `dev:web`, `typecheck`, `lint`, `test`, `build:web`,
  and `tauri` delegate with `pnpm --dir client`, so `pnpm test` still means "the
  frontend unit tests" from the root while the frontend keeps its own
  dependencies and lockfile. A root `pnpm install` no longer installs them.
- Rust moved from `src-tauri/` to the `server/` submodule, whose `core/`,
  `physical/`, and `data/` directories are submodules of their own; the frontend
  and the Tauri shell moved to `client/`, and the product integration suites to
  `server/crates/desktop/backend-host/tests/`. Every gate, script, cache key,
  ignore rule, and container stage now reads those locations. `server/`,
  `server/core/`, and `server/data/` are three separate Cargo workspaces: the
  registry's `cargo fmt`/`clippy`/`test`/`deny` gates run in `server/`, while the
  other two are covered by their own repositories' CI — which the registry now
  states, and `check:ci-gates` verifies by refusing to let one of them stop being
  a separate workspace without a registry change. `check:architecture`,
  `check:deps`, `check:docs`, and `check:rust-size` read all three workspaces.
- The release version is checked where it now lives: the umbrella and client
  `package.json`, `client/src-tauri/tauri.conf.json`, every Cargo workspace root
  manifest (a virtual manifest keeps it in `[workspace.package]`), and each
  workspace's lockfile. `pnpm set-version` writes all of them.
- The gates that belong to one repository (`architecture`, `check:architecture`,
  `check:deps`, `check:rust-size`, `check:layers`, `check:tokens`, `check:motion`,
  `gen-motion-docs`, `check:docs`) share one root convention: they default to the
  repository that contains the script and accept `--root=<path>`, so the copy that
  moves into `server/`, `client/`, `server/core/`, or `server/data/` needs no
  arguments. Inside the umbrella the same files resolve `server/` for Rust and
  `client/` for the frontend, which preserves their pre-split behaviour. The
  cross-repository gates (`check:contracts`, `check:web-contract`,
  `check:model-catalog`, `check:tauri-versions`, `check-release-sync`) stay here
  and read both sides explicitly.
- `Dockerfile` builds the web stage from `client/` and the server stage from
  `server/`, which brings the nested submodules in with it; the runtime stage
  copies `server/target/release/{lissio-server,backend-cli}` and `client/dist`.
- The Forgejo workflows check the submodules out recursively and install both the
  umbrella's and the client's dependencies: the PR and full tiers read Rust and
  frontend sources, so a checkout without the submodules would have run the gates
  over empty directories. Documentation links that pointed into the old root
  (`docs/architecture/*.md` → `src/`, `src-tauri/`) now point at `client/` and
  `server/`, and `docs/architecture/crates.md` records the new physical layout and
  the three-workspace split.

Trade-off: the umbrella's own script self-tests (`scripts/*.test.mjs`) still use
Vitest, which now lives with the frontend; they move with the gates that own them.

Files: package.json,
       pnpm-lock.yaml,
       pnpm-workspace.yaml,
       .gitignore,
       .dockerignore,
       Dockerfile,
       scripts/,
       .forgejo/,
       e2e/,
       playwright.config.ts,
       docs/ci.md,
       AGENTS.md,
       CONTRIBUTING.md,
       .github/PULL_REQUEST_TEMPLATE.md
