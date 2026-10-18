---
"lissio": major:changed
---

Hardened the architecture at the points where a documented invariant was not
actually enforced, and made three wire contracts machine-generated.

Breaking for direct consumers of the RPC error payload and of `NodeKind`
documents:

- RPC domain errors now emit `{ kind, message, data? }` with the error's own
  fields flattened one level (`error.data.current`), instead of serializing the
  whole `AppError` into `data` (`error.data.data.current`). The graph
  version-conflict error has its own stable kind, `GraphVersionConflict`, rather
  than reporting as `Config`. A stale `base_version` is now detected by `kind`
  instead of by matching a Chinese message substring. Trade-off: external
  scripts that branched on `kind == "Config"` or read `data.data` must update.
- `TriggerRuleDef` is now camelCase on the wire (it was the only snake_case type
  in the exported contract set), which changes the field names of
  `NodeKind::Trigger.rules[]` items inside graph documents.

Other contract and behaviour changes:

- The WebSocket/HTTP frame types (`ServerMessage`, `ClientMessage`, `RpcRequest`,
  `RpcResponse`, `Capabilities`) and the protocol constants are generated from
  Rust into `src/types/generated`; the frontend transport imports them instead of
  re-declaring them. `check:contracts` now also fails when two Rust types would
  write the same generated file or when the frontend re-declares an exported
  type name.
- `/api/v1/capabilities` requires the bearer token; anonymous callers learn only
  the protocol version from `/api/v1/health`. Unknown `/api/*` paths return a JSON
  `404` envelope instead of the SPA's `200 text/html`.
- `backend-cli serve` resolves the MCP port through the same
  `mcp_server::resolve_mcp_port` precedence as `lissio-server` (including
  `settings.json`), and `--no-http --no-mcp` now errors instead of starting MCP.
- Graph commits are serialized by one commit lock covering the version check and
  every state write, so two commits sharing a `base_version` can no longer
  silently drop each other's nodes from the runtime index; the remove-tab path
  takes the same lock. A recording writer that dies before accepting any batch is
  now classified as *unavailable* rather than a recording contract fault, so it
  no longer stops acquisition.
- Frontend: leaf widgets no longer issue backend commands (the text-out send is
  hosted by `WidgetNode`), per-frame store writes are value-guarded, and the tab
  metadata listener no longer serializes on every store notification.

Gates: `check:ci-gates` anchors each gate's tier (a demotion now fails), the
inline-test matcher, motion `var()` resolution, layer-matrix check, and
lower-layer external-dependency inventory enforce what their documents claim,
`check:docs` walks the tracked tree, `check:web-contract` compares RPC argument
names on both sides, and Cargo's `cargo::` lint namespace is denied (the unused
`data_model` dependency is gone). `pnpm architecture` no longer reports
dev-only dependencies as shipped edges.

Files: src-tauri, src, scripts, docs, .changes
