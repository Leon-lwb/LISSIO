---
"lissio": minor:added
---

Models now describe themselves fully enough that the client renders them without
per-driver or per-protocol code. The catalog contract moves to v4: protocol
descriptors publish `protocolTraits` (engine, static port face, rate dimension,
direction flags), driver descriptors name their own `ui.editorKey` and `ui.icon`
instead of one value per family, guidance carries translation keys for its
summary, when-to-use text, and setup steps, and the simulation source is part of
the catalog. Configuration schemas carry per-field label and enum keys derived by
`data_model::form_hints`, so the frontend no longer keeps a field-label
dictionary.

On the client, one descriptor projection layer replaces the protocol, encoding,
and frame-rate id lists; forms render the documented field-hint vocabulary and
show validation issues inline at their `ModelIssue.path`; the protocol editor
gains a bounded parse preview using the backend engine; guidance (including the
101 translated keys) renders from the catalog in Chinese with English fallback;
discovery shows the recommended driver and confidence, and an SLCAN bridge now
recommends `slcan` instead of `serial`, so the one-action create opens the right
driver. The hand-written `CanFrame`, `CanDirection`, and `InputFormat` copies are
gone in favour of the generated wire types, and the palette no longer requests a
`protocol:JustFloat` id the catalog never had.
