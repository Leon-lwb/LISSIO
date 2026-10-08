# Crate Domains

<!-- lissio-doc
status: maintained
owner: Lissio maintainers
last-reviewed: 2026-10-07
applies-to: Rust workspace directory and dependency organization
-->

Crates are grouped by business domain at `crates/<domain>/<crate>`. Directories
are navigation aids only; dependency direction is declared by each crate's
`[package.metadata.lissio]` entry and checked with `pnpm check:architecture`.

Do not add layer directories or facade-only crates. A crate may depend directly
on an allowed lower layer.

The unified acquisition plane is divided by ownership: `shared/flow` owns
generic delivery envelopes and byte boundaries, `protocol/points` owns rich
point semantics, `protocol/acquisition` owns source lifecycle and typed lanes,
and `transport/modbus-adapter` owns the optional Modbus TCP/RTU SDK adapter.
The protocol-neutral capability contract remains in `protocol/acquisition`.
