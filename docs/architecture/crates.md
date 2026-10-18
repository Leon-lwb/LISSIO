# Lissio Crate Architecture

<!-- lissio-doc
status: maintained
owner: Lissio maintainers
last-reviewed: 2026-10-17
applies-to: Rust workspace ownership, domains, layers, and dependency direction
-->

## Physical layout

Every member crate lives at `src-tauri/crates/<domain>/<crate>`. Domain folders
are navigation aids, not crates and not dependency layers. This keeps related
capabilities visually adjacent without encoding two concepts in one directory.

## Layers

| Layer | Meaning | Examples |
|---|---|---|
| L0 | Stable contracts and configuration | `error`, `flow`, `data-model`, `points`, `can`, `diagnostic` |
| L1 | Deterministic engines and in-memory structures | `waveform`, `schema`, `graph`, `bus` |
| L2 | Stateful runtimes, storage, and orchestration ports | `transport`, `pipeline`, `stream`, `evaluator`, `recording`, `acquisition` |
| L3 | Product use cases and application state | `app`, `graph_ops`, `control-api` |
| L4 | Hardware, OS, SDK, protocol-dispatch, and external-service adapters | `serial`, `gpu`, `llm`, `mcp-server`, `rpc-api`, `backend-host` |
| L5 | Platform/composition roots and root-only flows | `lissio` (Tauri), `backend-server`, `backend-cli`, `menu-shell`, `update-flow` |

A crate may depend on the same layer or any lower layer. Direct dependencies
across multiple layers are preferred to forwarding facades. L0-L3 must not
depend on Tauri or adapter SDKs; adapter-backed capabilities (serial
discovery, GPU envelope, event/stream push) are defined as ports in lower
layers and their L4 implementations are injected by the composition root.

## Domain stacking and layer ownership

`domain` and `layer` record two different facts and are orthogonal: `domain`
groups crates by the capability they serve, `layer` ranks who may depend on
whom. A domain may therefore span several layers, while a crate always belongs
to exactly one. The layer in `[package.metadata.lissio]` is authoritative;
directory order and comments are navigation only. `pnpm architecture` prints
the matrix below from that metadata, and `pnpm check:architecture` enforces it:
it parses this table and fails when a member's declared domain or layer
disagrees with the row that names it, so a crate cannot change layers by
editing metadata alone.

| Domain | Layers present |
|---|---|
| shared | L0: `error`, `flow`, `data-model`, `subscription` |
| vehicle | L0: `can`, `diagnostic` |
| protocol | L0: `points`; L1: `logic`, `schema-types`, `protocol`, `protocol-float`, `protocol-can-bridge`, `logic-decoder`, `schema`, `frame-decoder`; L2: `acquisition` |
| signal | L1: `raw-data`, `waveform`, `filter`, `spectrum`, `measurement`; L4: `gpu` |
| graph | L1: `kind`, `hir`, `plane`, `lower`, `eval`, `buffer-graph`, `trigger`, `graph-testkit`, `graph` |
| transport | L2: `device-tree`, `transport`, `automotive-diag`; L4: `serial`, `network`, `can-transport`, `modbus-adapter`, `s7-adapter`, `automotive`, `automotive-isotp` |
| data | L1: `bus`; L2: `recording` |
| ai | L4: `llm`, `chat-session`, `chat`, `mcp-client` |
| desktop | L1: `events`; L2: `pipeline`, `stream`, `evaluator`; L3: `app`, `graph-ops`, `control-api`; L4: `ai-host`, `rpc-api`, `performance`, `backend-host`, `mcp-server`; L5: `backend-server`, `backend-cli`, `menu-shell`, `update-flow` |

A domain that spans layers is expected, not a defect: capability families such
as `transport` and `signal` pair a deterministic core with the L4 adapters
that implement its ports. Do not split a domain into layer subdirectories — a
crate path is exactly `crates/<domain>/<crate>` — and do not split a
multi-layer domain into one domain per layer; that encodes the same fact twice
and moves paths without changing a single dependency edge.

