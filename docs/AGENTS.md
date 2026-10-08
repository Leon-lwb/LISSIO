# Lissio Documentation Development Guide

<!-- lissio-doc
status: maintained
owner: Lissio maintainers
last-reviewed: 2026-10-08
applies-to: Documentation-area development and review instructions
-->

The root [`AGENTS.md`](../AGENTS.md) is authoritative for repository
development. This file covers documentation work under `docs/` and related
project documents.

## Documentation authority

Repository prose is written in English; the translated documentation backups
were removed. Historical review records are immutable and retain their original
language. Product localization (`src/i18n/resources/zh/` and the runtime
capability help under `capabilities/docs/zh/`) is a shipped surface, not
documentation.

Do not change implementation facts without checking the owning code,
configuration, generated contracts, or tests. Every document names its
authoritative source.

## Before changing Rust or wire contracts

Read [`architecture/crates.md`](architecture/crates.md) and run
`pnpm architecture`. Identify the defining crate and reverse dependencies.
Update Rust owners, generated TypeScript, callers, and fixtures together.

## Documentation workflow

1. Update the authoritative English document.
2. Register new documents in [`README.md`](README.md).
3. Update `last-reviewed`.
4. Run `pnpm check:docs`.
5. Complete [`reviews/checklist.md`](reviews/checklist.md).
6. Add a record under `reviews/records/` and index it in
   [`reviews/README.md`](reviews/README.md).

## Quality gates

Run the complete command set in [`../CONTRIBUTING.md`](../CONTRIBUTING.md). For
documentation-only changes, `pnpm check:docs` is mandatory and all affected
link, contract, architecture, and release checks must also pass.

## Writing rules

- Use clear English prose and stable technical identifiers.
- Do not include process markers, task numbers, phase numbers, or future-work
  narration in current documentation.
- Use tables for comparisons and labeled code blocks.
- Keep policy in `governance/`, architecture facts in `architecture/`, and
  historical judgments in `reviews/records/`.
- Do not duplicate machine-checkable facts.

## License and branding

The current source tree is Apache-2.0. Historical GPL releases retain their
original terms. VOFA+ and `vofa` names are limited to protocol compatibility,
internal identifiers, and third-party attribution.
