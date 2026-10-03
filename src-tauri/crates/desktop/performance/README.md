# performance

`performance` owns backend-side performance sampling for Lissio's unified
monitor:

- current process CPU, resident memory, uptime, and thread/task count;
- bounded RPC dispatch latency statistics;
- WebSocket output and bounded-queue drop counters;
- projection of typed data-plane diagnostics into the backend wire contract.

The frontend owns browser/WebView frame timing, long-task, and JS heap samples.
The UI merges the two sources but does not infer backend state from frontend
timers. See `docs/architecture/crates.md` for the ownership boundary.