The rule above ("L0-L3 must not depend on an adapter SDK or OS facility") is
enforced as a reviewed inventory, not a name denylist: `pnpm check:architecture`
allows a lower-layer crate to depend only on the external (crates.io) packages
recorded in `scripts/lower-layer-external-dependencies.json`. That file is
generated from the workspace and committed, so the list cannot be silently
incomplete — the one live case, `control-api` (L3) reaching `windows-sys` for
file-time conversion, is recorded there for review. A new external dependency
in L0-L3 fails until the baseline is regenerated deliberately with
`node scripts/check-crate-architecture.mjs --update-baseline`.

Decide a crate's layer from what it does, not from where it sits:

- defines only stable types or contracts: L0
- is a pure deterministic transform over values or bytes: L1
- owns state, a background loop, storage, or a lifecycle port: L2
- orchestrates product use cases over the layers below: L3
- touches an external SDK, OS facility, hardware bus, or remote service: L4
- composes and injects the ports of a whole product: L5

Each crate states its single reason to change in `responsibility`. The
placeholder `Focused crate responsibility` is rejected, because a crate whose
abstraction is unstated cannot be placed or reviewed.

## Test layout

Tests are not written inline in production modules, and a module never grows a
directory just to hold its tests. `pnpm check:architecture` fails on any
`#[cfg(test)] mod x { ... }` that survives in a production file and on any
directory under a crate `src/` that contains only test files.

- Unit tests that need private access stay beside their module and add no
  directory:
  - a module with no child directory (`src/<module>.rs`) keeps its tests in the
    flat sibling `src/<module>_tests.rs`, declared as
    `#[cfg(test)] #[path = "<module>_tests.rs"] mod tests;`. The `#[path]`
    attribute preserves the `use super::*` chain, so private items stay
    reachable without widening their visibility;
  - a module that already owns a directory (`src/<module>/mod.rs`, or
    `src/<module>.rs` whose submodules live under `src/<module>/`) keeps its
    tests in `src/<module>/tests.rs`, declared as the plain
    `#[cfg(test)] mod tests;`.
- Additional descriptively named suites follow the same rule with the suite
  name: `src/<module>_<name>.rs`, or `src/<module>/<name>.rs` when that
  directory already exists. A crate root may keep one module file,
  `src/tests.rs`, and group its child suites under `src/tests/`.
- `tests/` and `benches/` directories are the only test-only directories that
  stand without further justification: integration tests that only need the
  public API live in the crate-level `tests/` directory, with shared helpers
  under `tests/support/`.
- Test files are exempt from the 500-line production limit
  (`scripts/check-crate-size.mjs`), so a `_tests.rs` file may hold the whole
  unit-test surface of its module.

## Software exits

Desktop and Web both use HTTP-RPC + WebSocket through `backend-server`; Tauri IPC is a
platform-shell-only exit. MCP (`mcp-server`) and headless CLI (`backend-cli`) are thin adapters over one
capability core (`control-api`), one command dispatch table (`rpc-api`), one
shared assembly (`backend-host`), and two push ports
(`events::BackendEventSink`, `app::display::StreamSink`). `control-api` also owns the
software capability node registry (`capabilities`): every capability domain registers
a node declaring its tools (schema from `schemars`) and skill docs, and the MCP tool
router, the built-in AI tool specs/dispatch, and the skill index all derive from the
same registry at runtime. Capability coverage
matrix and conventions: [exits.md](exits.md); Web protocol contract and the
per-command capability matrix: [web-exit.md](web-exit.md).

The unified device topology, driver contract, capability projection, and subtree
lifecycle model is documented in [device-tree.md](device-tree.md).

## Domains

The production dependency DAG is:

```mermaid
flowchart TD
  vehicle --> shared
  signal --> shared
  protocol --> shared
  protocol --> vehicle
  graph --> protocol
  graph --> signal
  graph --> shared
  transport --> protocol
  transport --> vehicle
  transport --> shared
  ai --> shared
  data --> shared
  desktop --> ai
  desktop --> data
  desktop --> graph
  desktop --> protocol
  desktop --> shared
  desktop --> signal
  desktop --> transport
  desktop --> vehicle
```

Production dependencies follow the directions checked by
`pnpm check:architecture`; test-only fixtures do not create shipped edges.
Domain folders are navigation aids. Same-domain dependencies are allowed when
they also satisfy the layer rule.

## Workspace target crates

