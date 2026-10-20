# Device and protocol engine abstraction documentation review

<!-- lissio-review
date: 2026-10-20
scope: Read-only survey of the device-driver and protocol-engine abstractions across core, physical, server, and client, with the target contracts, frontend cost, and guidance decisions recorded from source
reviewer: implementation agent; maintainer sign-off pending
verdict: passed-with-conditions
-->

## Scope

Reviewed the abstractions that connect a physical device to a parsed data stream,
and the ones that describe a protocol end to end:

- the driver contracts in `server/physical/crates/transport/device-tree` and
  `server/physical/crates/protocol/acquisition`, and the adapters under
  `server/physical/crates/transport/*`;
- the protocol value types and engines in `server/core/crates/protocol/schema_types`,
  `schema`, `protocol`, `protocol-float`, `protocol-can-bridge`, and
  `frame-decoder`;
- the graph and pipeline consumption points in `server/data/crates/graph/kind` and
  `server/crates/desktop/pipeline`;
- the shared model catalog, prepare/describe use cases, and acquisition RPC in
  `server/crates/desktop/app` and `server/crates/desktop/rpc-api`;
- the device panel, device-tree projection, protocol form, schema form, and
  quickstart templates in `client/src`.

The survey was read-only: no Rust, TypeScript, wire contract, generated
contract, or persisted format changed, so the code gates were not run. Findings
were checked against source and against the existing registers
[`crates.md`](../../../server/docs/architecture/crates.md),
[`device-tree.md`](../../../server/physical/docs/architecture/device-tree.md),
[`industrial-protocol-integration.md`](../../../server/physical/docs/architecture/industrial-protocol-integration.md),
[`backend-model-catalog-plan.md`](../../../server/docs/architecture/backend-model-catalog-plan.md),
and [`cleanup-plan-2026-09.md`](../../../server/docs/architecture/cleanup-plan-2026-09.md).
This record does not repeat the debt those registers already carry; it records the
device/protocol abstraction debt and the contract decisions that close it.

## Findings

### Current abstraction inventory

| Concern | Owner and contract | Consumers |
| --- | --- | --- |
| Byte transport | `acquisition::TransportBackend` opens one `TransportConfig` into a `TransportConnection` | `serial`, `network`, `can-transport` |
| Source runtime | `acquisition::SourceFactory` / `SourceSession` plus `Read`/`Subscribe`/`Write`/`Invoke` capability traits | `pipeline`, `device-tree` |
| Topology and lifecycle | `device_tree::NodeDriver` / `NodeRuntime`, `DriverRegistry`, `CapabilityMask` | `graph_ops`, `app`, `backend-host` |
| Protocol configuration | `schema_types::ProtocolConfig`, `ProtocolSchema`, `ProtocolNodeConfig` | graph, pipeline, catalog, client |
| Protocol execution | `protocol::ProtocolEngine`; presets compiled by `schema::compile_schema` | `pipeline`, `frame-decoder`, tests |
| Shared description | `data_model::model_descriptor::ModelDescriptor`, `ConfigurationSchema` | catalog RPC, prepare/describe, client stores |

Eleven production `NodeDriver` implementations and four production `SourceFactory`
implementations exist. `CapabilityMask` alone appears in 25 Rust files.

### P1. Two parallel driver contracts, joined by a hand-written adapter layer

`acquisition::SourceFactory` and `device_tree::NodeDriver` describe overlapping
facts: identity, manifest, configuration schema, capabilities, ports, validation,
and open. `ByteDeviceDriver` exists only to re-project one into the other
([`device_driver.rs:34-180`](../../../server/physical/crates/transport/transport/src/device_driver.rs)),
and the Modbus adapters repeat the same seven methods in a macro
([`node_driver.rs:22-160`](../../../server/physical/crates/transport/modbus-adapter/src/node_driver.rs)).
A new adapter therefore implements two traits, a descriptor, a factory, and a
session before any protocol logic exists.

### P2. Three capability representations and a test-only consistency check

`CapabilitySet` (eight booleans) in
[`acquisition/src/lib.rs:100-124`](../../../server/physical/crates/protocol/acquisition/src/lib.rs)
duplicates the `CapabilityMask` vocabulary (ten booleans) defined in
[`state.rs:43-70`](../../../server/core/crates/shared/data-model/src/device_tree/state.rs)
and re-derived into a mask by
[`device-tree/src/driver.rs:302-315`](../../../server/physical/crates/transport/device-tree/src/driver.rs),
with `SessionCapabilities.available` holding a third copy. The bit-to-handle
agreement is checked only when an adapter remembers to call
`validate_capability_contract`
([`acquisition/src/lib.rs:342-362`](../../../server/physical/crates/protocol/acquisition/src/lib.rs)).
Adding one capability touches the two structs, the `as_*` accessors, the mask
constructor, `ALL_CAPABILITIES`, and two generated TypeScript types.

### P3. Type-erased validation state and three error vocabularies

