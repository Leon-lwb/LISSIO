---
"lissio": noop:changed
---

Removed the `jobs = 2` cap from `.cargo/config.toml`. Cargo has no unlimited
setting — a negative value is still a cap ("CPUs plus the value") — so omitting
the key is the only way to let Rust builds use the default, which is the logical
CPU count and therefore the maximum this machine offers. The `CARGO_BUILD_JOBS`
cap in the CI workflow and the `RUST_TEST_THREADS` pin are unchanged: the first
keeps cargo from competing with the browser probes, and the second is a test
thread limit rather than compile parallelism. Machines with little memory can
still opt back in per invocation with `cargo -j N` or `CARGO_BUILD_JOBS=N`.
