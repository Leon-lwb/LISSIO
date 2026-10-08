# Database Backend Plan: Pluggable Store Beyond DuckDB

<!-- lissio-doc
status: maintained
owner: Lissio maintainers
last-reviewed: 2026-10-08
applies-to: Recording storage engine selection, backend adapters, and the database feature gate
-->

This document answers whether the acquisition recording store keeps DuckDB,
adopts SeaORM, or becomes a pluggable relational store, and it fixes the
boundary between the store, its engine adapters, and the frontend. Crate
ownership, dependency layers, and the recording contract stay in
[`crates.md`](crates.md); this document does not restate them.

## Requirements under investigation

1. Replace DuckDB with SeaORM.
2. Ship the database capability as a Cargo feature that the default build
   includes, with the runtime recording switch still defaulting to off.
3. Expose a configurable database page in the frontend.
4. Let the user point recording storage at different relational engines and
   switch between them.

## Finding: SeaORM has no DuckDB backend

SeaORM ships MySQL/MariaDB, PostgreSQL, and SQLite drivers; SQL Server lives in
the commercial SeaORM-X line. DuckDB is not among them
([SeaORM drivers](https://www.sea-ql.org/SeaORM/docs/install-and-config/database-and-async-runtime/#database_driver)).
"Introduce SeaORM to replace DuckDB" is therefore an engine replacement, not an
abstraction layer placed over the current engine. The two questions — which ORM,
and which engine — must be answered separately.

## Backend survey

| Option | Engines | Runtime engine switch | Shape | Assessment |
| --- | --- | --- | --- | --- |
| SeaORM 2.x (async, sqlx) | PostgreSQL, MySQL/MariaDB, SQLite; SQL Server in SeaORM-X | Yes — `DatabaseConnection` is chosen from the connection URL | Entity, migration, and query-builder ORM | Most mature multi-engine option; brings tokio and sqlx into the store |
| `sea-orm-sync` 2.0.3 | SQLite (rusqlite) | No | Synchronous ORM with the same API surface | Fits the current single writer thread; cannot switch engines ([SeaORM sync](https://www.sea-ql.org/blog/2026-02-28-sea-orm-sync/)) |
| Diesel 2.x | PostgreSQL, MySQL, SQLite | Partial — `MultiConnection` selects at runtime, but generic and `BoxableExpression` plumbing is required | Compile-time typed ORM | Not a configuration-level switch |
| rbatis | PostgreSQL, MySQL, SQLite, SQL Server | Yes | Dynamic SQL mapper | Weaker maturity and maintenance signal than SeaORM |
| Toasty | SQLite, PostgreSQL, MySQL | Yes | New async ORM | Pre-1.0; not suitable as the primary durable store |
| sqlx `Any` | PostgreSQL, MySQL, SQLite, SQL Server | Yes | Driver, not an ORM | Restricted type mapping and no compile-time checking under `Any` |

SeaORM 2.x is the only mainstream Rust ORM that selects an engine at runtime
from one binary. That satisfies requirement 4 at the connection layer only; the
costs in the next sections are not absorbed by the ORM.

## Current coupling to DuckDB

The recording crate is roughly 4 850 production lines and 1 500 test lines, with
113 direct DuckDB references. The engine-specific surfaces are:

| Location | DuckDB-specific surface | Portable to other engines |
| --- | --- | --- |
| `src/schema.rs` | `UBIGINT`, `BLOB` column types | Mostly; unsigned columns become 64-bit integers |
| `src/store.rs` | `preserve_insertion_order`, `threads`, `checkpoint_threshold` session pragmas; `AccessMode::ReadOnly`; `enable_external_access(false)`; `QueryReturnedNoRows` | No; each engine needs its own session setup |
| `src/export.rs` | `COPY (SELECT …) TO '…' (FORMAT PARQUET)` | No; Parquet requires an Arrow/Parquet writer or removal |
| `src/read_model.rs` | `ValueRef` typed extraction and the `SELECT * FROM (…) LIMIT n` result wrapper | Partially |
| `src/maintenance.rs` | `duckdb_indexes()`; the drop-index-before-delete workaround for DuckDB's fatal index inconsistency | No; the workaround becomes engine-specific |
| `src/repair.rs` | DuckDB catalog-damage classification and database-file quarantine | No; recovery semantics are engine-specific |
| `src/hub/wedge.rs`, `src/hub/guard.rs`, `src/hub/spawn.rs` | Windows forced-lock hang containment, process-level database-file guard, writability probe | No; these exist because of DuckDB file locking |
| `src/writer/channel.rs` | `InterruptHandle` query cancellation | No; cancellation is engine-specific |

Consumer surfaces that also name the engine:

- `src-tauri/crates/desktop/rpc-api/src/catalog.rs` lists fifteen recording
  commands, including `query_recording_sql`.
- `src-tauri/crates/desktop/control-api/src/capabilities/recording.rs` and its
  `docs/en` and `docs/zh` tool guides describe read-only SQL as DuckDB dialect.
- `src-tauri/crates/desktop/backend-cli/src/cmd/schema.rs` labels its SQL output
  as DuckDB dialect.
- `src/components/displays/recording/RecordingDatabaseView.tsx` offers Parquet
  as an export format.

Read-only user SQL and Parquet export are the two surfaces that cannot be
abstracted behind an entity layer, because both are engine dialect by
definition.

## Benchmark evidence

The recording crate already carries a DuckDB-versus-SQLite comparison harness
that writes the four acquisition domains as BLOBs and then runs one aggregate
query. It was run once on the revision below; it is a comparison snapshot, not a
committed baseline.

| Property | Value |
| --- | --- |
| Revision | `9f41605`, 2026-10-08 |
| Machine | Apple Silicon (`aarch64`), macOS |
| Engines | DuckDB 1.5.5 (`duckdb` 1.10505.0), SQLite 3.53.2 via `rusqlite` 0.40 |
| Payload per case | 256 MiB, benchmark `short_run` |
| DuckDB path | The real recording pipeline: bounded queue plus one writer thread |
| SQLite path | One transaction, WAL, `synchronous=NORMAL`, BLOB rows |

| Case | DuckDB | SQLite |
| --- | --- | --- |
| 64 KiB batches, compressible | 58.8 MB/s | 48.6 MB/s |
| 64 KiB batches, random | 62.9 MB/s | 46.1 MB/s |
| 1 MiB batches, compressible | 190.2 MB/s | 43.2 MB/s |
| 1 MiB batches, random | 204.8 MB/s | 80.2 MB/s |
| 4 MiB batches, compressible | 207.4 MB/s | 54.5 MB/s |
| 4 MiB batches, random | 220.3 MB/s | 38.3 MB/s |
| Aggregate query | 739–2 028 ms | 0.07–2.3 ms |
| Database file | 288 MB | 269 MB |

Caveats that bound these numbers:

- The SQLite case commits once, so it is an optimistic upper bound for a real
  implementation that commits and checkpoints per batch.
- The DuckDB aggregate runs on a freshly opened connection, so its one-second
  figure is dominated by DuckDB connection startup, not by the scan. This is why
  the single-connection discipline exists today.
- Neither engine reached the harness's 250 MB/s threshold; DuckDB reached
  100 MB/s only at batches of 1 MiB and above.
- Columnar scan throughput, Parquet output, and DuckDB-dialect SQL — the
  capabilities the product actually exposes — are not measured here.

Reproduce with:

```bash
cd src-tauri
VOFA_STORAGE_BENCH_BYTES=268435456 cargo bench -p lissio-recording --bench storage
```

## Build cost of the current engine

| Measure | DuckDB | SQLite (`rusqlite`) |
| --- | --- | --- |
| Transitive dependency crates | 145 | 17 |
| Static engine library | `libduckdb.a`, 1.6 GB | Bundled SQLite, far smaller |
| Release build directory | 5.0 GB | — |
| Clean build of the bench | 8m 28s on the machine above | — |

Engine replacement is worth recording for build and dependency cost alone,
independent of the ORM choice.

## Consequences for the recording contract

[`crates.md`](crates.md) fixes the behavior this plan must preserve: a database
that cannot be opened, a writer that stopped answering, a full queue, or the
switch being off all mean *no recording*, never *recording failed*, and only
accepted batches that cannot be persisted may stop a run.

- A local file engine preserves that contract directly. A remote engine turns
  "cannot be persisted" into network timeout, authentication failure, and
  unavailable-server cases, and it gives the bounded round-trip budgets (5 s run
  control, 10 s shutdown, 120 s maintenance and reads) a new meaning.
- A remote server has real concurrency. The single-connection discipline stops
  being a correctness requirement — it exists because multiple DuckDB instances
  checkpoint over each other — and becomes a deliberate serialization choice.
- Offline behavior changes: with a remote primary store, recorded history is
  unavailable without a network.

Requirement 4 therefore changes the recording contract, and that change has to
be accepted explicitly rather than inherited from the engine swap.

## Target architecture

```text
recording  (store contract, no engine dependency)
  ├── recording-sqlite    feature database-sqlite    (default)
  ├── recording-postgres  feature database-postgres  (optional)
  └── recording-mysql     feature database-mysql     (optional)
```

- `recording` keeps sessions, batches, recovery policy, and the writer
  discipline, and depends on a store contract instead of an engine.
- Each engine is a heavy optional adapter behind a feature, selected by
  `backend-host` at assembly time, which matches the existing adapter pattern in
  [`crates.md`](crates.md).
- The `database` feature is included by default, so the default build keeps the
  capability; the runtime switch `AppSettings.data.recordingEnabled` stays off by
  default, so a fresh install still opens no connection.
- SeaORM 2.x with sqlx is the entity and query layer across engines. The recording
  writer becomes an async task or blocks on a runtime; either way the bounded
  round-trip rule must survive the transition.

### Engine addressing

The configuration model is one backend identifier plus one connection string, so
SQLite is not a special case in code:

| Backend | Connection string shape |
| --- | --- |
| SQLite | `sqlite:///absolute/path/recordings.db` |
| PostgreSQL | `postgres://user@host:5432/database` |
| MySQL | `mysql://user@host:3306/database` |

SQLite is an embedded library with no network protocol. A backend reachable at
`127.0.0.1` for SQLite requires a separate SQLite-compatible server such as
libSQL `sqld` or rqlite, which neither SeaORM nor sqlx supports as a driver.
Unification is therefore at the configuration and interface layer — one
configuration shape, one code path — not at the transport layer.

## Configuration and frontend surface

- `AppSettings` gains a `database` group: backend identifier, connection string,
  enabled switch, and the existing cleanup policy fields move here.
- The frontend gains a `database` settings category. `CATEGORY_ICONS` and
  `CATEGORY_LABEL_KEY` in `src/components/settingsCategories.tsx` are typed as
  `Record<keyof AppSettings, …>`, so adding the group is a compile-time forcing
  function for every registry, test, and translation.
- When the `database` feature is absent from the backend build, the category and
  the recording panel are hidden rather than shown as failures. The exit already
  publishes a capability surface at
  `src-tauri/crates/desktop/backend-server/src/frames.rs` for exactly this
  purpose; the database capability joins it.

## Open decisions

| Decision | Effect |
| --- | --- |
| Remote engines as primary recording storage | Accepts the contract change in "Consequences for the recording contract" |
| All engines in one build versus one engine per build | Binary size and feature-matrix width against configuration-level switching |
| Fate of read-only user SQL | Engine-dialect SQL breaks on switch; options are per-engine documentation, a restricted portable subset, or reviewing the feature |
| Fate of Parquet export | Requires an Arrow/Parquet writer, or removal of the format |
| Engine for the default build | Embedded SQLite keeps offline behavior; a remote default does not |

## Verification

Documentation changes are covered by `pnpm check:docs`. Engine work is covered by
the full gate set in [`../../CONTRIBUTING.md`](../../CONTRIBUTING.md), including
`cargo test -p lissio-recording`, the storage benchmark, and the architecture
gate; a green subset is not a green build.
