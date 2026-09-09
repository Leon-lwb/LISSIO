# Built-in Tools Guide

Built-in tools come in two kinds: backend-direct (data/sends, executed
directly) and frontend-hosted (node editing / UI operations, executed through
the app UI so the canvas updates live and edits enter undo history).

## Read Current State (read before write)

- get_workspace: the active tab plus each tab's `documents + edges`. Documents
  share `id/tabId/label/layout/kind/config/attributes`; `derived_ports` contains
  runtime port contracts. **Required reading before any edit**.
- list_devices / list_serial_ports: open device sessions and available ports.
- list_data_sources / get_buffer_info: waveform sources and sizes.
- list_templates: available workspace template ids.

## Node Editing (frontend-hosted)

- add_node {type: device|protocol|point-selector|widget, kind, tab_id?,
  endpoint_id?, config?, position?} → returns node_id. `device.kind` is an
  adapter ID from the capability catalog; omitted tab_id means the active tab.
- update_node_config {node_id, config}: update config (widgets: params
  deep-merge; device updates driver payload; protocol updates parser config).
- remove_node {node_id}: delete any node in its tab, cascade edges, and close a
  device session when applicable.
- move_node {node_id, x, y}: canvas position (visual only).
- create_tab {name?} / set_active_tab {tab_id}.
- connect_device / disconnect_device {node_id}.
- apply_template {template_id}.

## Wiring (backend-authoritative, compile-checked)

- connect_nodes {source, target, source_handle?, target_handle?, tab_id?}:
  connect. Handles default automatically; RawData widget targets get their
  `src:` port rewritten. **Domain mismatch (e.g. freq into time), cycles and
  non-existent ports fail outright with the real reason (both ports and their
  domains) and no edge is created** — fix the port or config per the message
  and retry. Success returns edge_id and the canvas syncs live.
- disconnect_edge {edge_id} or {source, target} (either end alone works).

## Device Interaction (backend-direct)

- send_bytes {node_id, data: number[]} / send_string {node_id, text}.
- send_can_frame {node_id, protocol_node?, frame}.
- set_input_value {widget_id, value}.

## Data Reads (backend-direct)

- get_graph_outputs: latest value of every output port (cheapest poll).
- get_recent_waveform {source, count≤10000} / get_waveform_window {source,
  start_ms, end_ms} (ms offsets relative to the newest timestamp).
- get_can_frames {count≤1000, bitrate?} / get_logic_data {count≤5000} /
  get_raw_data {source, max_bytes≤64KiB}.
- read_skill {skill_id}: full text of a knowledge-base article (ids in the
  system prompt index).

## Caveats & Limits

- Waveform/CAN/logic/raw reads are capped; oversized counts get truncated —
  probe with small counts first.
- The wire topology is stored and compile-checked by the backend; all writers
  (canvas / built-in AI / external MCP) share one graph. Tool failures carry
  the reason and can be used for self-correction.
- Tool results are JSON strings; node ids are primary keys — never invent
  them, always source from read tools.
- Edits enter the app's undo history; the user can Ctrl+Z your changes.
- Test Data is a unique device attribute, not a node. Apply it from the
  Attributes palette to a selected device; reconnect to start simulation.
