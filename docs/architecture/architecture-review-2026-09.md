# Lissio Architecture Review (2026-09)

<!-- lissio-doc
status: maintained
owner: Lissio maintainers
last-reviewed: 2026-10-07
language: en
authoritative: true
applies-to: Architecture conclusions recorded during the September 2026 review
-->

Review date: 2026-09-29. Conclusions were checked against source and the
architecture, dependency, command, contract, and model-catalog gates.

## System position

Lissio is a device data-acquisition, real-time visualization, and node-graph
computation host. It is an independent backend with multiple protocol exits,
not merely a Tauri application. The desktop shell supervises `lissio-server`;
browsers, MCP clients, and the CLI use the same capability core.

At review time the workspace contained 63 Rust packages, 624 Rust files, 711
TypeScript files, 121 supported public commands, 10 desktop-only commands, and
generated TypeScript wire contracts.

## Four exits, one core

```text
Desktop shell     Browser          MCP client        CLI
  | HTTP+WS        | HTTP+WS        | rmcp tools      | argv
  +----------------+--------+-------+-----------------+
                           v
        control-api + rpc-api dispatch
                           v
        backend-host shared product assembly
                           v
        L0-L3 pipeline, graph, acquisition, device, display capabilities
```

Tauri registers only platform-shell commands such as windows, updater, splash,
and sidecar lifecycle. L0-L3 do not depend on Tauri, MCP, HTTP server, or CLI
SDKs.

## Layers

| Layer | Meaning |
| --- | --- |
| L0 | Stable contracts and types |
| L1 | Deterministic engines and in-memory structures |
| L2 | Stateful runtimes, storage, and orchestration |
| L3 | Product use cases and application state |
| L4 | Hardware, OS, SDK, and service adapters |
| L5 | Composition roots and root-only flows |

Dependencies may target the same or a lower layer and must follow the domain
DAG in [`crates.md`](crates.md).

## Decisions retained

### Port-based dependency inversion

Ports are defined below their implementations and injected by `backend-host`:
backend events, display streams, waveform envelope processing, execution
gates, node drivers/runtimes, and acquisition backends. `pipeline` sees the
acquisition contract rather than a specific device-tree adapter.

### Machine-checkable architecture

`pnpm architecture`, `check:architecture`, `check:deps`, `check:web-contract`,
and `check:contracts` enforce layout, metadata, DAG direction, adapter
isolation, centralized versions, command classification, and generated wire
types.

### Data-plane invariants

The byte, record, and evaluation planes enforce one clock domain,
rate-consistent capacity, record/evaluation separation, one parse with
zero-copy fan-out, and explicit accounting for every drop. Details are in
[`data-plane.md`](data-plane.md).

### Node graph compilation

`graph` orchestrates `kind`, `hir`, `plane`, `lower`, and `eval`. Value and byte
planes are typed before execution, and consumers use the facade.

### Device tree

Persistent topology uses `NodeDecl`; behavior uses `NodeDriver`; typed
capability projection uses `NodeRuntime`; lifecycle follows subtrees.

### Frontend transport and shared models

Business exits share HTTP-RPC/WebSocket semantics. Rust owners define models
and export wire types; frontend creation entry points share one catalog
service.

## End-to-end flow

Device adapters publish byte streams. The pipeline batches input, routes a
deduplicated byte plan, locks the sampling clock, records raw frames, queues
evaluation, stores derived channels separately, snapshots waveform tiers,
encodes WWB1 v2, and pushes typed display data through backend event or
WebSocket sinks.

## Established structure

- Product logic is outside Tauri.
- Four exits share one capability core and dispatch table.
- Device behavior is modeled by the device tree.
- Domain owners define shared models and generated contracts.
- Frontend transport is independent of desktop-only platform services.
- Contract, catalog, and command surfaces are gated.

## Structural debt

The review identified obsolete uncompiled Tauri files, placeholder crate
responsibility metadata, a highly coupled `pipeline`, inconsistent
`automotive*` layer semantics, several oversized frontend modules, and missing
centralized benchmark-history records. The current follow-up register is
[`cleanup-plan-2026-09.md`](cleanup-plan-2026-09.md).

## Conclusion

The architecture is an independent backend with multiple exits and a shared
capability core. Further work should remove misleading structures, keep
metadata machine-verifiable, and split modules only when maintenance evidence
justifies it.
