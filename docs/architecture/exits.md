# Software Exits: UI, Web, MCP, and CLI

<!-- lissio-doc
status: maintained
owner: Lissio maintainers
last-reviewed: 2026-10-07
language: en
authoritative: true
applies-to: Unified UI, Web, MCP, and CLI software exits
-->

Lissio has four external software exits. They are distinct protocol adapters:
HTTP-RPC plus WebSocket, MCP tools, argv subcommands, and the desktop platform
shell. The unified object is the capability core, assembly, and dependency
inversion ports below them.

```text
Desktop React      Browser React       External AI client      Operations/CLI
 | HTTP + WS        | HTTP + WS          | MCP streamable HTTP    | argv
 | sidecar          | backend-server     | mcp-server             | backend-cli
 +---------+--------+---------+----------+-----------+------------+
           |                  |                      |
           v                  v                      v
      control-api capability core + rpc-api command dispatch
                           |
                    backend-host assembly
                           |
             pipeline / graph_ops / transport / graph / acquisition
```

The Web wire protocol and command matrix are in
[`web-exit.md`](web-exit.md).

## Capability core

`control-api` implements backend capabilities as asynchronous functions over a
`Toolbox` state slice and transport-neutral parameters:

- tools: device listing, byte/text/CAN sending, byte injection, input values,
  graph output, waveform/buffer reads, graph commit, and edge editing;
- control: endpoint lifecycle, point I/O, and workspace run control;
- data: stop snapshots, CSV export, buffer capacity, and command frames;
- recording: sessions, history, SQL, export, and pause-state gating.

The `capabilities` module is a runtime registry. Each capability domain
registers tools with schemars-derived JSON schemas and embedded skill docs.
MCP routing, built-in AI specs/dispatch, and skill discovery derive from the
same registry. Adding a domain does not require exit-specific declarations.

## Command dispatch

`rpc-api` maps command names and JSON parameters to capability calls. Desktop
and Web share names, parameters, and errors. The catalog separates `SUPPORTED`,
`PENDING`, `DESKTOP_ONLY`, and `CHANNEL`. `pnpm check:web-contract` verifies the
network dispatch table, frontend calls, and equality between the Tauri handler
registry and desktop-only commands.

## Shared assembly

`backend-host` assembles acquisition, installs point observers, restores
workspaces, resolves configuration directories, and shuts down for both
`lissio-server` and `backend-cli`.

## Inversion ports

| Port | Persistent server | Headless/test implementation |
| --- | --- | --- |
| `events::BackendEventSink` | WebSocket broadcast | CLI JSON-lines or null sink |
| `app::display::StreamSink` | Per-connection WebSocket queue | Injected local stream sink |

The desktop frontend is not a Tauri implementation of these ports. Tauri and
browsers connect to the same supervised `lissio-server`. Tauri owns windows,
menus, updater, splash, file dialogs, and sidecar lifecycle only.

L0-L3 do not depend on Tauri, rmcp, axum, or clap. Obsolete uncompiled Tauri
command files are not business exits.

## Capability matrix

| Capability | IPC/Web | MCP | CLI |
| --- | --- | --- | --- |
| Device listing and serial discovery | yes | yes | `devices`, `ports` |
| Byte/text/CAN send | yes | yes | `send` |
| Byte injection and input | yes | yes | `inject`, `input` |
| Graph commit and edges | yes | yes | `graph` |
| Waveform/CAN/logic/raw reads | yes | polling | `data` |
| Streaming subscriptions | WebSocket/stream sink | polling | command result plus stderr events |
| Waveform snapshot and raw ranges | yes | yes | `snapshot` |
| Command frame compute/send | yes | yes | `frame` |
| Endpoint lifecycle and point I/O | yes | yes | `endpoint` |
| Run control | yes | yes | `run` |
| Recording sessions and queries | yes | yes | `record` |
| File export | authenticated download | tool | CSV/export commands |
| Windows, splash, updater | desktop-only | no | no |
| AI, MCP, secret status | shared backend | inbound AiHost | backend-host capability |
| Persistent service | supervised sidecar | same server | `serve` |

## Conventions

- Parameter schemas have one source: capability DTOs and schemars definitions
  in `control-api`. MCP and built-in AI derive from them. CLI and IPC provide
  transport mapping.
- Contract names, event payloads, and persisted formats are machine-checked.
  Business messages remain in `control-api`. There is no legacy-format fallback.
- Every IPC command is classified in `rpc-api::catalog`; tool and skill IDs are
  globally unique.
- Capability calls return typed output or `ToolError`. IPC preserves error text,
  MCP exposes execution errors to clients, and CLI maps errors to stderr and a
  nonzero exit.
