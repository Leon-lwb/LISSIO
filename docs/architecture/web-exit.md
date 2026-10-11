# Web Exit and `lissio.web.v2`

<!-- lissio-doc
status: maintained
owner: Lissio maintainers
last-reviewed: 2026-10-11
applies-to: lissio.web.v2 HTTP/WebSocket protocol and Web delivery boundary
-->
Desktop and browser business calls enter the same `lissio-server` through
HTTP-RPC and WebSocket. The CLI reuses the same assembly and dispatch table.
All exits share `control-api`, `rpc-api`, and `backend-host`.

Command names, top-level parameter names, error kinds, event names, payload
shapes, and persisted formats remain identical across exits. The Web exit moves
existing semantics onto HTTP/WS; it does not invent a second API.

## Delivery shapes

| Shape | Backend | Frontend transport |
| --- | --- | --- |
| Backend/CLI | Standalone `lissio-server` and `backend-cli` | HTTP/WS and argv |
| Desktop | Tauri supervises the same-version sidecar | HTTP/WS |
| Web | Compatible remote backend or same-origin OCI deployment | HTTP/WS and static `dist/` |

Tauri IPC carries only windows, menus, updater, file dialogs, and sidecar
control. Display streams use WebSocket binary frames.

## Crate boundaries

`rpc-api` performs transport-neutral command dispatch. `backend-server` owns
HTTP/WS protocol adaptation, authentication, static hosting, and managed
downloads. `backend-host` owns assembly and lifecycle. `backend-cli` and
`lissio-server` are two roots over the same implementation. `ai-host` owns AI,
MCP, built-in tools, and write-only secret ports.

## Wire protocol

### HTTP RPC

`POST /api/v1/rpc` accepts one request or an array:

```jsonc
{ "id": 1, "cmd": "update_tab_graph", "args": { "tabId": "t1", "documents": [], "edges": [], "baseVersion": 7 } }
{ "id": 1, "ok": true, "result": { "nodes": [] } }
{ "id": 1, "ok": false, "error": { "kind": "GraphVersionConflict", "message": "..." } }
```

Command names match the existing invoke surface. Top-level camelCase arguments
are normalized to snake_case; nested serde DTOs own their field names. Errors
preserve stable `kind` and message.

### WebSocket

`GET /api/v1/ws` multiplexes events, notifications, streams, RPC responses, AI
channels, faults, subscriptions, unsubscribe requests, and ping frames.

Subscriptions do not accept client IDs. The server allocates IDs in a
process-level namespace and sends `subscribed` before any stream frame for that
subscription. Clients preserve ordering between pending subscription requests
and acknowledgements. Cancellation after acknowledgement sends `unsubscribe`.
Connection close removes every connection-owned subscription.

Binary streams use a fixed header followed by the same payload bytes as desktop
raw display IPC:

```text
[u8 version=1][u8 format=1][u32 BE subscription_id][u32 BE payload_len][payload]
```

WWB1, VNDP, and VENV therefore require no host-specific recoding.

## Routes and configuration

| Route | Purpose |
| --- | --- |
| `POST /api/v1/rpc` | Single or batched command dispatch |
| `GET /api/v1/ws` | Events, streams, and connection RPC |
| `GET /api/v1/download/{token}` | Managed staged export only |
| `GET/PUT /api/v1/settings` | Current settings file and shape |
| `GET /api/v1/health` | Unauthenticated health check |
| `GET /api/v1/handshake` | Version, protocol, instance, and capabilities |
| `GET /api/v1/capabilities` | Supported, pending, desktop-only, and protocol |
| `--static-dir` | Host the Web bundle with SPA fallback |

| Option | Environment | Default |
| --- | --- | --- |
| `--bind` | `LISSIO_BIND` | `127.0.0.1` |
| `--http-port` | `LISSIO_HTTP_PORT` | `8790` |
| `--token`, `--token-file` | `LISSIO_TOKEN` | Generated config-dir token |
| `--static-dir` | `LISSIO_STATIC_DIR` | empty |
| `--cors-origin` | `LISSIO_CORS_ORIGINS` | empty, same-origin |
| `--mcp-port`, `--no-mcp` | `LISSIO_MCP_PORT` | `8765`, MCP enabled |
| — | `LISSIO_CONFIG_DIR` | shared host resolution |