| Domain | Crates |
|---|---|
| shared | `data-model`, `error`, `flow`, `subscription` |
| signal | `waveform`, `raw-data`, `filter`, `spectrum`, `measurement`, `gpu` |
| vehicle | `can`, `diagnostic` |
| protocol | `points`, `logic`, `logic-decoder`, `protocol`, `protocol-float`, `protocol-can-bridge`, `schema-types`, `schema`, `frame-decoder`, `acquisition` |
| graph | `kind`, `hir`, `plane`, `lower`, `eval`, `buffer-graph`, `trigger`, `graph-testkit`, `graph` |
| transport | `device-tree`, `transport`, `serial`, `network`, `can-transport`, `automotive`, `automotive-isotp`, `automotive-diag`, `modbus-adapter`, `s7-adapter` |
| data | `bus`, `recording` |
| ai | `llm`, `chat-session`, `chat`, `mcp-client` |
| desktop | `events`, `pipeline`, `stream`, `evaluator`, `app`, `graph-ops`, `control-api`, `ai-host`, `rpc-api`, `performance`, `backend-host`, `menu-shell`, `update-flow`, `mcp-server`, `backend-server`, `backend-cli`, and the shell-only root package `lissio` |

`graph` owns the compiler as separate responsibility crates:
`kind` defines node semantics, `hir` builds and classifies the typed graph,
`plane` projects value/byte planes, `lower` allocates slots and emits compiled
operations, and `eval` executes them. The `graph` crate is the compile facade
and semantic evaluation reference; consumers use that facade rather than
chaining compiler phases through adjacent-layer helpers. `graph-testkit` is a
dev-dependency only.

## Recording contract boundary

`recording` owns the recording store behind one writer thread; `pipeline` only ever
sees `RecordingHub`. The storage engine sits behind the store port in `port.rs`,
whose current implementation is DuckDB under `backend/`, so no module above the
port names an engine. The boundary that matters for the whole product:

- **Database-side failures must never interrupt acquisition.** A database that cannot be opened, a
  writer that stopped answering, a queue that filled up, or the user turning the
  switch off are all *"no recording"* — never *"recording failed"*. `pipeline`
  keeps acquiring in every one of those cases.
- Only **accepted batches that cannot be persisted** (database / IO / corrupt /
  writer-failed / writer-closed) may stop the run, and only those set
  `RecordingHub::fault`. A successful write clears the hub flag again, so a
  transient fault cannot stick for the rest of the session. A writer that dies
  before accepting any batch is *unavailable*, not failed: the reason is recorded
  on the non-fault channel and stays visible in `RecordingHealth.failed`, while
  the hub detaches the dead recorder instead of faulting. The recorder-level flag
  is written once, when a writer that had already accepted batches dies; a dead
  writer cannot perform the successful write that would clear it.
- `AppSettings.data.recordingEnabled` (default off) disables the database
  entirely and is hot-swappable at any run state; `backend-host` replays it for
  desktop, server, and CLI from the same `settings.json`.
- **One connection, owned by the writer thread.** Queries, exports, session
  checks, history paging, database info, and read-only SQL all travel over
  `writer::RecordingReader` to the writer's single store session; nothing
  opens a second instance on the same file. Only construction-time and
  "database already closed" maintenance paths open their own connection. Multiple
  instances checkpoint over each other and silently erase committed writes, which
  is what corrupted history before.
- **The engine sits behind a store port.** `StoreEngine` opens sessions and owns
  recovery; `StoreSession` is the writer thread's single handle; engine-specific
  repair (damage classification, rebuild, file quarantine) belongs to that
  implementation. Adding or swapping a backend touches the port implementation and
  the selection point in `backend/` only.
- **Every writer round trip is bounded**, on both the send and the reply side
  (run control 5 s, shutdown 10 s, maintenance/reads 120 s). A writer that stops
  answering is detached and reported as *unavailable* instead of blocking
  acquisition or run control, and the execution-boundary write lock taken while
  swapping a recorder is released after 30 s.
- **Opening is bounded and pre-flighted**: an existing database file is probed
  with `try_lock` (with backoff), the open itself runs on its own thread with a
  30 s ceiling, and the instance guard lives as long as that thread. A database
  that cannot be opened within the budget is *unavailable*, never a hang.
- **Opening validates**: after entering the schema, the three tables are really
  read; a damaged catalog goes through `repair::rebuild_database` and the rebuild
  is reported through `RecordingHealth.warning` — a visible, explicitly
  **non-fault** channel, because `failed` would stop acquisition.

