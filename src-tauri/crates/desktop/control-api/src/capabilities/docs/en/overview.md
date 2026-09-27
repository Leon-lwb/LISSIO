# Lissio Software & Core Concepts Overview

Lissio is a data-acquisition and debugging host application (successor of
VOFA+) for embedded development with serial / TCP / UDP / CAN / logic-analyzer
scenarios. Core capabilities: device connection, protocol parsing, waveform
display, interactive control panels, CAN bus analysis, logic decoding.

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

- Graph read/write: get_workspace reads full canvas state; add_node /
  remove_node / update_node_config / connect_nodes / disconnect_edge /
  move_node edit incrementally (equivalent to manual editing: canvas updates
  live and changes enter undo history).
- Devices: list_devices / list_serial_ports, connect_device / disconnect_device,
  send_bytes / send_string / send_can_frame.
- Data reads: get_graph_outputs (latest values of all output ports),
  get_recent_waveform / get_waveform_window, get_can_frames, get_logic_data,
  get_raw_data (raw TX/RX bytes), get_buffer_info, list_data_sources.
- Others: set_input_value drives input widgets; apply_template builds a
  template workspace in one step.

## Example Data Flow

Serial device with a Test Data attribute → Protocol(JustFloat) → Waveform:
connect `device.rx → protocol.in`, then a protocol channel to the display, and
call `connect_device`. The simulated session never opens the real serial port.
