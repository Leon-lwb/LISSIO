---
"lissio": patch:fixed
---

Make the MCP port in the AI settings the port the server actually listens on.
The Desktop sidecar was launched with a hard-coded `--mcp-port 0`, so the local
MCP server always bound an OS-assigned high port, and `mcp_server_start` returned
the already-running listener's port without ever looking at the requested one —
`app.ai.mcpServerPort` was silently ignored on Desktop. `lissio-server` now
resolves the port as explicit flag > `LISSIO_MCP_PORT` > `settings.json`
(`app.ai.mcpServerPort`) > `8765`, and an explicit port switches the listener
(the old listener is closed first). Changing the port in the settings stops and
rebinds immediately, so the address shown in the UI and the port written in
external MCP client configurations stay in sync.

A port that cannot be bound turns into a diagnosis instead of a dead app: MCP
startup failure no longer aborts the Web exit, the failure is recorded as
`McpServerStatus.conflict` (requested port, bind error, the process holding the
port, and a free alternative port), and a new read-only `mcp_port_check` command
reports whether a candidate port is bindable, who holds it, or whether it looks
reserved by the system (Hyper-V / WSL2 / Docker on Windows). The MCP settings
page probes the configured port on open and on every change, shows an inline
conflict banner with "use the suggested port", "retry", and "stop MCP", and a
deduplicated toast carries the same diagnosis. Holder identification shells out
to `netstat`/`tasklist` on Windows and `lsof` on Unix, and degrades to "port
unavailable" when neither is available; the probe itself is advisory, since the
bind performed by the server remains the authority.
