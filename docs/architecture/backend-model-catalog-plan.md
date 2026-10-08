# Shared Model Catalog and Contract Architecture

<!-- lissio-doc
status: maintained
owner: Lissio maintainers
last-reviewed: 2026-10-07
applies-to: Ownership, runtime catalog, node creation, and Rust-to-TypeScript wire generation
-->

This document defines the implemented shared business-model structure. Domain
owners define nodes, devices, protocols, widgets, operators, AI providers, and
data contracts. The frontend obtains catalogs and descriptions and consumes
generated TypeScript; it does not own support whitelists.

## Structural constraints

- Types live with the responsibility owner; consumers depend on that owner.
- Do not add generic registry or facade crates.
- New business commands enter `rpc-api`, not Tauri.
- Preserve established JSON fields, enum casing, handle IDs, command/event
  names, and workspace format.
- A contract change updates the Rust owner, generated TypeScript, callers, and
  golden fixtures together.

## Ownership

| Scope | Backend owner | Frontend responsibility |
| --- | --- | --- |
| Devices and adapters | `device-tree`, `NodeDriver`, assembled by `backend-host` | Device tree and forms |
| Graph documents | `kind::document`, `graph_ops` | React Flow adaptation and edit intent |
| Widgets | `kind::widgets` | Renderer/editor/icon registry |
| Operators | `kind` | Operator editing |
| Protocols | `schema_types` | Protocol forms |
| Graph ports | `app::models::describe`, `graph_ops` | Connections and port display |
| Simulation | `data-model`, `device-tree::SimulationDriver` | Simulation forms |
| AI providers | `llm::types`, model catalog | Provider settings |
| RPC/event/data DTOs | Rust owners and `rpc-api` | Generated consumers |
| Creation | `prepare_node_documents`, `createFromCatalog` | Scenarios and drafts |

## Required boundaries

1. `update_tab_graph` accepts `NodeDocument`; the frontend never creates backend `NodeDef`.
2. `GraphDerived.ports` remains output semantics; full descriptions are separate.
3. Sink ports resolve from widget kind and parameters.
4. Catalogs and descriptions are isolated by connection generation.
5. Business UI does not mount before the catalog is ready.
6. Unknown models and widgets use explicit unsupported presentation.
7. React Flow `point-selector` remains an adapter spelling for wire `pointSelector`.
8. Forms support the documented JSON Schema subset; constraints do not become defaults.

## Data flow

Domain owners register through `backend-host`. The backend produces an
immutable catalog, normalized prepared documents, and draft descriptions.
`rpc-api` exposes all three. The frontend cache feeds renderers and forms and
returns `NodeDocument` edit intent to the existing graph commit path. Rust wire
owners export deterministic TypeScript.

## Runtime catalog versus types

The catalog answers what the backend supports and how to create/configure it.
Generated TypeScript answers field and union shapes. Neither replaces the
other. Runtime validation always returns to Rust.

## Generated wire types

- `rpc-api/examples/export_contracts.rs` is the explicit export entry.
- `pnpm generate:contracts` writes `src/types/generated/`.
- `pnpm check:contracts` compares temporary output without changing the tree.
- Owners derive `ts-rs::TS`; lower layers do not depend on the exporter.
- Open JSON is limited to open payloads and UI hints.
- Known widget configuration is a generated discriminated union.
- Integer representation follows actual wire behavior and boundary fixtures.
- Request-only optional fields may differ from response serialization when
  semantics require separate DTOs.
- Binary waveform/display streams keep their frame protocols and golden fixtures.

Coverage includes graph documents, devices/capabilities/point I/O,
protocol/decoder/command blocks, widget configuration, CAN/logic, waveform and
measurement, run state, recording/workspace, AI/MCP/errors, and every frontend
RPC request, response, and event.

## Current invariants

- `backend-host` assembles enabled owners and injects the catalog.
- Catalog, prepare, and describe are the only shared RPC entry points.
- Creation defaults and port resolution derive from backend definitions.
- Prepare can fail without persistence; describe has no device or workspace side effects.
- Catalog revision, configuration schema version, and graph base version are separate.
- Generated types do not provide runtime safety.

## Verification

```bash
pnpm check:contracts
pnpm check:model-catalog
pnpm check:web-contract
pnpm typecheck
pnpm test
```

Golden fixtures cover catalogs, preparation, batch description, stale
revisions, and main model branches.
