# Lissio crate architecture

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

设备拓扑、驱动契约、能力投影和子树生命周期的统一模型见
[device-tree.md](device-tree.md)。

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
| desktop | `events`, `pipeline`, `stream`, `evaluator`, `app`, `graph-ops`, `control-api`, `ai-host`, `rpc-api`, `backend-host`, `menu-shell`, `update-flow`, `mcp-server`, `backend-server`, `backend-cli`, and the shell-only root package `lissio` |

`graph` owns the compiler as separate responsibility crates:
`kind` defines node semantics, `hir` builds and classifies the typed graph,
`plane` projects value/byte planes, `lower` allocates slots and emits compiled
operations, and `eval` executes them. The `graph` crate is the compile facade
and semantic evaluation reference; consumers use that facade rather than
chaining compiler phases through adjacent-layer helpers. `graph-testkit` is a
dev-dependency only.

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
