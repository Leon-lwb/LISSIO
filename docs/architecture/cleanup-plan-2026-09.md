# Architecture Cleanup Register (2026-09)

<!-- lissio-doc
status: maintained
owner: Lissio maintainers
last-reviewed: 2026-10-11
applies-to: Open structural debt inherited from the September 2026 architecture review
-->

This register follows [`architecture-review-2026-09.md`](architecture-review-2026-09.md).
It records structural debt and acceptance criteria without duplicating established
architecture.

## Documentation alignment completed

- `crates.md` is the single authority for domains, layers, and workspace crates.
- `data-plane.md` uses real crate paths and the `waveform_pyramid_bench`,
  `ingest_bench`, `eval_bench`, and `pipeline_soak` benchmarks.
- `exits.md` reflects the supervised sidecar; Tauri is not a business adapter.
- Shared model documentation describes current owners, contracts, and boundaries.

## Remaining structural debt

| Debt | Impact | Acceptance criterion |
| --- | --- | --- |
| Keep crate responsibility metadata substantive | Architecture output cannot explain why a crate exists | Each affected crate declares a real, specific responsibility |
| Reject placeholder architecture metadata | Placeholders can pass CI | The gate rejects empty or generic responsibility strings |
| Evaluate `pipeline` only when evidence justifies a split | It owns routing, evaluation scheduling, recording bindings, and diagnostics | Split only for measurable change-frequency, isolation, or benchmark benefit; never create a facade merely to reduce dependencies |
| Align `automotive*` layer semantics or document why they differ | Similar adapter names currently span different layers | Layer meanings are consistent or explicitly justified |
| Keep frontend modules within responsibility and size limits | Transport, stores, AI, and charts can mix again | Split oversized files without changing public behavior |
| Preserve benchmark evidence when trends are needed | Source benchmarks alone do not record hardware or historical raw output | Record machine, revision, raw data, statistics, and reproduction commands when comparing trends |

## Unification batches (2026-10-11)

The first unification pass closed the dead-code, duplicate-owner, and
port-domain defects that the abstraction survey ranked highest.

### Dead code and facades removed

- The uncompiled `src-tauri/src/commands/**` tree, `event_sink.rs`, and
  `gui_host.rs` are deleted; the desktop shell declares only `shell` and
  `sidecar`, and every command resolves through `rpc-api` dispatch.
- The orphan `crates/data/runtime` facade crate is deleted, and
  `pipeline::runtime` no longer forwards L1 types: consumers import from
  `kind`, `graph`, `schema`, `protocol`, `trigger`, `acquisition`, and
  `frame_decoder` directly.
- `graph::traits` and the private `graph::prelude` are deleted, and so are
  `buffer_graph::NodeGraph`/`RoutedData` with their tests and bench: no
  production path used them, their routing and cycle detection are owned by
  `hir::TypedGraph`/`plane::BytePlan`, and a bench that measures unused code has
  no signal. `buffer_graph` now owns only `Edge`.
- `data_model::config::widget_config` is reduced to the used `WidgetBinding`
  (`config::widget_binding`); its duplicated widget DTOs are deleted.
- `device_tree` no longer re-exports `data_model` node contracts, and `gpu` and
  `serial` no longer re-export `wgpu`/`serialport`.

### Unified owners

- `kind::port_domain` is the single port-domain resolver; it returns `None` for
  device event ports, and `hir` and the `control-api` HIR projection delegate to
  it.
- `schema_types::checksum` owns the checksum algorithms; `schema::frame_checksum`
  keeps only the fallible wrapper, and `Custom` stays unsupported on the backend.
- `data_model::{now_us, now_ms, now_ns}` are the only time helpers.
- `pipeline::runtime::AdaptiveRate` is the only adaptive-rate implementation;
  `stream` re-exports it.
- `backend_host::random_hex` is the only token generator.
- `RuntimeLimits` derives from `PipelineConfig` instead of copying four fields.
- `control-api::Toolbox` is a handle alias for `Arc<AppState>`; the 17-field
  mirror, its `from_state` copies, and `BackendHost::toolbox` are gone, so every
  exit shares one `AppState` handle and `AppState` has a single field list.
  `AppState::serial_discovery` is a method call at the affected sites.
- `points::scale` owns `PointValue` scaling and numeric conversion; both adapter
  codecs keep only error-mapping wrappers.
- `schema_types::hex::parse_hex` is the only HEX parser (`parse_hex_lossy` for
  draft input); `protocol`, `schema`, `frame-decoder`, and `backend-cli`
  delegate to it.
- `schema_types::FieldType` is the only field-type enum; `schema::frame_field`
  keeps `pack_field` and delegates the parse.
- `protocol::text` owns the ASCII float-line fallback, and `protocol::buffer`
  owns the parser buffer caps; `schema_types::preset::JUSTFLOAT_TAIL` is the
  frame tail in bytes.
- `acquisition::config` owns `ReconnectConfig`, its validation, and the
  backoff formula used by both adapters.
- `stream::sink` owns the single `StreamSink`/`StreamPayload` port. The
  duplicate JSON-only trait in `stream::dispatcher` and the
  `app::display::stream_sink` module are gone; `backend-server` implements the
  surviving port, and `app::display::spawn_stream` now runs on
  `stream::adaptive_stream_loop` instead of its own loop, so the production
  display path has one push loop.
- `acquisition::session` owns the polling session state machine: the
  already-connected short circuit, connect/backoff/epoch transitions, the
  `stopped` wait, and the close sequence. Both adapters implement
  `SessionState`/`ConnectionSlot` and keep only their `connect`/`disconnect`
  closures, so reconnect policy runs once.
- `acquisition::plan` owns the read-window merge algorithm; the adapters map its
  windows to their own public `ReadPlan` types, so the grouping, sorting, merge,
  and offset logic exists once. `acquisition::operation` owns `OperationError`
  and the quality mapping, and `now_ns` replaced both adapters' local copies.
- `acquisition::pump` owns the read/write task skeleton for
  `AsyncRead`/`AsyncWrite` connections; the TCP client and server use it. UDP,
  candleLight, and serial keep their own loops because their I/O objects are not
  async read/write streams, but they share the write/数据/取消 triple contract.

### Frontend

- `src/types/logic.ts` forwards the generated wire types; the hand-written
  `I2cEvent` object variants contradicted serde's unit variants and crashed
  I2C START/STOP rendering.
- `src/lib/utils/format.ts` owns frequency, period, and byte formatting.
- Clipboard writes go through `writeTextToClipboard`.

### Still open

- `modbus-adapter` and `s7-adapter` still carry separate read/write request
  paths and subscription loops, which differ per protocol (Modbus registers and
  bit reads versus S7 byte windows and PDU budgeting); the session state
  machine, planner, scaling, field types, reconnect config, operation error, and
  time helpers are already unified.
- `SchemaEngine` and `FrameParser` still decode the same block definitions
  twice, and `TriggerRuleDef`/`TriggerRule` plus the command-frame DTOs are
  still declared twice.
- The UDP, candleLight, and serial connection loops still duplicate the pump
  skeleton because their I/O objects are not async read/write streams, and the
  synthetic-source generators remain copied across crates.

## Verification

Run the complete gate set in `CONTRIBUTING.md`. A green subset is not a green
build.
