---
"lissio": minor:changed
---

Driver manifests, port operations, and session capability declarations now use
the single `CapabilityMask` vocabulary from `data_model::device_tree`. The
parallel `acquisition::CapabilitySet` type is gone, so the IPC capability
payloads spell the invoke operation as `invoke` (previously `method`) and carry
the two CAN frame bits. No compatibility branch reads the previous spelling.
