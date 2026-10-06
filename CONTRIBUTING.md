# Contributing to Lissio

<!-- lissio-doc
status: maintained
owner: Lissio maintainers
last-reviewed: 2026-10-07
language: en
authoritative: true
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

Repository conventions are maintained in `AGENTS.md`. Rust members are grouped
under `src-tauri/crates/<domain>/<crate>`. Before changing Rust, read
`docs/architecture/crates.md` and run `pnpm architecture` to identify the type
owner and affected dependents.

## Required checks

Run the complete quality surface before requesting review:

```bash
pnpm architecture
pnpm check:architecture
pnpm check:deps
pnpm check:web-contract
pnpm check:contracts
pnpm check:model-catalog
pnpm check:docs
pnpm typecheck
pnpm lint:ci
pnpm test
pnpm build:web
pnpm test:e2e
pnpm perf:check
cd src-tauri
cargo fmt --check
cargo clippy --workspace --all-targets
cargo test --workspace
cargo deny check
```

A passing subset is not a passing build. Document intentional baseline changes
instead of silently overwriting them.

## Pull requests

- Keep the change focused and explain the user-visible or architectural effect.
- Add or update tests for changed behavior.
- Update the authoritative English documentation when behavior, contracts,
  licensing, packaging, or commands change.
- Update Chinese backups through `docs/community/`; English controls if they
  disagree.
- Include screenshots or recordings for visual changes when practical.
- Do not commit `dist/`, `target/`, secrets, or local application state.

## Documentation

Documentation changes follow `docs/governance/documentation-standards.md` and
the review process in `docs/governance/document-review.md`. The authoritative
documentation is English. Chinese files are non-authoritative translations.

## Artificial intelligence

AI-generated contributions are allowed only after the submitter has reviewed,
tested, and understood every change. The human submitter is responsible for
correctness, licensing, attribution, and review responses.

## Licensing

The current source tree is Apache-2.0. Third-party code and resources must be
recorded in `docs/governance/third-party-licenses.md` before inclusion. Do not
copy external material without confirming its license and required notices.
