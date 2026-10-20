# Prepared-node driver contract review

<!-- lissio-review
date: 2026-10-20
scope: Implementation of the prepared-node driver contract in physical, and the remaining decision about the acquisition source port
reviewer: implementation agent; maintainer sign-off pending
verdict: passed-with-conditions
-->

## Scope

Reviewed the driver-contract workstream of the device and protocol abstraction
survey ([`2026-10-20-device-protocol-abstraction.md`](2026-10-20-device-protocol-abstraction.md)),
landed in `server/physical` as commit `4efa4d3` and in `server` as commit
`4efff8d`:

- the `device-tree` contract, registry, subtree runtime, and shared source
  runtime support;
- the `acquisition` source factory, supervisor, and builder;
- the byte-transport, Modbus TCP/RTU, Siemens S7, CAN-channel, ISO-TP,
  diagnostic, simulation, protocol-engine, and root drivers, with their
  fixtures, benches, and loop tests;
- the catalog stub driver in `server`, the change file, and the
  [`device-tree` architecture document](../../../server/physical/docs/architecture/device-tree.md).

## Findings

- `NodeDriver::validate` returns `Box<dyn PreparedNode>`, and `open` moved onto
  that value. Each driver now carries its parsed configuration in a private
  prepared type, so the open path performs no `Any` downcast and an
  unvalidated configuration cannot reach it. `ValidatedNodeConfig`,
  `SourceValidationState`, and `NodeDriver::open` are deleted; the public
  `device-tree` and `acquisition` APIs contain no `dyn Any`.
- `acquisition::ValidatedConfig` is deleted. `SourceFactory::validate` is a
  side-effect-free check and `SourceFactory::open` parses the payload it is
  given, so the supervisor reopens from the same payload instead of holding a
  one-shot opaque handle. Invalid payloads still stop reconnection immediately;
  connection failures still back off and retry.
- `SourceRuntimeBuilder` implements `PreparedNode` and derives ports, address
  spaces, declared capabilities, discovery, and browse from the factory. The
  byte, Modbus, and S7 drivers therefore deleted their duplicated open path and
  their `address_spaces` bookkeeping.
- The driver contract test iterates `DriverRegistry::driver_ids` instead of a
  hardcoded driver; the simulation driver is covered through its requirement of
  a source parent, because its open path needs the parent assembly port that a
  pure driver fixture cannot supply.
- Verification: `cargo fmt --check`, `cargo clippy --workspace --all-targets`,
  and `cargo test --workspace` pass in `physical` (40 test targets) and `server`;
  `check:architecture`, `check:deps`, `check:contracts` (197 files),
  `check:changes`, `check:docs`, `check:web-contract`, `check:model-catalog`,
  `check:rust-size`, and `pnpm test` pass in the umbrella.
- Gap: a source adapter still implements two traits. `NodeDriver` owns topology
  identity, child policy, metadata, and validation; `acquisition::SourceFactory`
  owns the session, discovery, simulation, and point descriptors that
  `SourceRuntime` holds for the lifetime of the node. The duplicate
  validate/open adapter layer is gone, but the survey's acceptance sentence
  "each adapter implements one trait" is only met in the sense that `NodeDriver`
  is the single driver contract, not in the sense that a source adapter
  implements one trait in total.

## Follow-ups

- Decide the source-port shape before the next driver-contract review: either
  fold session creation into `PreparedNode` so a source adapter implements
  `NodeDriver` alone, or state that `SourceFactory` remains the acquisition
  session port and amend the survey's acceptance sentence accordingly. Owner:
  Lissio maintainers. Next review trigger: the catalog and guidance workstream,
  which revisits driver descriptors and must record the decision.
- The protocol registry, block handlers, catalog v3, and client de-hardcoding
  workstreams of the survey remain open and are unaffected by this change.
