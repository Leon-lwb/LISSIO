# Performance Crate

<!-- lissio-doc
status: maintained
owner: Lissio maintainers
last-reviewed: 2026-10-07
applies-to: Backend performance sampling ownership
-->

`performance` owns backend sampling for Lissio's unified monitor:

- process CPU, resident memory, uptime, and thread/task counts;
- bounded RPC dispatch latency;
- WebSocket output and bounded queue drop counters;
- typed data-plane diagnostics projected into the backend wire contract.

The frontend owns browser/WebView frame timing, long tasks, and JavaScript heap
samples. The UI merges both sources without inferring backend state from
frontend timers. Ownership boundaries are documented in
`docs/architecture/crates.md`.
