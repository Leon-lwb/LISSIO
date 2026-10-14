---
"lissio": patch:fixed
---

Reduce Linux deb and AppImage sizes by disabling release debug information and
stripping symbols from the desktop shell and bundled backend sidecar. Keep full
symbols available in an opt-in `profiling` Cargo profile for performance analysis.