Violating the first rule is what produced "Start shows a few characters and Pause
never releases": backpressure used to be classified as a writer fault, and the
fault flag was sticky.

## Performance monitor boundary

Performance monitoring is bounded by “the runtime that performs the work owns its measurement”:

- The frontend measures WebView/browser frame timing, long tasks, and optional JavaScript heap. Those values are never fabricated as backend state.
- `performance` (L4) samples `lissio-server` CPU, RSS, uptime, and runtime counts. `backend-server` records RPC latency, WebSocket output, and bounded queue drops. `pipeline::EvalDiagnostics` and `bus::RuntimeHealth` project into the same backend snapshot.
- `rpc-api::get_performance_snapshot` is the only backend snapshot exit. The frontend fetches, merges, and renders the two sequences. Monitoring UI does not read internal locks, parse logs, or bypass the Web contract through Tauri IPC.
- Monitoring requests are included in RPC statistics. Frontend history is short-lived display data; the backend snapshot remains authoritative for current state.

## Command-name contract

`rpc-api::catalog` is the authority for the public command surface. Its four lists
(`SUPPORTED`, `PENDING`, `DESKTOP_ONLY`, `CHANNEL`) stay disjoint. `SUPPORTED` and
`CHANNEL` belong to the independent backend; the Tauri `generate_handler!` registry must equal
`DESKTOP_ONLY`. `pnpm check:web-contract` enforces both sides and every frontend invocation.

## Machine-readable contract

Each crate declares:

```toml
[package.metadata.lissio]
domain = "data"
layer = 2
responsibility = "Ingest, byte routing, protocol state, and run control"
```

Before changing Rust ownership or dependencies, run:

```sh
pnpm architecture
pnpm check:architecture
pnpm check:deps
```

`pnpm architecture -- --format=json` and `--format=dot` are stable formats for
AI planning tools. The report includes direct and reverse workspace dependencies.

## New-crate decision

Create a crate only for an independently changing capability, an inversion
port, a heavy optional adapter, or cross-crate test support. Otherwise add a
private module to the capability owner. Names describe the responsibility;
prefixes (`lissio-*`, `vofa-*`, layer names) and ambiguous standalone names
(`core`, `runtime`, `types`, `common`) are forbidden for crates, lib targets,
and directories. Separately, the crates.io package name is a registry
namespace: it must be `lissio-` + the directory name (underscores as hyphens,
e.g. `buffer_graph` publishes as `lissio-buffer-graph`), remapped via
`package =` in `[workspace.dependencies]`; dependency keys, `use` paths, and
lib/bin target names keep the short responsibility name.

## Serial discovery and device presentation

`serial` (L4) owns the shared enumeration pipeline in private `ports`,
`macos_ports`, `windows_ports`, and `linux_ports` modules. The stable
`serial::serial::list_ports` API returns `data-model::PortInfo` after platform
information enrichment, text normalization, and interface deduplication:

- macOS uses IORegistry's callout/dial-in properties on the **same service** to
  choose the callout path, and reads DriverKit/USB names and identity.
- Windows uses serialport's hardware identity and SetupAPI's localized friendly
  name, falling back to the device description. COM spelling is canonicalized.
- Linux uses serialport/libudev plus sysfs interface/product/manufacturer data;
  filesystem aliases resolve to the actual device path. Missing sysfs data is
  nonfatal and preserves the base enumeration.

Serial, SLCAN, and Modbus RTU consume this same inventory and `port_metadata`.
The optional discovery metadata `deviceId` is an OS-local **interface identity**
(`serial:<canonical port>`), shared across adapters; it is not a permanent USB
hardware ID. Do not deduplicate by VID/PID, product, or serial number: different
devices or independent interfaces can share them. Previously saved paths remain
valid connection inputs; discovery does not rewrite persisted configurations.

The device panel groups only explicit matching `deviceId` values, offers the
available adapter choices on one device card, and preserves each choice's
configuration patch. Discoveries without identity remain adapter-scoped. React
never infers OS aliases or hardware identity from device names. Manually
configured/network connections remain accessible separately from discovered
hardware. `PortInfo`, IPC signatures, and persisted configuration shapes follow
the current contract; there is no legacy-format fallback.
