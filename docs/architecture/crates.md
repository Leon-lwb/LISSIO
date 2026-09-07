# Lissio crate architecture

## Physical layout

Every member crate lives at `src-tauri/crates/<domain>/<crate>`. Domain folders
are navigation aids, not crates and not dependency layers. This keeps related
capabilities visually adjacent without encoding two concepts in one directory.

## Layers

| Layer | Meaning | Examples |
|---|---|---|
| L0 | Stable contracts and configuration | `data-model`, `config`, `events`, `can`, `diagnostic` |
| L1 | Deterministic engines and in-memory structures | `waveform`, `schema`, `graph`, `bus` |
| L2 | Stateful runtimes, storage, and orchestration ports | `transport`, `pipeline`, `workspace`, `chat` |
| L3 | Product use cases and application state | `app` |
| L4 | Hardware, OS, SDK, and external-service adapters | `serial`, `gpu`, `llm`, `mcp-server` |
| L5 | Tauri composition root | `lissio` |

A crate may depend on the same layer or any lower layer. Direct dependencies
across multiple layers are preferred to forwarding facades. L0-L3 must not
depend on Tauri or adapter SDKs.

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
| shared | `data-model`, `config` |
| signal | `waveform`, `raw-data`, `filter`, `spectrum`, `measurement`, `gpu` |
| vehicle | `can`, `diagnostic` |
| protocol | `logic`, `protocol`, `schema`, `frame-decoder` |
| graph | `trigger`, `graph`, `graph-testkit` |
| transport | `transport`, `serial`, `network`, `can-transport`, `test-data`, `automotive` |
| data | `bus` |
| workspace | `workspace` |
| ai | `chat`, `llm`, `chat-session`, `mcp-client` |
| desktop | `events`, `pipeline`, `stream`, `evaluator`, `app`, `graph_ops`, `menu_shell`, `update_flow`, `mcp-server`, and root package `lissio`; commands are modules under `src-tauri/src/commands` |

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
