# Abstraction unification batch review

<!-- lissio-review
date: 2026-10-11
scope: Dead-code and facade removal, duplicate-owner unification, and the port-domain, checksum, time, I2C-wire, formatting, and clipboard defects fixed from the abstraction survey
reviewer: implementation agent; maintainer sign-off pending
verdict: passed-with-conditions
-->

## Scope

Reviewed the first unification pass selected from the read-only abstraction
survey:

- dead paths: the uncompiled `src-tauri/src/commands/**` tree (30 files),
  `src-tauri/src/event_sink.rs`, `src-tauri/src/gui_host.rs`, the orphan
  `crates/data/runtime` crate, and `graph::traits` plus the private
  `graph::prelude`;
- facades: `pipeline::runtime` L1 forwarding, the `app` L1 re-export block,
  `device_tree::model`, the `gpu` `wgpu`/envelope re-exports, the `serial`
  `serialport` re-export, and `data_model::config::widget_config` reduced to the
  used `config::widget_binding`;
- unified owners: `kind::port_domain` (now `Option`), `schema_types::checksum`,
  `data_model::{now_us, now_ms, now_ns}`, `pipeline::runtime::AdaptiveRate`,
  `backend_host::random_hex`, `RuntimeLimits::from(&PipelineConfig)`,
  `points::scale`, `schema_types::hex`, `schema_types::FieldType`,
  `protocol::text`, `protocol::buffer`,
  `schema_types::preset::JUSTFLOAT_TAIL`, and `acquisition::config`;
- frontend: `src/types/logic.ts` forwards the generated wire types,
  `DecodedEventList` accepts serde's unit variants, `src/lib/utils/format.ts`
  owns engineering-unit formatting, and clipboard writes route through
  `writeTextToClipboard`.

## Findings

- The Tauri command tree was unreachable: `lib.rs` declared only `shell` and
  `sidecar`, so 1776 lines and the two root modules they referenced never
  compiled. Removing them changed no command surface.
- `buffer_graph::NodeGraph`/`RoutedData` were removed with their integration
  tests and `node_graph_bench` (also dropped from `scripts/bench-audit.sh`).
  They had no production caller: their routing and cycle detection belong to
  `hir::TypedGraph`/`plane::BytePlan`, so the tests and bench were maintaining a
  parallel model. `buffer_graph` now publishes `Edge` alone.
- The `I2cEvent` mismatch was user-visible: `I2cEvent::Start`/`Stop` serialize as
  strings, while the hand-written type declared `{ Start: null }`, so `'Start' in
  event` threw on the first I2C START/STOP event. The type and the renderer now
  follow the generated contract.
- `kind::port_domain` and `hir::domain_of` disagreed only on device event ports
  (F32 vs none). The owner now returns `Option`, `hir` and the `control-api`
  projection delegate to it, and event ports resolve to no plane, matching
  `graph_ops::derived`, which already excluded them.
- `schema::frame_checksum` duplicated the checksum algorithms and disagreed with
  `schema_types::checksum` on `Custom` (`byte_len` 1 vs 0, `Err` vs empty). The
  duplicated table is gone; `Custom` stays unsupported and contributes no bytes.
- Four `now_us` copies disagreed on overflow (`as u64` vs saturating).
  `data_model` now saturates and also owns `now_ms`/`now_ns`; `recording` and
  `chat-session` gained the L0 dependency.
- `AdaptiveRate` could not move to `stream`, because `stream` depends on
  `pipeline`. `pipeline::runtime::AdaptiveRate` is therefore the owner and
  `stream` re-exports it, keeping `stream::AdaptiveRate` as the public path.
- `RuntimeLimits` now derives from `PipelineConfig`, so the four limits and their
  defaults have one source; the two call sites use the conversion.
- `points::scale` owns the scaling and numeric-conversion helpers both adapter
  codecs had copied; the adapters keep thin wrappers that preserve their exact
  `CodecError` variants.
- One HEX parser now serves `protocol`, `schema`, `frame-decoder`, and
  `backend-cli`; `schema_types::hex::parse_hex` returns a `Result` and
  `parse_hex_lossy` keeps the draft-input behaviour. `schema::frame_field` keeps
  only `pack_field` over `schema_types::FieldType`.
- The four protocol engines share `protocol::text` for the ASCII float-line
  fallback and `protocol::buffer` for the parser buffer caps; the JustFloat tail
  is one byte constant in `schema_types::preset` with a test tying it to the HEX
  spelling.
- `acquisition::config` owns `ReconnectConfig`, its validation, and the backoff
  formula; both adapters deleted their copies, so the reconnect policy and the
  JSON shape have one owner.
- `stream::sink` is the single `StreamSink`/`StreamPayload` port: the JSON-only
  duplicate in `stream::dispatcher` and the `app::display::stream_sink` module
  are deleted, `backend-server` implements the surviving port, and
  `app::display::spawn_stream` delegates to `stream::adaptive_stream_loop`, so
  the producer and both push loops share one port.
- `acquisition::session` owns the polling session state machine: the
  already-connected short circuit, connect/backoff/epoch transitions, the
  `stopped` wait, and the close sequence. Both adapters implement
  `SessionState`/`ConnectionSlot` and keep only their `connect`/`disconnect`
  closures, so the reconnect policy and epoch bookkeeping run once; their
  `client.rs` files shrank by roughly 45 lines each.
- `acquisition::plan` owns the read-window merge (grouping, sorting, merging,
  offsets) behind a `WindowPoint` trait; both adapters map its windows to their
  own public `ReadPlan` types, so their duplicated planners are gone.
  `acquisition::operation` owns `OperationError` and the quality mapping, and
  `data_model::now_ns` replaced the adapters' `now_unix_ns` copies.
- `acquisition::pump` owns the read/write task skeleton for async read/write
  connections; the TCP client and server now start through it, and the network
  loopback tests cover both. UDP, candleLight, and serial keep their own loops
  because their I/O objects are not async read/write streams.
- `control-api::Toolbox` is now a handle alias for `Arc<AppState>`.
  `BackendHost::state` is the shared handle, its duplicate `toolbox` field is
  gone, `Toolbox::from_state` and its 17 field copies are deleted, and the
  `AppState::serial_discovery` sites call the method. An earlier text-driven
  attempt matched documentation mentions and was reverted to the verified
  baseline before the surgical pass; the final rewrite is compiler-verified.
- Verification: `cargo fmt --check` clean, `cargo clippy --workspace --all-targets`
  clean, `cargo test --workspace` 1511 passed / 0 failed / 2 ignored; frontend
  `tsc`, `eslint --max-warnings 0`, and 186 Vitest files (1329 tests) pass;
  `check:architecture`, `check:rust-size`, `check:docs`, and `check:ci-gates`
  pass.

## Follow-ups

- The two L4 adapters, the double decoder-block parser, the duplicate trigger and
  command-frame DTOs, the byte pump, `Toolbox`, and the parallel stream sinks
  remain open in [`server/docs/architecture/cleanup-plan-2026-09.md`](../../../server/docs/architecture/cleanup-plan-2026-09.md);
  each needs its own contract decision before implementation.
- The `AiError` unused import and the `TestRuntime` dead-code warning predate
  this change and stay outside it.
