# Lissio Software & Core Concepts Overview

<!-- lissio-doc
status: maintained
owner: Lissio maintainers
last-reviewed: 2026-10-07
language: en
authoritative: true
applies-to: Runtime English capability help: overview.md
-->
Lissio is a data-acquisition and debugging host application for embedded development with VOFA+-compatible protocol support with serial / TCP / UDP / CAN / logic-analyzer
and industrial point scenarios. Its capabilities include device-tree
acquisition, protocol parsing, waveforms and widgets, CAN/logic analysis,
command frames, and recording with history queries.

## Typed Data Architecture

- **Byte devices** expose typed `rx`/`tx` ports and feed parser/encoder nodes.
- **Point devices** expose a `points` port. Point Selector converts selected,
  stable point IDs into named numeric outputs while preserving native values
  and quality until that explicit projection.
- Every control tab owns an independently compiled graph. Direct cross-tab
  connections are rejected.

## Canvas & Nodes

- **Control tabs**: each canvas owns all of its device, parser and widget nodes.
- **Device nodes**: Serial, TCP, UDP, Slcan, CandleLight and Modbus devices are
  created from one capability catalog and share one session lifecycle.
- **Widget nodes**: input controls (Knob/Slider/Button/...), display widgets
  (Waveform/Gauge/...), and compute nodes (Math/Filter/FFT/FrameDecoder/
  Trigger/...) live inside a tab as widgets.
- **Edges**: byte edges (Vec<u8>, Transport→Protocol etc.) and value edges
  (f32, between widgets). On connect the backend compiles and derives port
  tables; compile failures keep the old graph and report an error.

## Software Operation Entrypoints (built-in AI tools)

- Graph read/write: the built-in AI uses get_workspace for the full canvas and
  add_node / remove_node / update_node_config / move_node for node editing.
  connect_edge / disconnect_edge edit wires incrementally; update_graph
  atomically replaces a complete tab. Backend compilation checks each wire.
- Devices and run control: list_driver_manifests / list_device_tree_nodes /
  list_endpoints inspect capabilities and state. The built-in AI can use
  connect_device / disconnect_device; backend tools provide open_endpoint /
  close_endpoint, read_points / write_points, and run_workspace.
- Transport and commands: list_devices / list_serial_ports inspect sessions;
  send_bytes / send_string / send_can_frame / send_command_frame send data,
  while compute_command_frame_bytes previews encoding.
- Data reads: get_graph_outputs (latest values of all output ports),
  get_recent_waveform / get_waveform_window, get_can_frames, get_logic_data,
  get_raw_data (raw TX/RX bytes), get_buffer_info, list_data_sources.
- Waveform and history: create_waveform_snapshot / query_waveform_snapshot
  freeze and inspect waves; export_waveform_csv exports them. Recording tools
  manage sessions, query history or read-only SQL, and export data.
- Others: set_input_value drives input widgets; the built-in AI can use
  apply_template to create a template workspace.

## Example Data Flow

Serial device with a Test Data attribute → Protocol(JustFloat) → Waveform:
connect `device.rx → protocol.in`, then a protocol channel to the display, and
call `connect_device`. The simulated session never opens the real serial port.