# Database backend investigation documentation review

<!-- lissio-review
date: 2026-10-08
scope: New database backend plan document, its index registration, the recording store port statement in the crate architecture, and the DuckDB-versus-SQLite benchmark evidence recorded in it
reviewer: implementation agent; maintainer sign-off pending
verdict: passed-with-conditions
-->

## Scope

Reviewed the documentation outcome of the database backend investigation and the
recording store port extraction: the new authoritative document
[`server/docs/architecture/database-backend-plan.md`](../../../server/docs/architecture/database-backend-plan.md),
its registration in [`../README.md`](../README.md), the recording-boundary
statement in [`server/docs/architecture/crates.md`](../../../server/docs/architecture/crates.md), and the
benchmark and build-cost measurements the plan cites. The port extraction itself
changed Rust source under `src-tauri/crates/data/recording`; it is recorded here
only as the fact the architecture statement describes.

## Findings

- The plan's central finding is that SeaORM has no DuckDB driver, so the request
  is an engine replacement rather than an added abstraction layer; SeaORM 2.x is
  the only mainstream Rust ORM that selects an engine at runtime from one binary.
- The store port now lives in
  `src-tauri/crates/data/recording/src/port.rs`: `StoreEngine` opens sessions and
  owns recovery, `StoreSession` is the writer thread's single handle, and
  `backend/` is the only module that names DuckDB. Behavior is unchanged —
  `cargo test -p lissio-recording` passes 42 tests across the unit, cleanup, and
  recording suites, and `cargo check --workspace --all-targets` succeeds.
- The recorded benchmark ran on `9f41605`, Apple Silicon (`aarch64`), DuckDB
  1.5.5, SQLite 3.53.2, 256 MiB per case, through the existing
  `lissio-recording` storage harness. DuckDB reached 58.8–220.3 MB/s and SQLite
  38.3–80.2 MB/s; the aggregate query took 739–2 028 ms on DuckDB and 0.07–2.3 ms
  on SQLite. The document states the asymmetries: the SQLite case commits once,
  and the DuckDB aggregate figure is dominated by connection startup.
- Build-cost measurements were taken from the local build tree: the `duckdb`
  crate pulled 145 transitive crates against 17 for `rusqlite`, `libduckdb.a` is
  1.6 GB, the release build directory is 5.0 GB, and the benchmark's cold build
  took 8m 28s.
- The benchmark is a single-run comparison snapshot; the repository has no
  committed storage baseline, and the document says so rather than presenting the
  numbers as a baseline.
- `pnpm check:docs` passes with the plan document and this record indexed
  (64 workspace packages on Apache-2.0, 62 authoritative documents), and
  `pnpm check:rust-size` passes with the new port and backend modules inside the
  file-size limit.

## Follow-ups

1. Decide whether remote engines may serve as primary recording storage, which
   changes the contract in `architecture/crates.md`. Owner: maintainer.
2. Decide whether one build carries every engine or one engine per build, which
   sets binary size and feature-matrix width against configuration-level
   switching. Owner: maintainer.
3. Decide the fate of DuckDB-dialect read-only user SQL and Parquet export, the
   two surfaces a store port cannot abstract. Owner: maintainer.
4. Confirm or amend this record's reviewer and verdict, which were prepared by the
   implementation agent. Owner: maintainer.
