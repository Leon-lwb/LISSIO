---
"lissio": minor:changed
---

Device drivers now open through a prepared node: validation returns a typed
`PreparedNode`, opening consumes it, and the acquisition source factory no longer
carries an opaque validated configuration between validation and open. Driver
behaviour, topology, and wire contracts are unchanged.
