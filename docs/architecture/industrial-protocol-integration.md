# Industrial Protocol Integration Architecture

<!-- lissio-doc
status: maintained
owner: Lissio maintainers
last-reviewed: 2026-10-07
language: en
authoritative: true
applies-to: Industrial protocol integration architecture, selection, and release evidence
-->

This document defines how industrial protocols enter the typed acquisition
plane. It records stable boundaries and evidence requirements; it does not
promise unverified hardware support.

## Core decisions

1. Protocol adapters enter through `protocol/acquisition`, not through the
   frontend or node graph.
2. Adapters publish typed point capabilities and byte streams. Rich point
   semantics remain separate from generic byte envelopes.
3. Driver-owned payloads may be open JSON, but the surrounding capability
   contract is versioned and stable.
4. Composition roots register actual adapters. Lower layers depend on ports.
5. A protocol is supported only after license, dependency, failure, and
   interoperability evidence passes.

## Relationship to the byte plane

Existing byte sources continue through `TransportConnection`. Industrial
adapters may expose bytes, typed points, or both. Byte routes feed protocol
engines and recording. Point routes feed acquisition lanes and node inputs.
Both preserve source lifecycle and explicit quality.

## Licensing and selection

| Candidate | Current position | Reason |
| --- | --- | --- |
| Modbus TCP/RTU | Integrated | Mature semantics, typed points, explicit adapters |
| Siemens S7 via `tokio-s7` | Integrated | Async Rust client with project-owned reconnect and addressing |
| OPC UA | Candidate | Broad industrial coverage but large stack and security surface |
| MQTT / `mqtt5` | Parallel validation | Feature-rich, but release churn and session/encoding issues need pinned tests |
| EtherCAT `ethercrab` | Separate privileged route | Raw interface and realtime constraints do not fit desktop default paths |
| CANopen | Linux experiment | Limited maturity and SocketCAN dependency |
| DNP3 | No default Rust route | Mature options are non-Rust or archived |
| KNX `knx-rs` | Blocked | GPL-3.0-only is not selected and creates Apache distribution risk |
| Snap7 bindings | External tool only | C/C++ FFI and LGPL/license chain are outside the allow-list |
| BACnet `bacnet-rs` | Not released | Missing production behavior and interoperability evidence |

Permissive branches of dual-licensed dependencies must be selected explicitly.
Single-license GPL, AGPL, SSPL, BUSL, Elastic, or non-commercial dependencies
are not accepted into linked current Apache-2.0 production code.

## Crate ownership and dependency direction

- `protocol/acquisition` owns source lifecycle, typed lanes, and stable
  capability envelopes.
- `shared/flow` owns generic delivery and byte boundaries.
- `protocol/points` owns rich typed values.
- `transport/modbus-adapter` and `transport/s7-adapter` own SDK adapters.
- `device-tree` owns persistent topology and driver/runtime contracts.
- `pipeline` routes bytes and derives graph evaluation.
- `backend-host` registers adapters at the composition edge.

## Delivery envelopes

Generic envelopes remain protocol-neutral. Driver-specific payloads live under
a stable adapter ID and schema version. Common fields cover source, sequence,
timestamp/clock semantics, quality, diagnostic state, and typed payload.

## Rich point semantics

Values include Boolean, signed and unsigned integers, floating point, strings,
and raw bytes where explicitly supported. Descriptors include stable point ID,
address, type, unit, access, scan/poll policy, scaling, quality, and metadata.

Timestamps use source clock semantics. Arrival time is diagnostic, not the
primary sampling time. Missing or stale data is explicit.

## Capability traits

Adapters combine capabilities instead of implementing a lowest common
denominator:

- connect and disconnect;
- list endpoints and points;
- read single or batched points;
- write where supported;
- subscribe/poll;
- diagnostics and reconnect;
- optional byte stream projection.

Each capability has typed request and response DTOs. Unsupported operations are
declared rather than silently accepted.

## Acquisition intent and adapter planning

The public acquisition intent states desired points, cadence, quality, and
delivery. Adapters plan batch reads, grouping, timeouts, and retries privately.
Planning results are observable through diagnostics without becoming public
wire contract.

## Runtime data flow and backpressure

A source supervisor owns connection and reconnect. Typed lanes distribute
samples. Bounded queues make overflow explicit. Recording, graph evaluation,
and display fan-out are separate consumers. Losses mark gaps and reset
stateful derived operations.

## Projection into graphs

Typed points project into graph inputs without erasing units or quality.
Protocol byte engines project parsed frames and values. Derived outputs carry
explicit timestamps. The frontend does not invent conversion rules.

## Frontend, IPC, and persistence

The capability catalog generates device cards and forms. IPC exposes
adapters, endpoints, points, reads/writes, subscriptions, and diagnostics.
Configuration is stored in current format. Unknown fields are preserved only
where the adapter supports open payloads.

## Protocol facets

### Modbus TCP

Owns TCP connection, unit addressing, request scheduling, timeout/reconnect,
and zero-based coil/discrete/input/holding address spaces.

### Modbus RTU

Adds serial framing, baud/parity/stop/flow configuration, inter-frame timing,
and RS-485 adapter constraints.

### OPC UA

Would require endpoint discovery, secure channel policy, session recovery,
node IDs, subscriptions, and namespace mapping. It is not a default adapter
until those boundaries are validated.

### MQTT

Would require session/persistent subscription semantics, topic mapping,
payload encoding, QoS behavior, and reconnect tests against a pinned library
version.

### Siemens S7

Uses explicit I/Q/M/DB addressing. The adapter owns reconnect and limits
upstream auto-reconnect. Real PLC read/write, block-size, and datatype behavior
requires hardware evidence.

### Other protocols

CANopen, EtherCAT, DNP3, BACnet, and KNX remain candidates or external tools
until their maturity, privilege, license, and platform constraints are solved.

## Test contract and release gates

Tests cover schema, capability declaration, read/write mapping, quality,
timeouts, reconnect, malformed responses, queue overflow, and persistence.
Cross-platform serial permissions and hardware results are separate evidence.

Release gates include dependency and license checks, generated contracts, model
catalog, architecture, typecheck, unit/integration tests, and documented
hardware verification for any claimed protocol support.

## Implemented structure and remaining boundary

Modbus TCP/RTU and S7 are implemented behind shared acquisition contracts.
Remaining work is evidence expansion: real PLCs, multi-vendor gateways,
electrical terminal behavior, hot-plug, noise endurance, permissions, long
soak, and interoperability. Local simulation cannot establish those claims.

## Product input still required

Before expanding protocol scope, product decisions are needed on supported
devices, quality semantics, write authorization, diagnostic visibility,
offline behavior, and release support windows.
