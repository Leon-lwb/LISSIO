# Data Plane Architecture

<!-- lissio-doc
status: maintained
owner: Lissio maintainers
last-reviewed: 2026-10-14
applies-to: Byte, record, evaluation, storage, and display contracts
-->

This is the design authority for the byte, record, and evaluation planes. The
primary owners are `pipeline`, `waveform`, `acquisition`, `transport`, and
`plane`. Node configuration lives in tab documents; the runtime graph stores
derived indexes.

## Problem addressed

The previous pipeline failed at rates of 100,000 frames/s or more: fixed
100,000-point buffers lost old data despite a two-second window, competing
timestamp mechanisms folded traces, and per-frame graph evaluation shared locks
and queues with waveform recording. Protocol nodes also reparsed identical
bytes.

## Target flow

```text
Device session declares a clock source
  -> read task batches to the smaller byte target or 50 ms sample duration
  -> BytePlan deduplicates equivalent byte source/protocol routes
  -> sampling clock stamps frames from anchor plus logical progression
     + record plane stores raw frames under bounded chunk locks
     + evaluation plane uses bounded frame/byte/batch queues
  -> DataBuffer owns raw L0 plus min/max pyramid tiers
  -> derived channels own separate timelines and locks
  -> snapshot chooses raw data or the smallest sufficient pyramid tier
  -> WWB1 v2 full-window snapshot includes overflow and tier metadata
  -> frontend replaces the complete window and marks degraded storage
```

## Structural invariants

1. **One clock domain per source.** Arrival time selects the first anchor only.
   Subsequent timestamps use the declared rate and logical byte/sample
   progression. Missing hints extrapolate the locked rate. Simulated broadcast
   lag is converted to an explicit frame gap. Display code does not spread or
   rewrite timestamps.

2. **Capacity matches rate and window.** L0 targets `rate * 2.5 seconds`, with
   hysteresis and a memory-budget/16M-point cap. Overflow is absorbed by
   pyramid tiers. L0 rolling replacement increments `storage_overflow`.

3. **Recording and evaluation are decoupled.** Raw waveform recording completes
   during byte routing. Evaluation backlog affects only derived channels and
   source-frame consumers. Derived channels use separate timelines and locks.
   Evaluation gaps become NaN breaks rather than shifted joins.

4. **Parse once, fan out many.** Equivalent protocol routes share parsing,
   clocking, detection, bypass, and recording. Frames fan out as
   `Arc<Vec<DataFrame>>`; aliases read the representative buffer.

5. **Drops are explicit.** Evaluation drops mark queue gaps and reset filters,
   triggers, and IFFT state. Raw overflow is counted and surfaced in WWB1 and
   the UI. Queue lag is reported before parsing. No loss is silently joined.

6. **Recording reads share the writer's one connection.** A running recorder owns
   the database file and serves queries, exports, and session checks on its single
   connection, reached through the store the recorder owns (`Recorder::store`,
   exposed to product code as `RecordingHub::store`). A store opened directly has
   no reader and falls back to a private connection, which is correct only while no
   writer holds the file: under Windows mandatory file locking that fallback fails
   with "another program is using this file". A read issued during recording must
   therefore go through the recorder's store.

## Storage and cost model

L0 stores raw points. Each pyramid tier covers a larger time span with min/max
buckets. Snapshots use raw data when the requested window fits the point
budget; otherwise they use the smallest sufficient real envelope tier.

The evaluation queue is bounded by frames, estimated allocation, and batches.
Oversized batches are rejected and older backlog is cleared into an explicit
gap. Consumers merge only small exclusive batches from the same source.

## Diagnostics

The two-second data-plane monitor reports receive rate, ingest batches and
service time, produced frames, evaluation batches and consumed frames, lagged
drops, evaluation queue drops, and storage degradation. Queue wait, blocking
scheduling, and maximum service time distinguish capacity problems from
scheduling stalls.

## Benchmark evidence

```bash
cd src-tauri
cargo bench -p lissio-waveform --bench waveform_pyramid_bench
cargo bench -p lissio-pipeline --bench ingest_bench
cargo bench -p lissio-pipeline --bench eval_bench
cargo bench -p lissio-pipeline --bench pipeline_soak
```

The first measures long pyramid writes and budgeted snapshots, the second the
complete parse/record/enqueue path, the third graph scheduling, and the fourth
long-running queue, query, and subscription behavior. Normal soak scenarios
require zero drops; intentionally overloaded scenarios require bounded queues
and per-frame accounting.
