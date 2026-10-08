# Device Tree Crate

<!-- lissio-doc
status: maintained
owner: Lissio maintainers
last-reviewed: 2026-10-07
applies-to: Persistent topology and driver/runtime contracts
-->

`device-tree` persists device topology and owns node-driver contracts, typed
runtime capability projection, capability closure validation, and subtree
lifecycle.

This crate does not depend on hardware or external SDKs. Adapters implement
`NodeDriver` and return a typed `NodeRuntime` port projection that composition
roots inject. See `docs/architecture/device-tree.md`.

The built-in `protocol-engine` driver uses version 1 of
`schema_types::ProtocolNodeConfig`. Protocol nodes must be children of a byte
source: a real source, test signal, byte simulator, or another protocol node.
The driver projects raw parent bytes and subtree lifecycle; the pipeline derives
evaluation for parsed values, frames, and converted bytes. Closing a protocol
node cancels its byte subscription without closing the shared parent source.