## Settings and onboarding

`src/lib/platform/backendStore.ts` is the Desktop/Web settings client. It uses
only the authenticated endpoint installed by `configureBackend`, reads fresh
settings, and serializes writes across client instances. Requests queued for an
old connection cannot write to a replacement backend. `backend-host::SettingsStore`
owns `config_dir/settings.json`, with the current `{ "app": { ... } }` shape.
Only a missing file is a fresh installation; invalid JSON and read failures are
reported. A successful PUT acknowledges a flushed temporary file and atomic
replacement.

`src/store/settingsStore.ts` distinguishes initialization completion from a
successful read. Failed reads pause automatic onboarding and settings writes,
with a retry notification. Save failures retain the in-memory choice and offer
retry. Closing or completing onboarding saves `showOnboarding: false`
immediately; version changes do not reopen it. Help Center can replay it, and
any open tour keeps keychain reminders and automatic updates queued.

## Authentication

HTTP uses `Authorization: Bearer <token>`. WebSocket uses
`Sec-WebSocket-Protocol: lissio.v2, bearer.<token>` because browsers cannot set
request headers and query tokens would enter logs. Token comparison is
constant-time. Empty CORS configuration installs no CORS layer. SIGTERM and
Ctrl-C stop recording, flush workspace state, and close resources.

## Command capability matrix

`rpc-api/src/catalog.rs` is authoritative. The gate verifies disjoint lists,
complete dispatch, frontend calls, and Tauri-only registration of desktop shell
commands.

Shared commands cover device and acquisition discovery, device-tree and driver
manifests, endpoint lifecycle, typed points, byte/text/CAN sending, graph
documents and edges, workspace run state, pipeline configuration, buffers,
waveform snapshots and CSV exports, command frames, display acknowledgements,
logic/CAN/raw diagnostics, recording sessions/history/SQL/export, AI chat and
secrets, MCP lifecycle/tools, graph HIR, and frame-decoder parsing.

Desktop-only commands cover inspector, window acrylic, main-window and splash
control, and updater actions. Subscription commands map to WebSocket subscribe
and unsubscribe frames.

## Frontend transport

`src/lib/rpc/` separates the application API from Tauri. One transport state
machine handles desktop delegation and Web HTTP/WS, reconnection,
resubscription, binary routing, request cancellation, and workspace
rehydration. Platform services remain behind `src/lib/platform/`.

Endpoint resolution uses query/server storage/build-time configuration in a
defined order. Tokens from query parameters are moved into session storage and
removed from the URL.

The app mounts only after backend diagnosis and successful authenticated
handshake. Missing backend, invalid token, and network failure remain distinct
states.

## CLI

```text
backend-cli serve [--bind] [--http-port] [--token-file] [--static-dir]
                  [--cors-origin] [--mcp-port | --no-mcp] [--no-http]
backend-cli rpc <cmd> [--args <json|@file>]
backend-cli devices|send|inject|endpoint|graph|data|snapshot|frame|run|record
```

`serve` enables Web and MCP by default. `rpc` reaches the full dispatch table.

## Tests and gates

- `pnpm check:web-contract` checks catalog/dispatch/frontend/Tauri consistency.
- Rust tests cover argument normalization, frame codecs, constant-time token
  comparison, subscription ordering, recovery, and teardown.
- Vitest covers micro-batching, response mapping, WS RPC/events, subscription
  acknowledgement FIFO, cancellation races, binary routing, reconnect, and
  resubscription.
- Playwright runs against a real `lissio-server` and covers diagnostics,
  handshake, wrong tokens, unreachable network, and query-token cleanup.
- Manual smoke commands use `/api/v1/health`, `/api/v1/capabilities`, and
  `/api/v1/rpc`, plus the equivalent `backend-cli rpc` path.

## Current boundaries

Multi-client mode means multiple views over one backend session; graph edits use
base-version optimistic concurrency and do not promise collaborative editing.
Shared implementations such as graph HIR and frame parsing remain in
`control-api`. Very high-rate browser workloads may saturate frontend rendering
even when the backend and wire path are healthy; browser scale guidance or
downsampling remains an optional enhancement.
