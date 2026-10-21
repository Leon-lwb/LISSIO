# Protocol registry review

<!-- lissio-review
date: 2026-10-20
scope: Implementation of the protocol registry workstream: `{ protocol, params }` configuration, `ProtocolRegistry`, and the single engine dispatch
reviewer: implementation agent; maintainer sign-off pending
verdict: passed-with-conditions
-->

## Scope

Reviewed the protocol-registry workstream (W3) of the device and protocol
abstraction survey
([`2026-10-20-device-protocol-abstraction.md`](2026-10-20-device-protocol-abstraction.md)),
landed across `server/core`, `server/physical`, `server`, and `client`:

- `schema_types`: the new `protocol_registry` module, the `ProtocolConfig`
  rewrite, the `ProtocolSchema` field removal, and the preset rewrite;
- `schema`: the single `create_engine` dispatch;
- `physical`: the `transport` test-data and byte-simulation dispatch;
- `server`: the model catalog projection, node port derivation, and the
  `graph_ops` inject/derived paths;
- `client`: the wire-shape adaptation across stores, panels, displays, and
  tests, plus the new `protocolConfig` utility module;
- the change file `.changes/protocol-registry.md`.

## Findings

- `ProtocolConfig` is now `{ protocol: ProtocolId, params: Value }`.
  `ProtocolId` is a newtype over `String`, so the set of protocols is open at
  the type level: a protocol added to the registry needs no client change and no
  TypeScript regeneration beyond the shared `{ protocol: string, params:
  unknown }` shape. `ProtocolConfig` derives `PartialEq` only, because
  `serde_json::Value` has no `Eq`; the manual `Deserialize` routes through
  `new`, so an unvalidated configuration cannot be constructed from the wire.
- `ProtocolRegistry` holds seven `ProtocolDefinition` rows
  (`justFloat`, `fireWater`, `rawData`, `slcan`, `candleLight`, `logicDecode`,
  `custom`). Each row carries the parameter JSON-Schema, the default
  parameters, the decode/encode direction, the `EngineKind`, the port rule
  (`Str`, `Channels`, or `Schema`), the rate dimension, and guidance text. The
  model catalog projects these rows directly instead of a parallel
  `PROTOCOL_PRESETS` table, so a new protocol is one definition and no catalog
  edit.
- The engine dispatch is one exhaustive match on `EngineKind` in
  `schema::create_engine`. `pipeline::create_engine` is a pure forwarder. The
  previous `compile_preset`/`compile_protocol` pair — which disagreed about
  `LogicDecode`, resolving it to `RawDataEngine` on one path and
  `LogicDecoderEngine` on the other — is gone.
- The `LogicDecode` engine keeps its identity under malformed parameters:
  `create_engine` falls back to `LogicDecoderConfig::default()` rather than to
  `RawDataEngine`, so a configuration that reaches the engine without going
  through `ProtocolConfig::new` still parses as logic samples. This is the same
  defect class the two-path dispatch had — one protocol, two frame shapes.
- The `Diagnostic` variant is deleted. Diagnostics run through the
  `automotive_diag` node driver, which is a driver-level concern rather than a
  byte-protocol one; the survey's acceptance sentence for `Diagnostic` is met
  by having zero protocol dispatch arms rather than one.
- `SchemaPreset` and `ProtocolSchema::preset`/`preset_config` are deleted. The
  protocol identity lives only in `ProtocolConfig.protocol`, so a frame
  definition cannot disagree with the node configuration about which protocol
  produced it.
- Port derivation has one source: `schema_types::protocol_port_names`. The
  catalog descriptor, `graph_ops::inject`, `graph_ops::derived`, and
  `app::describe` all route through it, which removed the previous
  `channels_from_config` duplicate.
- The simulation encoders were removed from `schema_types`. `test_data.rs` and
  `byte_simulation.rs` intentionally produce different bytes for the same
  protocol, so they now dispatch on `EngineKind` locally; the previous shared
  encoder forced one of them to be wrong. `test_data_tests.rs` pins
  `test_data.rs` byte for byte.
- Verification: `cargo fmt --check`, `cargo clippy --workspace --all-targets`,
  and `cargo test --workspace` pass in all four Rust workspaces; `pnpm
  typecheck`, `pnpm lint:ci`, and `pnpm test` pass in the client (1506 tests);
  the umbrella gates listed below pass.
- Condition: the client still holds a hardcoded protocol id list
  (`CHANNEL_PROTOCOLS`, `SIMULATION_ENCODING_FORMATS`, the form labels) and a
  frame-rate set mirroring `RateDimension::Frames`. These are display mirrors
  with no validation authority — the backend rejects an invalid configuration —
  but they are exactly what W6 removes when the catalog carries the guidance.

## Follow-ups

- W4 (block handlers) can now key `BlockCodec` on the `EngineKind` dispatch
  rather than on protocol identity, because no protocol-specific arm remains in
  the engine path.
- W6 owns the client de-hardcoding: replace `CHANNEL_PROTOCOLS`,
  `SIMULATION_ENCODING_FORMATS`, and `FRAME_ORIENTED_PROTOCOLS` with
  registry-driven descriptors. Owner: Lissio maintainers. Next review trigger:
  the catalog v3 and guidance workstream, which must carry the parameter
  schema and the rate dimension to the client.
- The survey's open question about whether `custom` should remain a registered
  protocol id is settled: it does, as an ordinary row whose engine is
  `SchemaEngine`.
