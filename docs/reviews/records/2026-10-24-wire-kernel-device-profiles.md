# Wire kernel and device profiles documentation review

<!-- lissio-review
date: 2026-10-24
scope: Interface and operation contracts, the neutral wire kernel, device profiles, the schema library, the staged migration from capability vocabulary, and the architecture document that states them
reviewer: implementation agent; maintainer sign-off pending
verdict: passed-with-conditions
-->

## Scope

Reviewed the target device and protocol contracts recorded in
[`server/docs/architecture/device-abstraction.md`](../../../server/docs/architecture/device-abstraction.md)
against the implemented kernel:

- the interface, operation, and driver descriptors in
  `server/core/crates/shared/data-model/src/interface.rs`;
- the neutral schema IR, value model, codec ports, registry, and limits in
  `server/core/crates/shared/wire`;
- the protocol registry, profile document, frame layout, and engine output in
  `server/core/crates/protocol/protocol`;
- the eight I/O shapes and endpoint vocabulary in
  `server/physical/crates/protocol/acquisition/src/interface.rs`;
- the declared-versus-served interface verification in
  `server/physical/crates/transport/device-tree`;
- the CBOR codec in `server/core/crates/protocol/wire_codec_cbor`;
- the contract freeze in `docs/architecture/device-contracts.lock.json`.

This record extends the D1-D8 decisions of
[`2026-10-20-device-protocol-abstraction.md`](2026-10-20-device-protocol-abstraction.md).
Those decisions remain the record of the earlier survey; D9-D15 record the
contracts that replace the capability and schema stack they described.

## Findings

### Implemented kernel

| Concern | Source | State |
| --- | --- | --- |
| Interface and operation descriptors | `data-model::interface` | Present and frozen |
| Identifier and structured-value vocabulary | `data-model::ids`, `data-model::structured` | Present and frozen |
| Neutral schema IR, values, codec ports, limits | `wire` | Present and frozen |
| Protocol registry, profile document, frame layout, engine output | `protocol` | Present and frozen |
| CBOR codec | `wire-codec-cbor` | Present; self-describing and profile-shaped decode, encode, registration |
| Eight I/O shapes, endpoint vocabulary | `acquisition::interface` | Present and frozen |
| Declared-versus-served interface verification | `device-tree::capability` | Present; runs at tree open |
| Byte transport descriptors | `transport::interfaces` | Present for serial, TCP, UDP, test data, SLCAN, CandleLight |
| Contract manifest and gate | `device-contracts.lock.json` | 21 files at `device-contracts-v1` |

### Decisions

| Decision | Contract |
| --- | --- |
| D9 One interface vocabulary | A device capability is described only by `InterfaceDescriptor` and its `OperationDescriptor` list. `kind`, `data_domain`, and `framing` are open strings, so a new device category does not change a core enum. `EndpointDescriptor` adds runtime and discovery facts without copying operations. |
| D10 One static driver description, proved at runtime | `NodeDriver::descriptor()` is the sole static description. `NodeRuntime::interfaces()` returns `InterfaceRuntime { descriptor, handle }`. `ParentContract.interfaces` expresses a parent's requirements, and `interface_mismatches` proves that every declared interface exists in the runtime with the same kind, direction, data domain, and operation set. Runtime-only interfaces are allowed; duplicate declarations are rejected. |
| D11 Neutral wire kernel | `wire` owns the schema IR (`SchemaDocument`, `WireSchema`, `WireMessage`, `WireField`, `WireType`), `WireValue`, the codec/decoder/resolver/importer ports, the codec registry, and `DecodeLimits`. Protobuf, SBE, and CBOR are codecs over this IR; no binary format is implemented in the kernel. |
| D12 One declarative profile and one interpreter | `ProfileDocument` binds interfaces to an `AcquisitionPlan::{Frame, Messages}`, channels to bindings, and operations to request/response messages. `FrameLayout` retains the full block vocabulary. One compiler validates the profile against schemas, codecs, and interface requirements, and one `ProtocolEngine` executes it for RPC, MCP, CLI, and preview. |
| D13 Content-addressed schemas | A `SchemaId` is the SHA-256 of the canonical JSON of the schema IR. `SchemaDocument` pairs the IR with its format, name, and source bytes. `SchemaStore`, `SchemaResolver`, and `SchemaImporter` are ports; the schema library is immutable and a profile references it by id. |
| D14 Bounded, panic-free external input | `DecodeLimits` bounds frame size, depth, element count, string size, and schema size. Decoders are streaming and treat an incomplete trailing frame as non-fatal. Unknown fields and trailing bytes survive decode and encode. Codec crates forbid `unsafe`; error paths do not panic. |
| D15 Contract freeze and current-format-only data | The 21-file contract kernel is hashed, tagged `device-contracts-v1`, and checked by `check-device-contracts`. A contract change is an integrator update with a `contract:` subject and a new tag in every carrying repository. Persisted files, IPC payloads, and configuration are read and written in the current format only; no migration or compatibility reader exists. |

### Conditions

- The profile compiler, schema store, schema importers, and Protobuf and SBE
  codecs are specified but not implemented. The CBOR codec is the reference
  implementation.
- Adapters outside serial, network, and test data still implement the legacy
  capability and source-session surface. The interface declarations and runtime
  verification are additive on those paths.
- `MODEL_CATALOG_CONTRACT_VERSION` remains 4 and `DEVICE_TREE_SCHEMA_VERSION`
  remains 1. Their owning workstreams bump them when the catalog and persisted
  tree formats actually change.
- The frontend still renders the capability projection; it migrates after the
  new RPC and generated contracts exist.

## Follow-ups

| Workstream | Scope | Acceptance |
| --- | --- | --- |
| Adapter migration | CAN/automotive, Modbus, S7, and their fixtures declare interfaces and operations and implement the matching handles; typed capability traits and capability masks leave the adapter surface | Every physical adapter declares a `DriverDescriptor`; declared interfaces match the runtime; the legacy capability symbols are gone from the physical repository |
| Profile engine and schema store | Profile compiler, frame interpreter, profile engine, content-addressed schema store, and schema import | A profile compiles against a stored schema and decodes a device stream through the same engine used by RPC, MCP, CLI, and preview |
| Protobuf and SBE | Dynamic Protobuf and fixed-layout SBE codecs plus source importers, with unknown-field and version-ahead preservation | Both codecs pass the shared decode-limit, truncation, recursion, and round-trip suites |
| Server assembly and exits | Wire codecs, importers, store, and profile factory registered in `backend-host`; RPC/MCP/CLI commands; catalog projection of interfaces and profiles | The capability matrix and WebSocket frame contract are updated and generated TypeScript matches the Rust wire types |
| Frontend migration | Descriptor-driven device and profile forms, schema library, structured samples, and operation results | No driver, port, or protocol literal remains in the client; the frontend renders a new adapter or profile without a React change |
| New transports | HID, BLE, USB, SocketCAN, and media backends | Each backend is L4, feature-gated, registered by `backend-host`, and declares its interface shapes |
| Release and gates | Architecture docs, exits and Web contract, change files, and the release sequence | `check:docs`, `check:contracts`, `check:architecture`, and `check:release-sync` pass for the release |

The contract freeze and current-format-only rule apply to every follow-up: a
missing API is a contract request, not an edit to a frozen file, and no
workstream adds a reader for an older release.
