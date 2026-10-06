# Unified Device Tree Architecture

<!-- lissio-doc
status: maintained
owner: Lissio maintainers
last-reviewed: 2026-10-07
language: en
authoritative: true
applies-to: Persistent device topology, driver/runtime contracts, capabilities, and lifecycle
-->

`device-tree` is authoritative for persistent topology, node driver/runtime
contracts, typed capability projection, closure validation, and subtree
lifecycle. It has no hardware or external SDK dependencies; adapters implement
its ports and composition roots inject them.

## Current implementation

- `NodeDecl` stores topology and configuration.
- `NodeDriver` owns driver identity, child policy, default configuration,
  validation, and open/close behavior.
- `NodeRuntime` projects typed ports and runtime capabilities.
- The production acquisition backend adapts the tree to `acquisition`.
- Protocol-engine drivers derive parsing and evaluation from parent byte
  sources without taking ownership of the source.

## Goals

The model must support serial byte devices, industrial point sources, CAN,
protocol chains, virtual devices, future adapters, durable configuration,
capability-based forms, deterministic lifecycle, and safe subtree close without
requiring a registry or adapter SDK below L2.

## Persistent topology

A device tree stores nodes, parent-child relationships, driver IDs,
configuration, display metadata, and stable node IDs. IDs are persisted;
display names are not identities.

A node may own children only when its driver policy allows it. A source-like
node supplies raw bytes or typed points. A protocol node consumes a byte parent.
A leaf may expose widgets or typed point ports.

Configuration is stored in current format only. Unknown fields are preserved
only where the owning driver explicitly supports open payloads; there is no
legacy migration.

## Driver contract

Drivers declare:

- stable driver ID and contract version;
- display name and symbol;
- allowed parents and child policy;
- configuration JSON Schema and defaults;
- typed capability projection;
- open and close lifecycle;
- validation of configuration and parent context.

A driver is an inversion-port implementation. Hardware discovery, sockets, USB,
and external SDK handles remain in L4 adapters.

### Parent contract

A child driver receives immutable parent context and a typed projection such as
raw byte subscription, point access, or diagnostic metadata. It cannot assume a
concrete adapter. Closing a child cancels only its own subscription.

### Runtime contract

Opening produces a runtime with typed ports and capabilities. Ports carry value
domain, direction, read/write/poll operations, quality, and address semantics.
Runtime state is reported explicitly; errors are not inferred from absent data.

## Capabilities and closure validation

The capability catalog is the source for forms and discovery. Validation checks
driver compatibility, parent context, address space, point type, operation
support, configuration schema, and subtree closure before opening.

`list_driver_manifests` and `list_adapter_capabilities` derive from the same
registry. Display metadata is portable and contains no Rust or React type
names.

## Lifecycle and state

### Open order

1. Validate complete affected subtree.
2. Create parents before children.
3. Open drivers in dependency order.
4. Project runtime ports and capabilities.
5. Attach observers and subscriptions.
6. Publish running state only after required resources are ready.

### Close order

1. Stop new work and writes.
2. Detach child subscriptions.
3. Flush or explicitly report unflushed data.
4. Close children before parents.
5. Release OS and SDK resources.
6. Aggregate final state and diagnostics.

Opening or closing one subtree must not close unrelated shared parents.

### State aggregation

Node state combines configuration validity, connection state, runtime
availability, data quality, and explicit warnings. A parent failure propagates
to dependent children, while sibling subtrees remain independently managed.

## Representative topologies

### Serial byte device

Serial source → protocol engine → waveform/raw/derived panels.

The serial driver owns enumeration and connection. Protocol state consumes a
byte subscription and derives frames or values.

### Modbus RTU over serial

Serial transport → Modbus RTU adapter → typed point ports.

The adapter owns request scheduling and point mapping; the serial source owns
physical transport.

### Modbus TCP or S7

Network endpoint → industrial adapter → typed point ports.

The adapter owns reconnect and protocol-specific addressing. Device-tree
configuration remains transport-neutral.

### CAN diagnostic

CAN source → bridge/protocol → diagnostic or frame views.

CAN frame identity and filtering are preserved across projections.

### Virtual device

Simulation driver → byte or point source → the same downstream contracts.

Virtual sources exercise production paths without pretending to prove hardware
interoperability.

## Data-plane interface

The tree publishes typed source streams and point access. `pipeline` consumes
`AcquisitionRuntime` and remains independent of concrete device-tree modules.
Raw byte and point semantics are defined in lower-level shared contracts.

## Frontend and IPC

IPC exposes topology, driver manifests, capabilities, endpoints, point reads
and writes, and lifecycle. The frontend renders backend forms and topology but
does not infer driver IDs, aliases, or hardware identity.

For protocol-engine nodes, device-tree topology determines source ownership;
the graph execution derives parse and conversion work from declared protocol
configuration.

## Crate ownership

`device-tree` owns topology and contracts. `protocol/acquisition` owns source
lifecycle and typed lanes. `transport/*` adapters own SDK and hardware
integration. `pipeline` owns dispatch and derived evaluation. `app` and
`control-api` consume projections.

## Tests and gates

### Model tests

Cover persistence, IDs, parent/child policy, capability projection, schema
validation, unknown fields, and current-format-only behavior.

### Driver contract tests

Run common open/close, typed-port, error, timeout, reconnect, and capability
tests against every adapter implementation.

### Topology tests

Cover shared parents, nested protocol nodes, partial close, subtree failures,
and sibling isolation.

### Data semantics tests

Cover point types, quality, address spaces, byte boundaries, subscriptions,
write acknowledgements, and overflow accounting.

### Engineering gates

```bash
pnpm check:architecture
pnpm check:deps
pnpm check:web-contract
pnpm check:contracts
pnpm typecheck
pnpm test
cd src-tauri
cargo test --workspace
cargo deny check
```

Real-device interoperability is separate evidence and cannot be inferred from
local simulation.

## Acceptance criteria

- Topology survives restart without rewriting IDs or configuration.
- Drivers can be added without changing frontend registries.
- Capability forms derive from backend schemas.
- Parent sharing and subtree close are deterministic.
- All drops, write failures, and unavailable capabilities are explicit.
- No lower layer depends on Tauri or an adapter SDK.

## Conclusion

The device tree separates persistent topology, driver behavior, typed runtime
projection, and adapter implementation. It gives every exit the same device
model while keeping hardware dependencies at the composition edge.
