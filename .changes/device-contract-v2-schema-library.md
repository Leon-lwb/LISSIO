---
"lissio": major:changed
---

Schema documents now identify their format and encoding semantics, retain virtual source-file bundles, and reject the previous IR-only identity format. Wire decoders select messages and framing explicitly and preserve successful messages before a later error; data with an unknown next boundary stops decoding. Added a shared schema/profile library with atomic persistence, corruption isolation, and reference-protected schema deletion.
