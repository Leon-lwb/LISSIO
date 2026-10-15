# Lissio Documentation Index

<!-- lissio-doc
status: maintained
owner: Lissio maintainers
last-reviewed: 2026-10-15
applies-to: Repository documentation index and language policy
-->

This is the entry point for Lissio documentation. Repository prose is written in
English; the translated documentation backups were removed.

Historical review records preserve their original language and facts.

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

## Architecture

| Document | Purpose |
| --- | --- |
| [architecture/crates.md](architecture/crates.md) | Domains, layers, ownership, and dependencies |
| [architecture/architecture-review-2026-09.md](architecture/architecture-review-2026-09.md) | September 2026 architecture conclusions |
| [architecture/cleanup-plan-2026-09.md](architecture/cleanup-plan-2026-09.md) | Remaining structural debt |
| [architecture/data-plane.md](architecture/data-plane.md) | Byte, record, evaluation, and storage planes |
| [architecture/database-backend-plan.md](architecture/database-backend-plan.md) | Recording storage engine selection and backend adapters |
| [architecture/device-tree.md](architecture/device-tree.md) | Device topology and driver/runtime contracts |
| [architecture/exits.md](architecture/exits.md) | UI, Web, MCP, and CLI exits |
| [architecture/web-exit.md](architecture/web-exit.md) | HTTP/WebSocket wire protocol |
| [architecture/backend-model-catalog-plan.md](architecture/backend-model-catalog-plan.md) | Shared model catalog and wire generation |
| [architecture/shared-model-inventory.md](architecture/shared-model-inventory.md) | Shared model ownership inventory |
| [architecture/shared-model-catalog-progress.md](architecture/shared-model-catalog-progress.md) | Current catalog implementation |
| [architecture/industrial-protocol-integration.md](architecture/industrial-protocol-integration.md) | Industrial adapters and evidence |
| [architecture/modbus-capability-cards.md](architecture/modbus-capability-cards.md) | Modbus capability projection |
| [architecture/ui-layers.md](architecture/ui-layers.md) | Frontend dependency layers |
| [architecture/ui-color-tokens.md](architecture/ui-color-tokens.md) | Color, opacity, frost, and glass tokens |
| [architecture/linux-rendering.md](architecture/linux-rendering.md) | Linux/Wayland controls, content switching, CSS theme lifetime, and platform-safe validation |
| [architecture/windows-rendering.md](architecture/windows-rendering.md) | Windows transparency policy, background ownership, theme editing, and native rendering verification |
| [architecture/ui-motion.md](architecture/ui-motion.md) | Motion modules and rules |
| [architecture/motion-tokens.md](architecture/motion-tokens.md) | Generated spring tokens |
| [architecture/motion-spatial-plan.md](architecture/motion-spatial-plan.md) | Spatial motion decisions |

## Performance

| Document | Purpose |
| --- | --- |
| [performance/frontend-render-budget.md](performance/frontend-render-budget.md) | Per-frame frontend performance budget |

## Reviews

| Document | Purpose |
| --- | --- |
| [reviews/README.md](reviews/README.md) | Historical review index and format |
| [reviews/checklist.md](reviews/checklist.md) | Documentation review checklist |
| [reviews/records/](reviews/records/) | Immutable historical records |

## Development and source documentation

| Document | Purpose |
| --- | --- |
| [`../AGENTS.md`](../AGENTS.md) | Repository development instructions |
| [AGENTS.md](AGENTS.md) | Documentation-specific development guidance |
| [`../src-tauri/crates/README.md`](../src-tauri/crates/README.md) | Rust crate domain layout |
| [`../src-tauri/crates/desktop/performance/README.md`](../src-tauri/crates/desktop/performance/README.md) | Backend performance ownership |
| [`../src-tauri/crates/transport/device-tree/README.md`](../src-tauri/crates/transport/device-tree/README.md) | Device-tree crate summary |
| [`../packaging/server/README.md`](../packaging/server/README.md) | Server and CLI package |
| [`../src/i18n/README.md`](../src/i18n/README.md) | i18n runtime |
| [`../src/i18n/resources/README.md`](../src/i18n/resources/README.md) | Translation resource rules |

Runtime capability help is authoritative in
[`../src-tauri/crates/desktop/control-api/src/capabilities/docs/en/`](../src-tauri/crates/desktop/control-api/src/capabilities/docs/en/).
The `zh/` files are product translations. The built-in AI prompt is
[`../src-tauri/crates/desktop/ai-host/default-system-prompt.md`](../src-tauri/crates/desktop/ai-host/default-system-prompt.md).

## Gates

| Command | Coverage |
| --- | --- |
| `pnpm check:docs` | License text and SPDX, notices, metadata, document index, links, and review records |
| `pnpm check:architecture` | Crate layout, metadata, domain DAG, layers, and adapter isolation |
| `pnpm check:web-contract` | Public command, dispatch, and frontend call consistency |
| `pnpm check:contracts` | Rust wire types and generated TypeScript |
| `pnpm check:model-catalog` | Catalog fixtures, contract version, and widget coverage |
| `pnpm check:tokens` | Color, opacity, frost, and structural budgets |
| `pnpm check:motion` | Paint-only transition properties and motion invariants |
| `pnpm perf:check` | Per-frame frontend cost against baseline |
| `pnpm check:all` | Full local quality surface |
