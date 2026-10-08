# Built-in Tools Guide

<!-- lissio-doc
status: maintained
owner: Lissio maintainers
last-reviewed: 2026-10-07
applies-to: Runtime English capability help: tools-guide.md
-->
Lissio's built-in AI has two tool groups: capability-registry tools execute in
the backend, while frontend-hosted tools operate through the UI. External MCP
clients only receive the capability-registry tools; frontend-hosted tools such
as `get_workspace`, `add_node`, and `connect_device` are available only to the
built-in AI. Use the tool list supplied to the model for the current turn.

## Action workflow

1. State the intended result in one sentence. Proactively ask a few specific
   questions when the target device, protocol settings, point, bytes to send,
   time range, or output path is essential but unclear. Safe discovery and
   reads can proceed while those details are being clarified.
2. Inspect the current state and make a short plan. The built-in AI uses
   `get_workspace` for tabs, node documents, edges, and `derived_ports`; read
   device, endpoint, driver, data-source, or recording state as needed. Use
   `read_skill` for details. Take node, endpoint, point, tab, and snapshot IDs
   from read or create results.
3. Act in small steps using each tool's actual parameter schema. If a wire or
   graph commit fails, use the error to correct the port, domain, or config
   before retrying. Never invent IDs, protocol bytes, or hardware state.
4. Verify each meaningful action with the corresponding read tool. Report the
   operations performed, observed data, and any unresolved conditions. For
   hardware writes or deleting recording data, ask first if the user's intent
   or target remains unclear.

## Workspace and graph

**Frontend-hosted, built-in AI only:**

- `get_workspace` returns the active tab, each tab's `documents + edges`, and
  separate `derived_ports`. Read it before editing an existing canvas.
- `add_node`, `update_node_config`, `remove_node`, `move_node` create, configure,
  delete, or move device, protocol, point-selector, and widget nodes. `add_node`
  returns `node_id`.
- `create_tab`, `set_active_tab` create or select a control tab.
- `connect_device`, `disconnect_device` open or close a canvas device session.
- `list_templates`, `apply_template` list available IDs before applying a
  template. The built-in AI adds a new tab by default.

**Capability-registry tools, shared by the built-in AI and external MCP:**

- `list_tabs` returns IDs of committed backend tabs, not full canvas documents.
- `update_graph {tab_id, documents, edges}` atomically replaces a tab's
  **entire** graph document. Use it only when the complete documents and edges
  are known; do not submit a partial list as an incremental edit.
- `connect_edge {source, target, source_handle?, target_handle?, tab_id?}` adds
  a wire. Handles can default. A domain mismatch, cross-tab edge, cycle, or
  missing port fails compilation without adding an edge.
- `disconnect_edge {edge_id?, source?, target?}` removes a wire by ID or endpoint.
- `set_input_value {widget_id, value}` sets a numeric input and evaluates it.
- `get_graph_outputs` reads the latest output-port values.

Before wiring, check actual **output** ports and domains in
`get_workspace.derived_ports`; use the node type reference and current config
for input ports. Backend compilation errors explain how to correct a failed
edge. Graph writes update the canvas; frontend-hosted edits enter undo history.

## Device discovery, run control, and I/O

- `list_driver_manifests`, `list_device_tree_nodes`, `list_endpoints` inspect
  driver IDs/capabilities, device-tree state, and opened endpoints.
  `open_endpoint {node_id}` / `close_endpoint {node_id}` open or close an
  acquisition subtree.
- `run_workspace {action: start|pause|stop}` controls acquisition and graph
  evaluation. Running and paused both acquire, fill caches and record; pause only
  stops auto-send and device writes, while stop drops in-flight data and clears
  pending send tasks. Pause before creating or switching a recording session.
- `read_points {node_id, point_ids}`, `write_points {node_id, request}` read
  or write stable point IDs. A write request includes `correlationId`,
  `deadlineUnixNs`, and `items`; follow the tool schema.
- `list_devices`, `list_serial_ports` inspect open device sessions and
  available serial ports.
- `send_bytes {node_id, data}`, `send_string {node_id, text}` send raw bytes
  or UTF-8 text through a transport. `send_string` adds no newline.
- `inject_bytes {source_node_id, data}` injects test bytes into an existing
  byte path for hardware-free parser debugging.
- `get_raw_data {source, max_bytes?}` reads recent TX/RX bytes and direction
  from a source, up to 64 KiB.
- `compute_command_frame_bytes {frame, inputs?}` previews bytes with the same
  encoder used by `send_command_frame {widget_id, frame, inputs?}`. Sending
  routes through the command node's downstream path and requires the workspace
  to be running.
- `get_can_frames {count?, bitrate?}`, `send_can_frame {node_id,
  protocol_node?, frame}` inspect or send CAN frames. `get_logic_data {count?}`
  reads logic samples and decoded events.

## Waveforms and recordings

- `list_data_sources`, `get_buffer_info {source}` locate waveform sources and
  check buffer sizes.
- `get_recent_waveform {source, count?}`, `get_waveform_window {source,
  start_ms, end_ms}` read recent samples or an offset window in milliseconds
  relative to the newest timestamp. `count` is capped at 10000.
- `create_waveform_snapshot {source}` → `query_waveform_snapshot {snapshot_id,
  start_ms, end_ms, max_points, selection?}` → `release_waveform_snapshot
  {snapshot_id}` freeze, inspect, and release a waveform snapshot.
  `export_waveform_csv` writes a CSV over an absolute microsecond timestamp
  range that must be fully covered by the buffer.
- `list_recording_sessions`, `list_recording_bindings {session_id}` locate a
  session and its channel bindings. `get_recording_health` checks health;
  `flush_recording` writes pending batches before a read.
- `create_recording_session`, `switch_recording_session {session_id}` change
  the active recording target after `run_workspace pause`.
  `delete_recording_session {session_id}` deletes a session and its data.
- `query_recording_history {session_id, binding_id?, after_row_id?, from_us?,
  to_us?, limit?}` pages through history. `query_recording_sql {sql,
  max_rows?}` runs read-only DuckDB queries. `export_recording_data {request}`
  exports recorded data.

## Knowledge and troubleshooting

- `list_skills`, `read_skill {skill_id, lang?}` list and read knowledge-base
  documents on demand.
- For missing data, confirm the workspace is running, then check connection
  state via `list_endpoints` / `list_devices`. Inspect raw bytes with
  `get_raw_data` for byte devices or value and quality with `read_points` for
  point devices. Then check wiring and protocol via `get_workspace` and buffer
  size via `get_buffer_info`; for recording issues also check
  `get_recording_health`. Ask which device or signal the user means when the
  source cannot be identified.
- Data reads have size caps. Probe with a small window before expanding it.
  Tool errors report argument or execution failures; do not report a failed
  action as completed.