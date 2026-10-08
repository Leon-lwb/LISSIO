# Modbus Capability Contract and Device Cards

<!-- lissio-doc
status: maintained
owner: Lissio maintainers
last-reviewed: 2026-10-07
applies-to: Stable adapter capabilities and frontend projection
-->

## Stable boundary

The backend `acquisition` crate is authoritative for adapters, endpoints, and
typed port capabilities. IPC publishes `AdapterCapability` with
`contractVersion = 1`, including stable adapter and protocol identifiers,
transport, direction, operations, data domains, endpoints, ports, address
spaces, configuration JSON Schema, runtime availability, and display semantics.
Display metadata contains only category, symbol, and semantic labels—not Rust
or React type names.

The stable adapter IDs are `modbus-tcp` and `modbus-rtu`. Each publishes a
bidirectional `points` port supporting reads, polling subscriptions, and writes
over zero-based address spaces:

| Area | Address | Read | Write |
| --- | ---: | --- | --- |
| Coils | 0–65535 | yes | yes |
| Discrete inputs | 0–65535 | yes | no |
| Input registers | 0–65535 | yes | no |
| Holding registers | 0–65535 | yes | yes |

Point types include Boolean values, signed and unsigned 16/32/64-bit integers,
`f32`, and `f64`. Byte order, word order, scale, offset, and poll interval are
explicit configuration. TCP configuration covers host, port, unit, timeout,
reconnect, and points. RTU replaces network address fields with port name, baud
rate, data bits, parity, stop bits, and flow control. Unknown configuration
fields are preserved for forward compatibility.

## Frontend projection

The frontend obtains and caches the capability catalog and refreshes both
catalog and discovery results. Every backend `EndpointDescriptor` becomes one
row in the Connected Devices group, using the same shape as built-in interfaces.
The left side shows only the backend-provided icon and name.

The frontend does not own protocol names, driver IDs, port domains, or renderer
registration. Selecting or dragging an endpoint creates an interface node. Its
properties form is generated from JSON Schema in the existing Properties tab.
Adding an adapter therefore does not require a frontend registry change.

## Session and data semantics

Endpoints are opened and closed independently. Point reads return typed values
and quality. Poll subscriptions deliver bounded samples and explicit overflow
diagnostics. Writes are accepted only for writable address spaces and return
the authoritative result.

## Compatibility

Stable IDs and `contractVersion = 1` are public contract. JSON configuration is
validated by the backend; patch merge, schema defaults, and validation rules are
owned there.

## Test boundary

Unit and integration tests cover schema generation, address projection,
read/write semantics, polling, reconnects, and unknown fields. Local simulation
does not prove real PLC behavior, USB/RS-485 electrical compatibility,
vendor-specific offsets, hot-plug behavior, noise endurance, platform serial
permissions, 24-hour soak behavior, or multi-vendor interoperability. Those
claims require hardware validation before release.
