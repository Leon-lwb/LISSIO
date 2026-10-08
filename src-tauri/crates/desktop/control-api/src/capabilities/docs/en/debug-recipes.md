# Device Debugging Playbook

<!-- lissio-doc
status: maintained
owner: Lissio maintainers
last-reviewed: 2026-10-07
applies-to: Runtime English capability help: debug-recipes.md
-->
## Task 1: Connect a device and show a waveform

1. Ask or confirm the target device, protocol, and expected signal; use
   list_serial_ports / list_driver_manifests to inspect ports and drivers.
2. get_workspace → inspect the active tab, nodes, edges, and derived_ports.
3. If nodes are missing, use an adapter ID from the capability catalog with
   add_node(type=device, kind=...), then add_node(type=protocol,
   kind=JustFloat) and add_node(type=widget, kind=Waveform).
4. connect_edge: device.rx → protocol.in; protocol channel → waveform.data.
5. connect_device(node_id=...), then run_workspace(action=start) to process data.
6. If a command is needed and its contents are known, use send_string / send_bytes.
7. get_recent_waveform(source=protocol node id, count=100) to verify data; or
   get_graph_outputs for live port values.

For custom device protocols, add a FrameDecoder widget and describe the frame
with blocks; named fields become output ports.

## Task 2: Periodic control / acquisition

- Input control: add a Knob/Slider widget and wire it downstream; or just
  set_input_value(widget_id, value) to change a value instantly.
- Button press value: set_input_value works too (pressValue).
- TextInput + TextOut writes strings back to a device's tx.

## Task 3: Hardware-less protocol debugging

1. Build Device → Protocol → display chain in one tab.
2. Either attach the Test Data attribute and reconnect, or use
   inject_bytes(source_node_id=device id, data=[...]) for a one-shot frame.
3. Run run_workspace(action=start), then verify with get_graph_outputs /
   get_recent_waveform.

## Task 4: Diagnosing "no data"

1. Confirm the workspace is running; list_endpoints / list_devices → is the
   device session connected?
2. For byte devices, get_raw_data(source=device id) checks TX/RX. For point
   devices, read_points checks values and quality.
3. Source OK but no waveform → check wiring (get_workspace), protocol kind and
   channels.
4. get_buffer_info(source=protocol id) → is the buffer accumulating points?

## Task 5: CAN bus debugging

1. Use list_driver_manifests to confirm a CAN adapter ID; then add_node(
   type=device, kind=adapter ID) → connect_device → run_workspace(action=start).
2. get_can_frames(count=100) for recent frames + bus load.
3. send_can_frame(node_id=..., frame={id: 0x123, data: [1,2,3], direction: "tx"}).

## Task 6: Quick demo workspace

apply_template(template_id=...) applies a built-in template in one step (query
list_templates first) — ideal for demonstrating standard chains.

## Task 7: Read or write points

1. list_device_tree_nodes / list_endpoints identifies the acquisition node and
   connection state; use open_endpoint(node_id=...) if needed.
2. Take point_ids from device-tree and capability results, then use
   read_points(node_id, point_ids) to inspect native values and quality.
3. If the user intends a write, confirm the target point, value, and device.
   Submit the request using the write_points schema, then verify with
   read_points. Do not treat bad quality or stale data as success.

## Task 8: Record and inspect history

1. list_recording_sessions finds sessions; list_recording_bindings(session_id)
   finds their channel bindings.
2. Before creating or switching the write target, run run_workspace(action=pause),
   then create_recording_session / switch_recording_session.
3. Use flush_recording before reading; page with query_recording_history or
   aggregate with read-only query_recording_sql. Use export_recording_data
   when a file is needed.

## General Working Conventions

- State the goal first. Proactively ask when the device, protocol, point, or
  command bytes are unclear, while continuing safe reads.
- Built-in AI: read get_workspace before editing; act in small steps and verify.
- Node ids are the primary key of every tool. Never invent them — take them
  from get_workspace or tool results.
- Compile failures keep the old graph and return the reason (cycle / port
  domain mismatch) — fix and retry.