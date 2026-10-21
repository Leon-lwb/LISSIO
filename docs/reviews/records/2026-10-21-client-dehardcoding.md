# Client de-hardcoding and guidance review

<!-- lissio-review
date: 2026-10-21
scope: W6 of the device and protocol abstraction survey: descriptor-driven forms, role and port resolution, protocol preview, generated templates, and translated guidance
reviewer: implementation agent; maintainer sign-off pending
verdict: passed-with-conditions
-->

## Scope

Reviewed the last workstream (W6) of
[`2026-10-20-device-protocol-abstraction.md`](2026-10-20-device-protocol-abstraction.md),
whose acceptance criterion is that no driver id or port name literal is matched
in `client/src` and that a new protocol or adapter needs no React change:

- `server/core` — `data_model::model_descriptor`: `ProtocolTraits`,
  `ProtocolEngineKind`, `ProtocolPortKind`, `ProtocolRateDimension`,
  `ProtocolDirections`, `ModelDescriptor::protocol_traits`,
  `ModelGuidance::setup_step_keys`, `MODEL_CATALOG_CONTRACT_VERSION` 3 → 4, and
  the new `data_model::form_hints` key derivation;
- `server/physical` — `ui_hints` field `labelKey`/`enumLabels` for the byte
  transports, Modbus, and S7; `can-transport` SLCAN discovery recommendation;
- `server` — catalog projection of protocol traits, per-driver editor identity
  and icons, generated guidance keys, the composed-catalog contract test, and
  the contract export list;
- `client` — the descriptor projection layer, descriptor-driven forms and
  validation, bounded protocol preview, guidance rendering with the zh resource
  set, discovery recommendation, quickstart defaults, and wire-type dedup.

## Findings

- **The v3 catalog could not satisfy W6.** Protocol descriptors projected
  display, configuration, defaults, and prose only: `ports` was empty,
  `capabilities` absent, and `rate`, `directions`, and `portKind` were not
  projected at all, even though the protocol registry owns them. `ui.rendererKey`
  and `ui.editorKey` were family constants and `ui.icon` was always absent, so
  the client could not dispatch the simulation and protocol editors from the
  catalog. Guidance keys and examples were declared but never emitted anywhere
  in `server/`. The registry review
  ([`2026-10-20-protocol-registry.md`](2026-10-20-protocol-registry.md)) had
  already required the rate dimension on the client side. Without a contract
  change W6 would have replaced one client whitelist with another, so the
  contract moved to v4 instead of documenting the gap as a follow-up.
- **v4 projects registry facts, not a second table.** `ProtocolTraits` is a
  direct projection of the `ProtocolDefinition` row (`engine`, `ports`, `rate`,
  `directions`), so a new protocol appears in the catalog with its semantics and
  the client derives the frame-rate unit, the encodable format list, and the
  `str`/channel/schema port face from it. Driver editor identity is chosen from
  driver identity and node role, and the simulation source is now a catalog
  entry rather than an exclusion. A catalog test pins the traits of the channel,
  `str`, frame-oriented, and decode-only protocols, a wire test pins the camelCase
  spelling, and a composed-catalog test requires traits on every protocol and no
  traits elsewhere.
- **Guidance keys are generated, flat, and complete.** The catalog derives
  `guidance_<family>_<id>_summary|_whenToUse|_step<n>` from the model id;
  `data_model::form_hints` does the same for field and enum keys. Both rules live
  in the contract layer because the frontend resources are named by them, and
  both are pinned by Rust tests plus a 101-key parity test on the client. Keys
  are flat because i18next treats `.` and `:` as structure.
- **SLCAN discovery was recommending the wrong driver.** `CanTransportBackend`
  delegated SLCAN discovery to the serial probe and kept its `serial`
  recommendation, so a one-action create would have opened a serial endpoint for
  a CAN bridge. The recommendation is now rewritten to `slcan` with full
  confidence while the discovery evidence stays the probe's, and the client
  creates `suggestedDriver` first, falling back to `adapterId`.
- **Form labels moved from a TS dictionary to schema hints.** The 50-entry field
  dictionary and 28-entry enum dictionary are gone; adapters emit `labelKey` and
  `enumLabels` derived by the shared helper, and a field without a hint falls
  back to the schema's own title/description. Numeric enum spellings
  (`data_bits` 5–8) deliberately carry no label key, so the form shows the
  number instead of a bare key string.
- **The frontend keeps a single projection layer per vocabulary.**
  `lib/models/descriptorView.ts` is the only reader of catalog facts and
  `lib/models/nodePorts.ts` is the only reader of `describe` ports and the only
  place a handle literal survives. Port decisions are made by direction plus
  payload domain (`domain`/`connectDomains`), so a protocol's `in`/`out`, a
  transport's `rx`/`tx`, and a decoder's raw passthrough are resolved from the
  runtime description rather than remembered by each caller.
  This is the reading of the W6 criterion recorded here: no rendering or
  capability decision compares a driver or protocol id. What remains outside
  that boundary is deliberate: catalog ids are used to *construct* create
  requests (the backend validates them), and `nodePorts` keeps documented
  fallbacks for the window between mount and the first `describe` response.
  Widget-local vocabulary (`loopbackOut`, the spectrum widget's port, the
  palette's `test-data` attribute) is UI structure, not a model registry.
- **The form and the graph now show the same facts the backend validates.**
  Forms render the documented hint vocabulary and place each `ModelIssue` at its
  `ModelIssue.path`; `validate_adapter_configuration` runs on commit and keeps
  the payload editable on an issue, while `preview_protocol` renders a bounded
  HEX/frame preview from the same engine the runtime uses. Both commands existed
  with no caller before this change.
- **Client defaults now come from the catalog.** Quickstart templates take device
  and protocol configuration from `defaultConfig`/guidance examples instead of
  re-spelling it in TSX, and the palette requests `protocol:justFloat` instead of
  the id `protocol:JustFloat` that never existed.

## Follow-ups

- The form-subset validator still skips `pattern`, `additionalProperties`, and
  `oneOf`; a schema that needs them is rejected as unsupported rather than
  silently half-validated.
- `preview_protocol` does not project a logic-decoder preview yet; the command
  reports the raw window and issues for those protocols.
- Quickstart graph topology (nodes, edges, layout) remains client-side. Only
  per-model configuration is descriptor-driven; a backend topology template is a
  separate decision.
- The zh guidance resources are complete for the current catalog; a new model
  must land its keys in the same change, and the parity test is what enforces it.
