---
"lissio": minor:added
---

The shared model catalog contract is version 3. A descriptor now carries the
static ports a model exposes, the roles it may be attached under, the
capability mask it exposes once opened, and guidance (summary, when-to-use,
setup steps, examples, and an optional docs key). Driver descriptors project
these from `NodeDriver`; protocol descriptors project guidance from the
protocol registry. A renderer no longer needs a per-driver or per-protocol
whitelist for display.

`validate_adapter_configuration` returns the normalized payload together with
structured issues. Structural issues come from the form-subset validator over
the driver's configuration schema and carry a field path; driver semantic
errors carry the root path. A bad configuration is an issue, not a failed
command.

`preview_protocol` parses a bounded window with the same protocol engine the
runtime uses. Given an open node it captures at most 4 KiB or 500 ms from that
node's byte subscription and releases the subscription before returning;
otherwise it parses the supplied input. It returns the raw HEX, parsed data and
CAN frames, structured issues, and a truncation flag, and it never opens
hardware.

Discovered endpoints gained `suggestedDriver` and `confidence`, so discovery
results can be ranked without a hard-coded adapter table.