`ValidatedNodeConfig` stores `Option<Arc<dyn Any + Send + Sync>>`
([`driver.rs:25-58`](../../../server/physical/crates/transport/device-tree/src/driver.rs)),
so `open` recovers its configuration with `driver_state::<T>()` and a runtime
`is_none()` guard. The compiler cannot tie a driver's configuration type to its
runtime, and an invalid state remains constructible. `ConfigError`, `OpenError`,
`CloseError`, `AcquisitionError`, and `error::Result` coexist at one boundary, so
adapter failures degrade into strings.

### P4. Six spellings of one protocol definition, and two disagreeing dispatches

A protocol is described by `ProtocolConfig`, `SchemaPreset`,
`ProtocolSchema.preset_config`, `ProtocolNodeConfig`, `NodeKind::Protocol`, and a
frontend kind list. Dispatch is written three times:
`schema_from_protocol_config`, `compile_preset`
([`schema/src/compile.rs:14-44`](../../../server/core/crates/protocol/schema/src/compile.rs)),
and `create_protocol_engine`
([`protocol_node_state.rs:15-28`](../../../server/crates/desktop/pipeline/src/data_plane/protocol_node_state.rs));
the catalog adds a fourth list in
[`catalog.rs:214-256`](../../../server/crates/desktop/app/src/models/catalog.rs),
and the form a fifth
([`ProtocolConfigForm.tsx:116-123`](../../../client/src/components/panels/protocol/ProtocolConfigForm.tsx)).

The first two dispatches already disagree: `LogicDecode` resolves to
`RawDataEngine` through `compile_preset` but to `LogicDecoderEngine` through the
pipeline factory. `Diagnostic` resolves to a `RawData` placeholder on both paths
while its real dispatch lives elsewhere. Adding a protocol means coordinated edits
in three repositories.

### P5. The frontend re-states backend knowledge it is documented not to infer

The device-tree projection hardcodes `protocol-engine`, `simulation`,
`test-data`, and the `in`/`out`/`rx`/`raw`/`points` handles
([`deviceTreeModel.ts:6`](../../../client/src/lib/acquisition/deviceTreeModel.ts),
[`deviceTreeModel.ts:84-135`](../../../client/src/lib/acquisition/deviceTreeModel.ts),
[`DeviceTreePanel.tsx:78-89`](../../../client/src/components/acquisition/DeviceTreePanel.tsx),
[`DeviceTreeInspector.tsx:59-82`](../../../client/src/components/acquisition/DeviceTreeInspector.tsx)).
The protocol form hardcodes kinds, channel rules, decoder parameters, and
per-protocol prose. Field labels live in a hand-maintained dictionary
([`schemaLabels.ts`](../../../client/src/components/acquisition/schemaLabels.ts)),
so a backend field rename silently falls back to a title-cased identifier.

### P6. Guidance is structurally absent, not merely thin copy

`ModelDescriptor`
([`model_descriptor.rs:225-245`](../../../server/core/crates/shared/data-model/src/model_descriptor.rs))
carries display, schema, defaults, variants, actions, and availability, but no
ports, capabilities, parent roles, setup steps, examples, or field-level
validation. `validate_adapter_configuration` returns free text
([`acquisition.rs:72-86`](../../../server/crates/desktop/rpc-api/src/acquisition.rs)),
so a form cannot point at the offending field. Discovery returns endpoints without
a recommended driver, and there is no way to preview a parse before committing a
protocol.

### Cross-cutting duplication

- `SchemaEngine::try_parse` is a single 250-line match over every block kind
  ([`engine.rs:74-325`](../../../server/core/crates/protocol/schema/src/engine.rs)),
  and `frame-decoder` parses the same block definitions a second time — the debt
  the cleanup register already records as open.
- `ByteDeviceFactory::config_schema` builds a JSON Schema by sniffing parameter
  names ([`device_factory.rs:215-247`](../../../server/physical/crates/transport/transport/src/device_factory.rs)),
  while Modbus and S7 hand-write schemas and UI hints, so the two families cannot
  share a form renderer safely.
- `SchemaFields` consumes only the `order` hint and supports a narrow JSON Schema
  subset ([`SchemaFields.tsx:28-51`](../../../client/src/components/acquisition/SchemaFields.tsx)),
  which is why adapters keep writing bespoke forms.
- Quickstart templates hardcode protocol kinds
  ([`templates.ts:40-264`](../../../client/src/lib/quickstart/templates.ts)).

### Target contract

