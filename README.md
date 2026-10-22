# Lissio

<!-- lissio-doc
status: maintained
owner: Lissio maintainers
last-reviewed: 2026-10-22
applies-to: Product overview, setup, development, and distribution
-->

**English** · [简体中文](README.zh-CN.md)

Repository prose is written in English and the English file stays authoritative.
The product README additionally ships the [`README.zh-CN.md`](README.zh-CN.md)
Simplified Chinese translation. Historical review records and product
localization resources keep their original language.

Lissio is a data-acquisition and debugging host for embedded, automotive, and industrial work. It is one capability core delivered through four software exits — a Tauri desktop app, a Web frontend, an MCP server, and a headless CLI — so the same acquisition, decoding, graph, and recording behaviour is reachable from a native window, a browser, an AI client, or a script.


<!-- PROJECT LOGO -->
<br />

<p align="center">
  <a href="https://codeberg.org/lissio-industries/Lissio">
    <img src="client/src-tauri/icons/icon.png" alt="Logo" width="80" height="80">
  </a>

  <h3 align="center">Lissio</h3>
  <p align="center">
    A data-acquisition and debugging host for embedded, automotive, and industrial work.
    <br />
    <a href="https://lissio.pengheng.top"><strong>Project website »</strong></a>
    <br />
    <a href="https://codeberg.org/lissio-industries/Lissio"><strong>Explore the repo »</strong></a>
    <br />
    <br />
    <a href="https://codeberg.org/lissio-industries/Lissio/issues">Report Bug</a>
    ·
    <a href="https://codeberg.org/lissio-industries/Lissio/issues">Request Feature</a>
  </p>
</p>

![Lissio application example](./images/example.png)

## Table of Contents

