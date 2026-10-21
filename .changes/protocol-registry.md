---
"lissio": minor:changed
---

Protocol configuration is now `{ protocol, params }`: a registry id plus that
protocol's own parameters. The `ProtocolConfig` enum is gone, and with it the
`Diagnostic` variant — diagnostic sessions run through the `automotive_diag`
node driver instead. `ProtocolSchema` keeps only `decode`/`encode`; the
`preset`/`presetConfig` fields are gone, so a frame definition names no protocol.

One registry, `schema_types::ProtocolRegistry`, holds every protocol as a
`ProtocolDefinition` (id, parameter JSON-Schema, default parameters, direction,
engine kind, port rule, rate dimension, guidance). The model catalog, the
protocol engine factory, and node port derivation all read it, so adding a
protocol is one table row and no new dispatch arm.

Persisted graphs and simulation encodings written in the previous spelling
(`{"kind": "JustFloat"}`) no longer load; there is no compatibility branch.