| Decision | Contract |
| --- | --- |
| D1 One driver contract | `NodeDriver` keeps metadata and `validate → Box<dyn PreparedNode>`; opening moves to `PreparedNode::open`. `ValidatedNodeConfig` loses its `Any` field, `NodeDriver::open` and `acquisition::ValidatedConfig` disappear, and `ByteDevice` becomes one `NodeDriver` implementation. `SourceSession` and `TransportBackend` remain as the runtime and transport ports. |
| D2 One capability vocabulary | `CapabilityMask` (already in L0 `data_model::device_tree`) is the only representation; `CapabilitySet` is deleted and `DriverManifest`, `PortDescriptor.operations`, and `SessionCapabilities.available` use the mask. The mask is derived from the runtime projection, and the client consumes one generated type. |
| D3 One boundary error | `error::DriverError` carries `InvalidConfig { driver, path, detail }`, `MissingParent { capability }`, `Open { kind, detail }`, `Unsupported { operation }`, `Timeout`, and `Closed`; adapters map their SDK errors once. |
| D4 One protocol definition registry | `ProtocolConfig` becomes `{ protocol: ProtocolId, params: Value }` validated by that protocol's schema; `SchemaPreset` folds into `ProtocolId`; `schema::ProtocolRegistry` registers `ProtocolDefinition { id, display, config_schema, default_params, directions, engine, ports, validate, guidance }`. Compilation, schema derivation, pipeline engines, catalog descriptors, and the client list all read that registry. It lives in `schema`, which already depends on the engine crates, so no crate is added. |
| D5 Block handlers | `DecoderBlockDef` keeps its wire spelling; parsing, encoding, port derivation, and validation move behind one `BlockCodec` trait implemented per variant, shared by `SchemaEngine` and `frame-decoder`. |
| D6 Catalog v3 projection | `ModelDescriptor` gains `ports`, `parent_roles`, `capabilities`, and `guidance { summary_key, when_to_use_key, setup_steps, examples, docs_key }`; `MODEL_CATALOG_CONTRACT_VERSION` becomes 3. Driver descriptors derive from driver metadata and protocol descriptors from the registry. |
| D7 Validation and preview | Validation RPCs return `Vec<ModelIssue>` with field paths; `preview_protocol` opens a transient source for a bounded window (4 KiB or 500 ms), returns raw hex, parsed frames, and issues, then closes; `DiscoveredEndpoint` gains `suggested_driver` and `confidence`. |
| D8 Client projects only | Driver ids, roles, and port handles resolve from the driver projection and `describe`; the protocol form renders the protocol descriptor; `SchemaFields` implements the documented control set (`order`, `group`, `control`, `unit`, `placeholder`, `helpKey`, `advanced`) with an explicit unsupported state; the field-label dictionary is replaced by `uiHints.labelKey` plus a fallback label. |

### Guidance and interaction

Guidance follows from the descriptor, not from per-protocol React copy:

1. A device card creates the device and its recommended protocol-engine child in
   one action.
2. The protocol inspector embeds a parse preview: raw bytes, frame table, and an
   invalid-frame count, served by `preview_protocol`.
3. Field errors render inline from `ModelIssue.path`, with a repair action for
   known codes.
4. Empty states and next steps render `guidance.setup_steps`.
5. Quickstart templates derive from `guidance.examples`.

## Follow-ups

Each workstream is independently shippable. Wire changes regenerate
`client/src/types/generated` in the same change and update golden fixtures.
`current-format-only` holds: no compatibility branch is added for any of these
contracts.

| Workstream | Scope | Depends on | Acceptance |
| --- | --- | --- | --- |
| W1 capability vocabulary | Make `CapabilityMask` the only capability type; delete `CapabilitySet`; regenerate contracts | — | A new capability requires one Rust edit plus generated TypeScript; no `CapabilitySet` remains |
| W2 driver contract merge | `PreparedNode` replaces `Any` and the two-trait adapter; migrate transport, Modbus, S7, automotive, ISO-TP, simulation, diagnostics | W1 | No `Any` downcast in the public `device-tree` or `acquisition` API; each adapter implements one trait; contract tests iterate the registry |
| W3 protocol registry | `{ protocol, params }` configuration, `ProtocolRegistry`, one engine path | — | A new protocol is one `ProtocolDefinition`; `LogicDecode` and `Diagnostic` each have exactly one dispatch |
| W4 block handlers | `BlockCodec` shared by `SchemaEngine` and `frame-decoder` | W3 | One parser and one encoder per block kind; `engine.rs` stays under the file limit |
| W5 catalog v3 and guidance RPC | Descriptor extension, `preview_protocol`, structured validation, discovery recommendation | W1, W3 | The client can render any driver or protocol without a backend whitelist; every validation issue carries a path; preview is bounded and closes |
| W6 client de-hardcoding and guidance | Descriptor-driven forms, role and port resolution, preview panel, generated templates | W5 | No driver id or port name literal is matched in `client/src`; a new protocol or adapter needs no React change |

Required gates per workstream: `pnpm check:architecture`, `check:deps`,
`check:contracts`, `check:model-catalog`, `check:web-contract`, `check:rust-size`,
`cargo fmt --check`, `cargo clippy --workspace --all-targets`,
`cargo test --workspace`, and the client's `typecheck`, `lint:ci`, `test:client`,
`check:layers`, `check:tokens`, and `check:motion` where the workstream touches
those surfaces.

Risks and non-goals:

- Replacing the `ProtocolConfig` enum with `{ protocol, params }` (W3) is the
  largest breaking surface; it must land in one change across `kind`, `graph_ops`,
  `pipeline`, the catalog, and the client, with no compatibility layer.
- Removing `NodeDriver::open` (W2) touches every adapter and contract test;
  `PreparedNode` lands first and adapters migrate one at a time.
- Out of scope: CAN and diagnostic business semantics, the graph compiler, new
  crates, dependency-reducing facades, and workspace migration.