- [Introduction](#introduction)
- [Core Features](#core-features)
- [Usage Guide](#usage-guide)
- [Tech Stack](#tech-stack)
- [Project Structure](#project-structure)
- [Prerequisites](#prerequisites)
- [Installation & Running](#installation--running)
- [Build & Packaging](#build--packaging)
- [Testing](#testing)
- [Contributing](#contributing)
- [Versioning](#versioning)
- [License](#license)
- [Acknowledgements](#acknowledgements)

## Introduction

The interface is React 19 + TypeScript + Vite. The work behind it runs in `lissio-server`, an independent Rust process that owns transport I/O, protocol decoding, the node-graph dataflow runtime, DSP (FIR/IIR filters, FFT spectrum), CAN and automotive diagnostics, and recording. The desktop shell is Tauri 2 and a browser loads the same built frontend; both call the server over HTTP-RPC with WebSocket streams, which makes Desktop and Web two exits of one feature surface.

A session is assembled as a device tree: connections (serial, TCP client/server, UDP, CAN adapters, test-data generators, and feature-gated industrial protocol drivers) own the byte streams, protocol nodes decode them, and point-selectable typed channels feed a React Flow graph whose evaluation drives oscilloscope-style waveforms, gauges, raw data, CAN analysis, logic decoding, and custom widgets. Recording persists sessions to a DuckDB-backed database, and the same capabilities are exposed as MCP tools and CLI subcommands.

The UI features a **dock-style window layout**: control canvases and data views are presented as splittable, mergeable, dockable cards with multi-tab switching, and the layout is persisted automatically.

## Core Features

### Device tree and connections

- Connections, protocol engines, and test-data sources assemble into a **device tree**; each node is enabled, configured, and connected independently, and a typed point can be addressed without knowing the wire format.
- **Serial** (USB-CDC) with configurable baud rate / data bits / parity / stop bits / flow control, discovered from the operating system with USB VID/PID and Bluetooth / PCI / system serial classification.
- **TCP Client** / **TCP Server**.
- **UDP** with independent local & remote addresses.
- **Test Data** — built-in signal generator (Sine / Square / Triangle / Sawtooth / Random / DC / Chirp / Steps / Noise / MultiTone), ideal for offline prototyping.
- **Slcan** — CAN over serial; **CandleLight** — native USB CAN backend; **CAN channel** — a node-driven direct CAN interface.
- **Industrial drivers** — Modbus TCP, Modbus RTU, and Siemens S7 ship behind Cargo features that are enabled by default.
- ISO-TP, UDS, OBD-II, and J1939 form a node-driven diagnostic stack (`libautomotive`) inside the device tree.
- Auto-reconnect and connection-state notifications.

### Protocol decoding

- The catalog of protocol families is owned by the backend and served to the client as descriptors carrying parameters, ports, capabilities, setup guidance, and examples; the UI renders whichever entries the catalog publishes. JustFloat, FireWater, RawData, Slcan, CandleLight, LogicDecode, and schema-defined custom protocols are catalog entries.
- **JustFloat** & **FireWater** — VOFA+-compatible formats with automatic channel detection.
- **RawData** — raw byte stream inspection; the node exposes its bytes as UTF-8 text on a `str` port.
- **Slcan** / **CandleLight** — CAN frame parsing.
- **LogicDecode** — UART / I2C / SPI protocol decoding from sampled digital levels.
- **Custom schema** — a frame schema compiles into its own decoding engine, with a bounded live **protocol preview** that decodes incoming bytes before you commit the graph.
- **Structured validation** — every configuration issue comes back with the path it belongs to, so the form highlights the field that caused it.

### Node Editor & Dataflow

- Built on **React Flow** — drag widgets from the sidebar onto the canvas and wire up dataflows.
- The backend `graph` crate compiles the canvas through a kind → HIR → plane → lower → eval pipeline, orders the evaluation, and produces every node output per frame, with cycle detection.
- Node kinds: `Acquisition`, `PointSelector`, `Protocol`, `ProtocolSource`, `Input`, `Math`, `Str`, `Filter`, `Fft`, `Ifft`, `FrameDecoder`, `Trigger`, `TextInput`, `TextOut`, `TextDisplay`, `Sink`, `Custom` (JS).
- **Math nodes**: Add / Sub / Mul / Div / Avg / Min / Max / Abs / Neg / Square / Sqrt / Sin / Cos / Tan / Log.
- **Filter nodes**: Lowpass / Highpass / Bandpass / Bandstop (FIR coefficients or IIR biquad), with cross-frame state persistence.
- **String nodes**: substring ops (Mid / Left / Replace …) plus conversion ops — **Format** (`{0:.2}` template → text), **Parse** (extract the first number from text, decimal or 0x hex), **EncodeHex** — bridging waveform channels and text protocols in both directions. RawData sources expose their bytes as UTF-8 text through the `str` port.
- **TextOut node**: sends graph-produced text back out of any transport (dynamic send-back). Rate-limited by value change + minimum interval; manual "Send now" button included.
- **Protocol conversion chain**: each Protocol node can re-encode its decoded frames into another protocol and push them along its `out` port — e.g. JustFloat → FireWater feeding another transport; RawData passes raw bytes through unchanged.
- **Fft node**: block-based spectrum analysis with selectable window (Hann / Hamming / Blackman / Rect) and output modes (Magnitude / Power / PSD / dB). It produces no value-plane output; a dedicated 30 FPS ticker computes the blocks and publishes the snapshots a Spectrum display reads, and **Ifft** rebuilds a time-domain stream from a spectrum.
- **PointSelector / Acquisition**: pick typed points from a device node and project them onto numeric graph ports, so a graph can follow one decoded field.
- **Trigger / TextInput / TextDisplay**: edge- or command-driven sends, and a string plane that carries text into and out of the graph.
- **FrameDecoder**: block-based byte-stream parser (Header / Length / Id / Field / Bitfield / Checksum / Tail) with multi-frame dispatch via `match_id` and checksum validation.
- **Custom JS nodes**: user JavaScript runs in a sandboxed iframe; outputs are posted back to the backend graph.

### Operation History · Undo / Redo / Time Travel

- **Snapshot-based undo stack** — canvas actions (node add/remove, wiring, widget config, tab management) are recorded automatically onto a timeline; session-scoped, up to 200 steps.
- **Shortcuts** — `Ctrl+Z` to undo, `Ctrl+Y` to redo; continuous gestures such as node dragging or slider tweaks coalesce into a single entry.
- **Operation History panel** — timeline list with newest first and badges colored by node kind (edges show two-tone endpoint dots); clicking any entry jumps straight back to that moment (snapshot rollback). The current entry is highlighted, and entries above it appear grayed out as "Undone · redoable" — click them to redo.
- **Branch semantics** — editing after an undo discards the redo branch as usual; importing a backup or applying a template rebases the timeline onto a fresh baseline.
- **Panel entry** — "Open Operation History" in the "＋" menu of the data card title bar; also practiced hands-on in the guided tour.

### Displays & Widgets

- **Oscilloscope-style waveform** — powered by uPlot, with timebase zoom, cursor measurements, Run/Stop freeze, per-channel independent / shared Y-axis, thumbnail zoom, crosshair, hover-point markers, and cursor snap.
- **Gauge / LED / NumberDisplay / PieChart / Label** — at-a-glance readouts.
- **Image viewer** — RGB888 / RGB565 / Gray8 pixel formats.
- **Spectrum chart** — real-time FFT visualization.
- **3D model viewer** — powered by Three.js / React Three Fiber.
- **CAN frame list / CAN sender / CAN load view** — with CSV export and load alarms.
- **Logic timing chart** + decoded event list (UART/I2C/SPI).
- **Command sender** (with block editor) and **frame decoder** manual test panel.
- **Raw data view** — standalone widget with grid / line grouping, HEX / ASCII representation, per-port channel switching, timestamp / offset display, and send panel.
- **Custom widget editor** — CodeMirror 6-powered JS editor with live preview; custom widgets and custom JS nodes run in sandboxed iframes.
- **Performance monitor** — live frame budget for the running UI: FPS, average and P95 frame time, long tasks, JS heap usage, and monitor RPC latency.

### Recording & data history

- **Recording sessions** — a DuckDB-backed database (`lissio-recording`, which also exposes its entities through SeaORM) stores recorded rows per channel binding, and the Recording Database panel manages sessions and bindings.
- **Queries and export** — history pages by row id and time range, read-only SQL runs against the recorded tables, and export writes files through the same capability the Web, MCP, and CLI exits call.
- **Run-state gating** — recording follows the workspace Run/Stop/Pause state; pause keeps acquisition and caches filling and stops only device writes.
- **Off by default** — a workspace that has never opted in records nothing, and the setting is read from the connected backend.

### Window Organization & Layout

- **Activity bar** — VSCode-style icon rail on the left. The top icons switch the sidebar view (Device tree / Quick start / Panels / Recording Database) and the rail below them jumps straight to a palette category, which opens the widget catalog in the sidebar.
- **Dockable sidebar** — docks to the left or right edge of the window; drag its title bar to the window edge to switch sides, and show / hide it anytime.
- **Dock-style center area** — control canvases and data views live in splittable / mergeable cards:
  - Drag a tab onto another card's title bar → merge it into that card's tabs;
  - Drag a tab to a card's edge → split it into a standalone panel;
  - Drag an empty area of the title bar → move the whole card next to another card;
  - Drag a tab / card to the four edges of the page → dock as a full row / column strip.
  - The layout tree and card sizes persist automatically (`vofa-dock`, an internal persistence identifier) and survive restarts.
- **Dual tab system** — control-canvas tabs (node editor) and data tabs (waveform / raw data / CAN / logic analyzer, etc.) can be mixed and arranged freely.
- **Status bar** — connection state, transport / protocol, RX / TX bytes and frames, CAN load, and buffer usage at a glance.
- **Multiple tabs** — each tab can be named, renamed, duplicated, and closed independently.

### UX & Platform

- VSCode-style layout: activity bar, sidebar, resizable panels, status bar, multiple tabs.
- Native menu bar (macOS / Windows / Linux) and global shortcuts (`Ctrl+,` for settings; menu items for new / close tab and toggle sidebar).
- **i18n** — Chinese / English UI copy managed via YAML.
- **Settings modal** — general / appearance / editor / data / serial / notifications / performance / AI, declared as searchable field descriptors and persisted by the connected backend.
- **Full-app config export / import** — back up settings, protocol, transport, widgets, node graph, data tabs and view preferences to a single JSON file via system file dialogs, for easy migration.
- Custom theme editor, onboarding wizard, help center, and contextual hints.
- Transparent window with acrylic / vibrancy effect (macOS).
- Native OS notifications via `tauri-plugin-notification`.
- Structured logging via `tauri-plugin-log` (stdout / log dir / webview).

### AI Assistant

- **Streaming AI chat** — a dockable chat panel (right side by default; drag its title bar to re-dock left / bottom or float, layout persisted) with **Markdown rendering** (tables, code highlighting, copyable code blocks / messages) and multi-session management (create / rename / delete, history persisted on the Rust side across restarts).
- **Provider adapters** — OpenAI (chat and Responses), Anthropic, Gemini, DeepSeek, Moonshot, Z.ai, BigModel, Aliyun, OpenRouter, Groq, xAI, Ollama, and any OpenAI-compatible endpoint, with [**OrcaRouter**](https://orcarouter.ai) as the featured default (one key for all vendors; [get an API key via our referral link](https://www.orcarouter.ai/ref/ref_1f7582998bdadbe7e0f3) to support the project). Saved keys are write-only: the interface learns only whether a key is configured, where it came from, and whether it can be written.
- **Tool calling (MCP client)** — the model can call tools from external MCP servers (stdio / HTTP) during a conversation, with per-call tracing.
- **MCP server (inbound)** — the app exposes its own capabilities (serial send, waveform read, node-graph editing…) as MCP tools at `http://127.0.0.1:{port}/mcp`, so Claude Desktop / other MCP clients can drive Lissio directly.

### One core, four exits

- **Capability core** — `control-api` implements device listing, byte / text / CAN sending, byte injection, input values, graph commit and edge editing, waveform / buffer reads, endpoint lifecycle, run control, recording queries, and export as functions over a state slice. Each carries a schemars-derived JSON schema and embedded skill documentation, and MCP routing, built-in AI dispatch, and skill discovery all read that one registry.
- **HTTP-RPC + WebSocket** — `rpc-api` maps a command name and JSON parameters onto a capability call, and streams events back per connection. Desktop and Web share the command names, parameters, and errors; `pnpm check:web-contract` and `pnpm check:contracts` keep the dispatch table and the generated TypeScript honest.
- **MCP server** — the same registry is served as MCP tools over streamable HTTP (`127.0.0.1:8765/mcp` by default), so Claude Desktop or any other MCP client can drive a live session.
- **CLI** — `backend-cli` exposes those commands as argv subcommands (`devices`, `ports`, `send`, `inject`, `input`, `graph`, `data`, `snapshot`, `frame`, `endpoint`, `run`, `record`, `serve`) with JSON-lines events, which is what makes a headless run scriptable.
- **Desktop shell** — Tauri owns windows, menus, the updater, splash, file dialogs, and the lifecycle of the supervised `lissio-server` sidecar. Business calls from the desktop app take the same HTTP/WebSocket path as the browser.

## Usage Guide

### Quick Start

1. **Add a connection** — open the Device tree in the activity bar and add a device (Serial / TCP / UDP / Slcan / CandleLight, or a manually configured connection), fill in the parameters, then connect. Discovered ports are searchable by name, port, and USB VID/PID.
2. **Decode the stream** — add a protocol engine under that node and pick the family matching the wire format (JustFloat / FireWater / RawData / Slcan / CandleLight / LogicDecode, or a custom frame schema). The bounded preview decodes live bytes, so you can confirm the framing before committing the graph.
3. **Build a dataflow** — open the widget catalog from the activity bar, drag displays onto the canvas, and wire them to protocol outputs, selected device points, or upstream widgets.
4. **View data** — display widgets such as Waveform automatically create matching data tabs; you can also click the "＋" in the data card's title bar to add CAN Frames, Logic Analyzer, and other tabs manually.

### Window Organization

The default layout looks like this (all panels can be freely rearranged):

```
┌──────────┬──────────────────────────────────────────────┐
│          │  Control canvas card (tab bar + node editor)  │
│ Activity ├──────────────────────────────────────────────┤
│  Bar     │  Data view card (Waveform / RawData / CAN /   │
│          │  Logic / ...)                                 │
│          ├──────────────────────────────────────────────┤
│          │  Status bar: connection · transport/protocol  │
│          │  · RX/TX · load                               │
└──────────┴──────────────────────────────────────────────┘
```

- **Activity bar** (leftmost rail) — click an icon to switch the sidebar view; the bottom icons open the help center, About, and Settings.
- **Sidebar** (left by default) — shows the configuration panel for the current view; drag its title bar to the window's left / right edge to switch the dock side; toggle visibility via the activity bar icons or the "Toggle Sidebar" menu item.
- **Dock center area** — made of cards, each hosting one or more tabs:
  - **Merge**: drag a tab onto another card's title bar and release to merge it into that card.
  - **Split**: drag a tab to a card's edge (top / bottom / left / right) and release to split it into a standalone panel.
  - **Move card**: drag the empty area of the title bar to move the whole card next to another card.
  - **Page docking**: drag a tab / card to any edge of the window (center area) to dock it as a full row or column strip.
  - **Resize**: drag the separator between cards to change sizes; all sizes and the layout are saved automatically and restored on restart.
- **Status bar** (bottom) — connection state, current transport & protocol, RX / TX bytes and frames, CAN load alarm, and buffer usage; refresh button on the right.

### Tab Management

- **Control-canvas tabs** — each tab is an independent node-editor canvas. Click "＋" in the title bar to create a new one; right-click a tab to rename / duplicate / close / close others; double-click the tab label to rename it directly.
- **Data tabs** — Waveform, Raw Data, Pie Chart, Image, 3D Model, Spectrum, Command Sender, CAN Frames, Logic Analyzer, Table View, Frame Decoder, etc. The "＋" in the data card's title bar adds CAN Frames and Logic Analyzer tabs.
- Tabs can be freely dragged between cards to merge / split, and closed via the context menu.

### Common Actions

- **Settings**: `Ctrl+,` / `Cmd+,` or the gear icon in the activity bar; full-app config export / import is available (backup to a single JSON file).
- **Undo & time travel**: `Ctrl+Z` to undo, `Ctrl+Y` to redo; clicking any entry in the Operation History panel jumps back to that moment (see Core Features).
- **Refresh ports**: the refresh button in the status bar or the context menu.
- **Help & onboarding**: the help icon at the bottom of the activity bar opens the Help Center anytime; a guided tour appears on first launch. Closing or finishing it disables automatic reminders; Help Center can replay it anytime. Settings read/write errors offer a retry action.

## Tech Stack

### Frontend

- [React 19](https://react.dev/) + [TypeScript](https://www.typescriptlang.org/) + [Vite 7](https://vitejs.dev/)
- [Tailwind CSS 4](https://tailwindcss.com/) (via `@tailwindcss/vite`)
- [React Flow](https://reactflow.dev/) (`@xyflow/react`) — node editor
- [uPlot](https://github.com/leeoniya/uPlot) — waveform charts
- [Three.js](https://threejs.org/) + [`@react-three/fiber`](https://github.com/pmndjs/react-three-fiber) — 3D viewer
- [CodeMirror 6](https://codemirror.net/) — custom widget code editor
- [TanStack React Virtual](https://tanstack.com/virtual) — virtualized lists
- [react-resizable-panels](https://github.com/bvaughn/react-resizable-panels) — VSCode-style layout
- [Zustand](https://github.com/pmndrs/zustand) — state management
- [lucide-react](https://lucide.dev/icons/) — icons
- [YAML](https://github.com/eemeli/yaml) — i18n

### Backend

- [Rust](https://www.rust-lang.org/) — `lissio-server`, the process every exit talks to
- [Tokio](https://tokio.rs/) — async runtime; [axum](https://github.com/tokio-rs/axum) — HTTP-RPC and WebSocket transport
- [Serde](https://serde.rs/) + [schemars](https://crates.io/crates/schemars) — capability DTOs and the JSON schemas that MCP routing and the built-in AI both derive from
- [ts-rs](https://crates.io/crates/ts-rs) — the Rust wire types that generate `client/src/types/generated`
- [rmcp](https://crates.io/crates/rmcp) — inbound MCP streamable-HTTP server; the `mcp-client` crate connects out to external MCP servers
- [clap](https://github.com/clap-rs/clap) — `backend-cli` subcommands
- [DuckDB](https://crates.io/crates/duckdb) + [SeaORM](https://github.com/SeaQL/sea-orm) — recording storage behind `lissio-recording`
- [libautomotive](https://crates.io/crates/libautomotive) — UDS / OBD-II / J1939 diagnostics
- [parking_lot](https://github.com/Amanieu/parking_lot) — synchronization

### Desktop shell

- [Tauri 2](https://tauri.app/) — windows, menus, updater, splash, file dialogs, and sidecar supervision
- [window-vibrancy](https://github.com/tauri-apps/window-vibrancy) — acrylic / mica effects
- Tauri plugins: `tauri-plugin-log`, `tauri-plugin-notification`, `tauri-plugin-opener`

### Backend Workspace Architecture

The Rust side is four Cargo workspaces: `server/` plus the `core/`, `physical/`, and
`data/` workspaces nested under it, each with its own lockfile and its own published
crates. Every member declares its domain, dependency layer, and responsibility in
`[package.metadata.lissio]`, and `pnpm check:architecture` reads all four manifests to
enforce the domain DAG and the layer rules. The composition roots are `backend-server`,
`backend-cli`, and the Tauri shell (`lissio`); product capabilities are shared through
`control-api`, command dispatch through `rpc-api`, and assembly through `backend-host`,
which every root reuses.

| Domain | Workspace | Structural responsibility |
| --- | --- | --- |
| `shared` | `core` | Stable contracts: errors, flow envelopes, data/config models, subscriptions |
| `vehicle` | `core` | CAN and diagnostic protocol types |
| `protocol` | `core`, `physical` | Protocol registry and schemas, frame decoding, logic decoding, and points in `core`; the acquisition and simulation engine in `physical` |
| `transport` | `physical` | Device tree assembly and the serial, network, CAN, Modbus, and S7 adapters |
| `signal` | `data` | Waveform buffers, raw data, filters, spectrum, measurements, GPU envelope adapter |
| `graph` | `data` | Node definitions and the kind → HIR → plane → lower → eval compiler/runtime pipeline |
| `data` | `data` | Data bus, the `dataflow` facade, and recording storage |
| `ai` | `server` | LLM clients, chat/session state, MCP client |
| `desktop` | `server` | Pipeline/application state, capability core, RPC dispatch, backend host/server/CLI, AI host, platform shell |

See [`server/docs/architecture/crates.md`](server/docs/architecture/crates.md) for the complete
crate inventory, dependency layers, domain DAG, and architecture checks.

## Project Structure

```text
lissio/                            # umbrella: cross-repository infrastructure only
├── .changes/                      # Release change files consumed by pnpm release:prepare
├── .forgejo/workflows/            # CI and release workflows (submodules checked out recursively)
├── docs/                          # Architecture, governance, performance, and review records
├── e2e/                           # Playwright suites driving the web bundle and a real server
├── packaging/                     # Server startup and container packaging
├── scripts/                       # Architecture, contract, build, and release tooling
├── client/                        # frontend repository (submodule)
│   ├── src/                       # React/TypeScript frontend
│   │   ├── components/            # Controls, displays, layout, nodes, panels, AI UI
│   │   ├── lib/                   # Acquisition, AI, models, platform, rpc, utilities
│   │   ├── store/                 # Zustand stores and state slices
│   │   ├── types/generated/       # Rust-owned wire contracts exported by ts-rs
│   │   ├── i18n/resources/        # en/ and zh/ YAML user-facing copy, one file per surface
│   │   ├── App.tsx
│   │   └── main.tsx
│   ├── public/                    # Static application assets
│   ├── src-tauri/                 # Tauri 2 desktop shell
│   │   ├── src/                   # shell.rs, sidecar.rs, lib.rs, main.rs
│   │   ├── crates/                # Shell-only crates (menu shell, update flow)
│   │   └── tauri.conf.json
│   ├── vite.config.ts
│   └── package.json               # Frontend dependencies and scripts
├── server/                        # Rust repository (submodule): Cargo workspace root
│   ├── crates/<domain>/<crate>    # Crates owned by the server repository
│   ├── core/                      # core submodule: shared, vehicle, and protocol contracts
│   ├── physical/                  # physical submodule: transport adapters, acquisition, simulation
│   ├── data/                      # data submodule: graph, signal, and data crates
│   ├── tests/                     # Integration tests
│   ├── Cargo.toml                 # Workspace and dependency authority
│   └── deny.toml
├── images/                        # README assets
├── package.json                   # Umbrella orchestration manifest
├── pnpm-workspace.yaml
├── playwright.config.ts
└── Dockerfile
```

## Prerequisites

- [Node.js](https://nodejs.org/) (LTS recommended)
- [pnpm](https://pnpm.io/)
- [Rust](https://www.rust-lang.org/tools/install) (stable)
- [Tauri 2 system dependencies](https://tauri.app/start/prerequisites/)
- For CAN diagnostics: a compatible CAN interface (Slcan adapter or CandleLight-compatible USB dongle)

## Installation & Running

1. Clone the repository with its submodules

`client/` and `server/` are separate repositories, and `server/` nests `core/`,
`physical/`, and `data/`, so a usable checkout needs every level.

```sh
git clone --recurse-submodules https://codeberg.org/lissio-industries/Lissio.git
cd Lissio

# or, from a plain clone
git submodule update --init --recursive
```

2. Install frontend dependencies

```sh
pnpm install
```

Lissio is delivered as three artifacts that serve four surfaces: a Backend/CLI archive
holding the `lissio-server` and `backend-cli` binaries, a static Web archive, and a
Desktop installer whose Tauri shell supervises a bundled, same-version `lissio-server`
sidecar. The MCP exit runs inside `lissio-server`.

### Desktop (Tauri)

```sh
pnpm dev:desktop    # prepares and starts the sidecar, Vite, and native shell
pnpm build:desktop  # packaged installers → client/src-tauri/target/release/bundle/
```

Desktop business calls always use HTTP/WebSocket. Tauri IPC is limited to windows,
menus, updates, file dialogs, and sidecar supervision. A connection diagnostic page is
shown before application stores mount when the sidecar is missing, unauthorized,
incompatible, or has crashed.

For Linux/Wayland rendering checks, device-selector behavior, and commands that
preserve other platform build caches, see
[Linux desktop rendering](client/docs/architecture/linux-rendering.md).

### Standalone web server (`lissio-server`)

```sh
pnpm build:web                              # frontend → dist/
pnpm dev:server --static-dir dist           # HTTP API + web app in one process
```

Then open `http://127.0.0.1:8790`. On the first visit append the access token as
`?token=<server-token>` — the browser keeps it in sessionStorage and immediately removes
the parameter from the address bar. The token file is created on first start and its path is printed to the
server log: `~/Library/Application Support/top.pengheng.lissio/server-token` (macOS),
`%APPDATA%\top.pengheng.lissio\server-token` (Windows),
`~/.config/top.pengheng.lissio/server-token` (Linux). You can also set `LISSIO_TOKEN`
explicitly.

| flag | env | default |
|---|---|---|
| `--bind` | `LISSIO_BIND` | `127.0.0.1` |
| `--http-port` | `LISSIO_HTTP_PORT` | `8790` |
| `--token` / `--token-file` | `LISSIO_TOKEN` | `<config dir>/server-token` (0600) |
| `--static-dir` | `LISSIO_STATIC_DIR` | off (API only) |
| `--cors-origin` (repeatable) | `LISSIO_CORS_ORIGINS` | off (same-origin) |
| `--mcp-port` / `--no-mcp` | `LISSIO_MCP_PORT` | `8765` / MCP enabled |

Exposing beyond loopback requires `--bind 0.0.0.0` plus a strong `LISSIO_TOKEN`.
`pnpm server` is equivalent to `cargo run --manifest-path server/Cargo.toml -p lissio-backend-server`; the CLI
form `cargo run -p lissio-backend-cli -- serve` shares the same code path. Health check:
`curl http://127.0.0.1:8790/api/v1/health`.

AI, session, external MCP, inbound MCP, and frontend-tool commands have the same feature
surface in Desktop and Web. Saved provider keys are write-only: the UI receives only
`configured`, `source`, and `writable`. Deployment fallback variables use
`LISSIO_AI_API_KEY_<ADAPTER>` (for example `LISSIO_AI_API_KEY_OPENAI`).
Debug builds read these keys directly from the repository root `.env` on each request and do
not access the system keychain. Copy `.env.example` to `.env` and edit it locally. The file is
gitignored. Release builds continue to use the system keychain with the environment fallback.

### OCI (server + Web)

```sh
docker run --rm -p 8790:8790 -p 8765:8765 \
  -e LISSIO_TOKEN='replace-with-a-strong-token' \
  -v lissio-data:/var/lib/lissio ghcr.io/lissio-industries/lissio:latest
```

The image refuses to start without an explicit token. Map serial/CAN devices with the
container runtime's device options when hardware access is required.

### Web frontend development (hot reload)

```sh
pnpm dev:server # terminal 1: standalone backend at :8790
pnpm dev:web   # terminal 2: vite dev server at :1420, /api proxied to the backend
```

Open `http://localhost:1420/?token=<server-token>` once (the token persists in
sessionStorage). Point the proxy at a different backend with
`LISSIO_DEV_SERVER=http://host:port`.

## Build & Packaging

Build server, CLI, desktop, and web for the current platform:

```sh
pnpm build:all
```

This runs `build:server` (server + CLI), then `build:desktop`, whose Tauri hook builds the web assets once, and finally checks native Windows installer integrity. The build stops if any step fails. Local desktop builds disable updater artifacts using `client/src-tauri/tauri.local.conf.json`, so `TAURI_SIGNING_PRIVATE_KEY` is not required. Release packaging retains updater signing through the default Tauri configuration.

Individual build commands:

```sh
pnpm build:web
pnpm build:server
pnpm build:cli
pnpm build:desktop
```

Web assets are output to `client/dist/`, server and CLI binaries to `server/target/release/`, and desktop installers to `client/src-tauri/target/release/bundle/`.

On Windows, `build:all` finishes with `scripts/finalize-bundles.mjs`. It checks
the current-version installers in the existing `bundle/nsis/` and `bundle/msi/`
folders, raises Low integrity labels to Medium, and verifies SHA256 is unchanged.
A Low-integrity EXE can make NSIS report "Error writing temporary file" even
when the user's Temp directory is healthy. Installer paths stay fixed inside
the checkout; there is no separate export command or destination setting.
If the integrity check fails, run `pnpm build:all` from an ordinary Windows
terminal outside the sandbox. macOS and Linux skip this Windows-specific step
and keep Tauri's normal bundle outputs.

On a macOS host, the automated packaging script covers cross-target builds,
updater signing, and artifact collection:

```sh
pnpm auto-build              # current macOS architecture (macOS host required)
pnpm auto-build --all        # macOS (arm64 + x64), Windows, Linux
```

To drive Tauri directly, for example to build a single bundle:

```sh
# Windows cross-compilation
pnpm tauri build --runner cargo-xwin --target x86_64-pc-windows-msvc

# macOS dmg package
pnpm tauri build --bundles dmg
```

CI runs on Codeberg with Forgejo Actions, from `.forgejo/workflows/` (`ci.yml`
for quality gates, `release.yml` for releases). The gate list is defined once in
`scripts/gates.mjs`. See [`docs/ci.md`](docs/ci.md) for runner setup, the gate
registry, and the release pipeline.

## Testing

Run the same quality surface as CI in one command:

```sh
pnpm check:all          # everything, with formatting fixes
pnpm check:all --quick  # PR-tier gates only
pnpm gates --list       # print the gate inventory
```

The individual gates are listed in
[`AGENTS.md`](AGENTS.md#commands); that list is generated from
`scripts/gates.mjs`, which CI and `pnpm check:all` both read. A green subset is
not a green build.

## Contributing

Contributions are what make the open-source community such a great place to learn, inspire, and create. Any contributions you make are **greatly appreciated**.

1. Fork this project
2. Create a feature branch: `git checkout -b feature/AmazingFeature`
3. Commit your changes: `git commit -m 'Add some AmazingFeature'`
4. Push to the branch: `git push origin feature/AmazingFeature`
5. Open a Pull Request

Read [CONTRIBUTING.md](./CONTRIBUTING.md) first: it lists the CLA terms, the IP checks your change must satisfy, and the full gate list (`pnpm check:all`).

## Versioning

This project is managed with Git. Available releases can be found on the [Releases](https://codeberg.org/lissio-industries/Lissio/releases) page.

## License

Lissio is licensed under the **Apache License, Version 2.0**; see
[LICENSE](./LICENSE). Apache-2.0 permits commercial use, modification, and
closed-source derivatives subject to its notice and attribution conditions.
Copyright © 2026 Horldsence and Lissio contributors. Contributions are made
under [CLA.md](./CLA.md). Historical GPL-only releases remain governed by the
license supplied with those releases. Attribution and third-party obligations
are maintained in [NOTICE](./NOTICE) and
[docs/governance/third-party-licenses.md](docs/governance/third-party-licenses.md).

Contributions are welcome — see [CONTRIBUTING.md](./CONTRIBUTING.md),
[CODE_OF_CONDUCT.md](./CODE_OF_CONDUCT.md) and [SECURITY.md](./SECURITY.md).
Licensing and governance questions go to
[pengheng.wang@foxmail.com](mailto:pengheng.wang@foxmail.com);
[MAINTAINERS.md](./MAINTAINERS.md) lists the maintainers and response targets.

## Acknowledgements

- [VOFA+](https://www.vofa.plus/) for the FireWater / JustFloat compatibility protocol references
- [Tauri](https://tauri.app/)
- [React Flow](https://reactflow.dev/)
- [uPlot](https://github.com/leeoniya/uPlot)
- [Three.js](https://threejs.org/) / [React Three Fiber](https://github.com/pmndjs/react-three-fiber)
- [CodeMirror](https://codemirror.net/)
- [Tailwind CSS](https://tailwindcss.com/)
- [lucide-react](https://lucide.dev/)
- [libautomotive](https://crates.io/crates/libautomotive)

<!-- links -->
