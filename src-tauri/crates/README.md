# Crate domains

Crates are grouped by business domain: `crates/<domain>/<crate>`.
The directory is for navigation only; dependency direction is defined by each
crate's `[package.metadata.lissio]` entry and checked by
`pnpm check:architecture`.

Do not add layer directories or facade crates. A crate may directly depend on
any allowed lower layer.

The unified acquisition plane is split by ownership: `shared/flow` owns generic
delivery envelopes and byte boundaries, `protocol/points` owns rich point
semantics, `protocol/acquisition` owns source lifecycle and typed lanes, and
`transport/modbus-adapter` contains the optional Modbus TCP and RTU client SDK
adapter. The protocol-neutral, versioned capability contract stays in
`protocol/acquisition`; the desktop composition root exposes it through IPC.
