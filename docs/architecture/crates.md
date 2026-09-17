# Lissio crate architecture

## Physical layout

Every member crate lives at `src-tauri/crates/<domain>/<crate>`. Domain folders
are navigation aids, not crates and not dependency layers. This keeps related
capabilities visually adjacent without encoding two concepts in one directory.

## Layers

| Layer | Meaning | Examples |
|---|---|---|
| L0 | Stable contracts and configuration | `data-model`, `points`, `events`, `can`, `diagnostic` |
| L1 | Deterministic engines and in-memory structures | `waveform`, `schema`, `graph`, `bus` |
| L2 | Stateful runtimes, storage, and orchestration ports | `transport`, `pipeline`, `stream`, `evaluator`, `recording`, `acquisition` |
| L3 | Product use cases and application state | `app`, `graph_ops`, `control-api` |
| L4 | Hardware, OS, SDK, and external-service adapters | `serial`, `gpu`, `llm`, `mcp-server`, `backend-host` |
| L5 | Composition roots | `lissio` (Tauri), `backend-cli` (headless) |

A crate may depend on the same layer or any lower layer. Direct dependencies
across multiple layers are preferred to forwarding facades. L0-L3 must not
depend on Tauri or adapter SDKs; adapter-backed capabilities (serial
discovery, GPU envelope, event/stream push) are defined as ports in lower
layers and their L4 implementations are injected by the composition root.

## Software exits

UI (Tauri IPC), MCP (`mcp-server`), and headless CLI (`backend-cli`) are three
thin protocol adapters over one capability core (`control-api`), one shared
headless assembly (`backend-host`), and two push ports (`events::BackendEventSink`,
`app::display::StreamSink`). Capability coverage matrix and conventions:
[exits.md](exits.md).

## Domains

```mermaid
flowchart TD
  desktop --> integration & application & ai & data & transport & graph & protocol & signal & vehicle & workspace & shared
  integration --> application & ai
  application --> data & transport & graph & protocol & signal & vehicle & workspace & shared
  data --> transport & graph & protocol & signal & vehicle & shared
  workspace --> graph & shared
  transport --> protocol & vehicle & shared
  graph --> protocol & signal & shared
  protocol --> vehicle & shared
  signal --> shared
  vehicle --> shared
  ai --> shared
```

Domain dependencies only follow these arrows. Same-domain dependencies are
allowed when they also satisfy the layer rule.

## Stable target crates

| Domain | Crates |
|---|---|
| shared | `data-model`, `config`, `flow` |
| signal | `waveform`, `raw-data`, `filter`, `spectrum`, `measurement`, `gpu` |
| vehicle | `can`, `diagnostic` |
| protocol | `logic`, `protocol`, `schema`, `frame-decoder`, `points`, `acquisition` |
| graph | `trigger`, `graph`, `graph-testkit` |
| transport | `transport`, `serial`, `network`, `can-transport`, `test-data`, `automotive`, `modbus-adapter`, `s7-adapter` |
| data | `bus`, `recording` |
| workspace | `workspace` |
| ai | `chat`, `llm`, `chat-session`, `mcp-client` |
| desktop | `events`, `pipeline`, `stream`, `evaluator`, `app`, `graph_ops`, `control-api`, `backend-host`, `menu_shell`, `update_flow`, `mcp-server`, `backend-cli`, and root package `lissio`; commands are modules under `src-tauri/src/commands` |

`graph` keeps `compiler::{hir, plane, lower}` and `eval` as private
implementation stages. Do not split compiler phases into crates.

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
(`core`, `runtime`, `types`, `common`) are forbidden.

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
hardware. `PortInfo`, IPC signatures, and persisted configuration shapes remain
unchanged; the discovery metadata addition is backward compatible.
