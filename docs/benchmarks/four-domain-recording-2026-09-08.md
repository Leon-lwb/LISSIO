# Four-domain recording benchmark — 2026-09-08

## Decision

Use native DuckDB for production recording. SQLite BLOB remains a benchmark-only
control. The measured DuckDB throughput reaches the current acquisition and
processing ceiling without queue backpressure or an accepted/persisted watermark
gap, so this run is accepted for the project.

The 4 MiB random case crossed 500 MB/s in this short run; the other cases did
not. The raw pass flags are preserved rather than rewritten by the project
acceptance decision, and the result is not presented as sustained disk
throughput.

## Environment and scope

- Machine: Apple M4, 16 GiB RAM, aarch64
- Rust: 1.96.0
- DuckDB: 1.5.5
- SQLite: 3.53.2 through rusqlite 0.40.2
- Effective payload: 64 MiB per case, excluding generated source data
- Domains: bytes, repeated or varying strings, float64 samples, and float64
  frequency/value pairs
- Batch sizes: 64 KiB, 1 MiB, and 4 MiB
- Writer: concurrent-producer bounded queue with one database writer and explicit
  transaction boundaries
- Scope: short warm-cache saturation test; not a ten-minute disk endurance claim

## Results

| Backend | Batch | Pattern | Throughput | SQL visibility | Result |
|---|---:|---|---:|---:|---|
| DuckDB | 64 KiB | compressible | 190.3 MB/s | 94.1 ms | accepted |
| DuckDB | 64 KiB | random | 215.6 MB/s | 83.7 ms | accepted |
| DuckDB | 1 MiB | compressible | 431.8 MB/s | 75.7 ms | accepted |
| DuckDB | 1 MiB | random | 452.1 MB/s | 80.8 ms | accepted |
| DuckDB | 4 MiB | compressible | 424.1 MB/s | 85.3 ms | accepted |
| DuckDB | 4 MiB | random | 515.6 MB/s | 76.8 ms | accepted |
| SQLite BLOB | 64 KiB | compressible | 350.3 MB/s | 0.19 ms | control |
| SQLite BLOB | 64 KiB | random | 370.5 MB/s | 0.26 ms | control |
| SQLite BLOB | 1 MiB | compressible | 360.0 MB/s | 0.05 ms | control |
| SQLite BLOB | 1 MiB | random | 337.2 MB/s | 0.06 ms | control |
| SQLite BLOB | 4 MiB | compressible | 373.1 MB/s | 0.03 ms | control |
| SQLite BLOB | 4 MiB | random | 349.5 MB/s | 0.03 ms | control |

DuckDB cases include typed encoding, checksum calculation, the bounded writer
queue, explicit commits, persistence-watermark accounting, and a relational
aggregate. The SQLite control stores a flattened BLOB in one transaction, so its
number is a storage-layout control rather than an equivalent production path.

All DuckDB cases reported zero queue backpressure, matching accepted and
persisted byte counts, and matching accepted and persisted sequence watermarks.
The aggregate query returned the expected four domains.

## Reproduction

```sh
cd src-tauri
VOFA_STORAGE_BENCH_BYTES=67108864 cargo bench -p recording --bench storage
```

Machine-readable output is in
`docs/benchmarks/four-domain-recording-2026-09-08.jsonl`.

The 4 GiB cap remains enforced by the benchmark. A 500 MB/s ten-minute session
would require about 300 GB of effective payload plus database maintenance space
and was not run.
