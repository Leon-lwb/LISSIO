# Lissio Documentation Development Guide

<!-- lissio-doc
status: maintained
owner: Lissio maintainers
last-reviewed: 2026-10-18
applies-to: Documentation-area development and review instructions
-->

The root [`AGENTS.md`](../AGENTS.md) is authoritative for repository
development. This file covers documentation work under the umbrella's `docs/` and
related project documents.

## Documentation authority

Repository prose is written in English and the English document stays
authoritative. A document may ship a `<name>.zh-CN.md` translation when it
declares `language: zh-CN`, `authoritative: false`, and its `translation-of`
source; the product README is the only such pair today
([`../README.zh-CN.md`](../README.zh-CN.md)). Historical review records are
immutable and retain their original language. Product localization
(`client/src/i18n/resources/zh/` and the runtime capability help under
`server/crates/desktop/control-api/src/capabilities/docs/zh/`) is a shipped
surface, not documentation.

Do not change implementation facts without checking the owning code,
configuration, generated contracts, or tests. Every document names its
authoritative source.

## Which repository owns a document

Documentation is owned by the repository that owns the facts it states. The
umbrella repository keeps only cross-repository concerns: this guide, the
governance policy, the review archive, the release log, the documentation index,
and [`ci.md`](ci.md). Everything else moved with its subject:

| Subject | Repository | Index |
| --- | --- | --- |
| Crate ownership, domains, layers, exits, wire protocol, storage backend, shared model catalog | `server/` | [`../server/docs/README.md`](../server/docs/README.md) |
| L0 contract and L1 protocol crate boundary | `server/core/` | [`../server/core/docs/README.md`](../server/core/docs/README.md) |
| Device topology, industrial protocol integration, Modbus capability cards | `server/physical/` | [`../server/physical/docs/README.md`](../server/physical/docs/README.md) |
| Published data-suite API, byte/record/evaluation/storage planes | `server/data/` | [`../server/data/docs/README.md`](../server/data/docs/README.md) |
| Frontend layers, tokens, motion, Linux and Windows rendering, render budget | `client/` | [`../client/docs/README.md`](../client/docs/README.md) |

Each of those repositories runs its own copy of the documentation gate and judges
its own tree: `pnpm check:docs` in `client/`, `node scripts/check-docs.mjs`
elsewhere. The umbrella's gate deliberately does not descend into the submodules —
in a superproject `git ls-files` reports a submodule as one entry, and the ownership
rule is one repository, one document gate. So a document edited in a sub-repository
is checked there, and a document edited here is checked by `pnpm check:docs`.

A relative link must stay inside the repository that contains it. When a fact lives
in another repository, name that repository and the path in prose rather than
linking to it: a link that leaves the repository is broken in a standalone clone.
The one exception is the umbrella checkout, which composes all five and may link
across them, because it is the only place where all of them are present.

## Before changing Rust or wire contracts

Read [`../server/docs/architecture/crates.md`](../server/docs/architecture/crates.md)
and run `pnpm architecture`. Identify the defining crate and reverse dependencies.
Update Rust owners, generated TypeScript, callers, and fixtures together.

## Documentation workflow

1. Update the authoritative English document, and its translation when the
   change touches translated facts.
2. Register new documents in the owning repository's index — [`README.md`](README.md)
   here, `docs/README.md` in the repository that owns the document.
3. Update `last-reviewed`.
4. Run the gate of the repository that owns the document: `pnpm check:docs` in the
   umbrella or `client/`, `node scripts/check-docs.mjs` in `server/`,
   `server/core/`, `server/physical/`, or `server/data/`.
5. Complete [`reviews/checklist.md`](reviews/checklist.md).
6. Add a record under `reviews/records/` and index it in
   [`reviews/README.md`](reviews/README.md).

## Quality gates

Run the complete command set in [`../CONTRIBUTING.md`](../CONTRIBUTING.md). For
documentation-only changes, the owning repository's documentation gate is mandatory
and all affected link, contract, architecture, and release checks must also pass.

## Writing rules

- Use clear English prose and stable technical identifiers. A translation is a
  reader aid: it declares its English source and never overrides it.
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
