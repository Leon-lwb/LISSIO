# Shared Model Contract Inventory

<!-- lissio-doc
status: maintained
owner: Lissio maintainers
last-reviewed: 2026-10-07
applies-to: Ownership and serialization boundaries for shared model types
-->

This inventory identifies the current owners of shared model contracts. The
generated TypeScript in `src/types/generated/` is checked against Rust wire
types; this document explains ownership rather than repeating type definitions.

## 1. Graph documents and derivation

`data-model` owns portable node documents, edges, graph configuration, compile
diagnostics, and derived summaries. `graph`, `kind`, `schema_types`, and
`device-tree` own domain-specific semantics and lower into those documents.

## 2. Widgets and operators

`kind::widgets` owns widget variants, default configurations, ports, and
lowering. UI renderers and editors are not part of the backend model contract.

## 3. Devices, protocols, and simulation

`device-tree`, `protocol/acquisition`, transport adapters, and `schema_types`
own driver manifests, endpoint descriptors, typed point capabilities, protocol
presets, and simulation payloads. Display metadata must remain semantically
portable.

## 4. AI providers

`llm` owns provider capability and configuration contracts. Provider SDK types
remain behind L4 adapters. `ai-host` composes tools and prompts from the shared
capability registry.

## 5. RPC, events, and data DTOs

`rpc-api` owns request and response envelopes. `events` owns backend push
events. Domain crates own nested payload types and derive their own TypeScript.

## 6. Creation entry points

`app::models` owns catalog snapshots and document preparation/description.
`backend-host` assembles enabled providers. Frontend entry points share
`createFromCatalog`.

## 7. Open JSON boundaries

Open JSON is allowed only where the format is intentionally extensible:
configuration patches, driver payloads, simulation encodings, and UI hints. It
does not replace typed business contracts.

## 8. Pure UI boundaries

Themes, colors, motion, layout, icons, i18n strings, and React interaction state
remain frontend-only.

## 9. Known limits

- Dynamic driver validation depends on a real parent typed port.
- The supported form schema is a documented subset.
- Unknown configuration fields may be preserved but are not automatically valid.
- Historical release compatibility is not maintained.

Use `pnpm check:contracts` and `pnpm check:model-catalog` after every wire or
catalog change.
