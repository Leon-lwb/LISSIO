# Lissio Documentation Index

<!-- lissio-doc
status: maintained
owner: Lissio maintainers
last-reviewed: 2026-10-18
applies-to: Repository documentation index and language policy
-->

This is the entry point for Lissio documentation. Repository prose is written in
English and the English file stays authoritative. The product README ships a
Simplified Chinese translation at [`../README.zh-CN.md`](../README.zh-CN.md).

Historical review records preserve their original language and facts.

Documentation is owned by the repository that owns the facts. This index covers what
the umbrella repository owns — the project surface, the licensing and documentation
policy, the review archive, and the cross-repository CI. Each other repository
indexes its own tree:

| Repository | Index | What it documents |
| --- | --- | --- |
| umbrella (this checkout) | this file | project surface, governance, reviews, cross-repository CI |
| `server/` | [`../server/docs/README.md`](../server/docs/README.md) | crate ownership and dependency direction, exits and wire protocol, storage backend, shared model catalog |
| `server/core/` | [`../server/core/docs/README.md`](../server/core/docs/README.md) | the L0 contract and L1 protocol crate boundary |
| `server/physical/` | [`../server/physical/docs/README.md`](../server/physical/docs/README.md) | device topology, industrial protocol integration, Modbus capability cards |
| `server/data/` | [`../server/data/docs/README.md`](../server/data/docs/README.md) | the published data suite's API and its byte, record, evaluation, and storage planes |
| `client/` | [`../client/docs/README.md`](../client/docs/README.md) | frontend layers, color and motion tokens, Linux and Windows rendering, render budget |

## Project and governance

| Document | Purpose |
| --- | --- |
| [`../README.md`](../README.md) | Product overview and setup |
| [`../CHANGELOG.md`](../CHANGELOG.md) | Release history |
| [`../AUTHORS.md`](../AUTHORS.md) | Authors and contributors |
| [`../SUPPORT.md`](../SUPPORT.md) | Support channels and boundaries |
| [`../MAINTAINERS.md`](../MAINTAINERS.md) | Maintainer authority and response targets |
| [`../RELEASING.md`](../RELEASING.md) | Release process |
| [`../CONTRIBUTING.md`](../CONTRIBUTING.md) | Contribution workflow and gates |
| [ci.md](ci.md) | CI platform, runner setup, gate registry, and release pipeline |
| [`../SECURITY.md`](../SECURITY.md) | Security and rights reporting |
| [`../GOVERNANCE.md`](../GOVERNANCE.md) | Governance and release authority |
| [`../ROADMAP.md`](../ROADMAP.md) | Delivered scope and non-goals |
| [`../LICENSE`](../LICENSE) | Apache License 2.0 |
| [`../NOTICE`](../NOTICE) | Copyright and attribution |
| [`../CITATION.cff`](../CITATION.cff) | Citation metadata |

## Licensing and documentation governance

| Document | Purpose |
| --- | --- |
| [governance/open-source-and-ip.md](governance/open-source-and-ip.md) | License, copyright, patents, notices, and claims |
| [governance/third-party-licenses.md](governance/third-party-licenses.md) | Dependency and asset obligations |
| [governance/documentation-standards.md](governance/documentation-standards.md) | Language, placement, metadata, and maintenance |
| [governance/document-review.md](governance/document-review.md) | Review triggers, process, and records |
| [governance/branch-lifecycle.md](governance/branch-lifecycle.md) | Branch roles, integration into `develop`, and deletion across every Lissio repository |

## Reviews

| Document | Purpose |
| --- | --- |
| [reviews/README.md](reviews/README.md) | Historical review index and format |
| [reviews/checklist.md](reviews/checklist.md) | Documentation review checklist |
| [reviews/records/](reviews/records/) | Immutable historical records |

## Release history

| Document | Purpose |
| --- | --- |
| [releaselog/release-notes-v0.7.2-beta.md](releaselog/release-notes-v0.7.2-beta.md) | Archived release notes |
| [`../CHANGELOG.md`](../CHANGELOG.md) | Current release history |

## Development and source documentation

| Document | Purpose |
| --- | --- |
| [`../AGENTS.md`](../AGENTS.md) | Repository development instructions |
| [AGENTS.md](AGENTS.md) | Documentation-area development and review instructions |
| [`../server/AGENTS.md`](../server/AGENTS.md) | Server repository development instructions |
| [`../client/AGENTS.md`](../client/AGENTS.md) | Client repository development instructions |
| [`../packaging/server/README.md`](../packaging/server/README.md) | Server and CLI package |

Runtime capability help is authoritative in the server repository, at
`server/crates/desktop/control-api/src/capabilities/docs/en/`; the `zh/` files are
product translations. The built-in AI prompt is
`server/crates/desktop/ai-host/default-system-prompt.md`. Both are named rather than
linked because they belong to the `server/` repository, which indexes them.

## Performance

| Document | Purpose |
| --- | --- |
| [performance/frontend-perf.json](performance/frontend-perf.json) | The committed render baseline `pnpm perf:check` compares against |

The budget that baseline is measured against is the client repository's
[`../client/docs/performance/frontend-render-budget.md`](../client/docs/performance/frontend-render-budget.md).
The baseline itself stays here because the gate that reads it — `scripts/perf-collect.mjs`,
through `bash scripts/perf-gate.sh` — is an umbrella script, and a data file belongs
with the code that consumes it.

## Gates

| Command | Coverage |
| --- | --- |
| `pnpm check:docs` | License text and SPDX, notices, metadata, document index, links, and review records of this repository |
| `node server/scripts/check-docs.mjs` | The same gate over the server repository's own tree |
| `node client/scripts/check-docs.mjs` | The same gate over the client repository's own tree |
| `pnpm check:architecture` | Crate layout, metadata, domain DAG, layers, and adapter isolation |
| `pnpm check:web-contract` | Public command, dispatch, and frontend call consistency |
| `pnpm check:contracts` | Rust wire types and generated TypeScript |
| `pnpm check:model-catalog` | Catalog fixtures, contract version, and widget coverage |
| `pnpm check:tokens` | Color, opacity, frost, and structural budgets |
| `pnpm check:motion` | Paint-only transition properties and motion invariants |
| `pnpm perf:check` | Per-frame frontend cost against baseline |
| `pnpm check:all` | Full local quality surface |
