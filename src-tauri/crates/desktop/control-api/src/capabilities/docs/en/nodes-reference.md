# Node & Widget Type Reference

<!-- lissio-doc
status: maintained
owner: Lissio maintainers
last-reviewed: 2026-10-07
language: en
authoritative: true
applies-to: Runtime English capability help: nodes-reference.md
-->
## Device nodes (per tab, capability-driven)

| adapter id | key configuration |
|---|---|
| Serial | port_name (query via list_serial_ports first), baud_rate, data_bits, parity, stop_bits, flow_control |
| Udp | local_addr/local_port (local), remote_addr/remote_port (peer) |
| TcpClient | host, port |
| TcpServer | listen_addr, listen_port |
| Slcan | serial params + can_bitrate (lawicel adapter) |
| CandleLight | bus, address, can_bitrate, channel (canable etc. USB-CAN) |
| modbus-tcp / modbus-rtu | endpoint plus typed point definitions, polling and reconnect settings |

Use `list_devices` for open sessions. Test Data is a unique attribute attached
to a device; it retains the real configuration and ports and never opens the
real hardware while active.

## Parser and encoder nodes (per tab)

| kind | notes |
|---|---|
| JustFloat | binary float frame: N×f32 (little-endian) + tail 00 00 80 7F; channels: null = auto-detect |
| FireWater | ASCII frame: "1.23,4.56\n" comma-separated floats + newline |
| RawData | raw byte passthrough (no float parsing), consumed by RawData widget |
| Slcan / CandleLight | protocol layer for CAN transports (encode_can encodes CAN frames) |
| LogicDecode | logic-analyzer decoding protocol (decoder config for UART/I2C/SPI) |

Node id pattern: `protocol-XXXXXXXX`. Protocols support convertTo (secondary
conversion) and custom frame schema.

## Point selection

Point devices output one `points` stream. Point Selector accepts exactly one
point source and creates named numeric outputs from selected stable point IDs.
Bool maps to 0/1; bad quality and overflow are not emitted as valid numbers.

## Widgets (per tab)

- **Input**: Knob / Slider (`min/max/step/value`), Button (`pressValue/releaseValue`),
  Radio (`options: [{id,label,value}], selectedId`), Checkbox
  (`options: [{id,label,value}], selectedIds`; output is the sum of selected values),
  TextInput (send text). Numeric inputs keep one `value` output and changes apply via
  set_input_value immediately. Direct bindings select a Transport explicitly; Auto bindings
  also select the Protocol and channel.
- **Display**: Waveform, Gauge, NumberDisplay, LED (threshold color), PieChart,
  Image (rgb888 frames), Label, Spectrum, Model3D (trajectory/attitude),
  TableView, TextDisplay, RawData.
- **Compute**: Math (add/sub/mul/div/pow/mod/min/max/abs/sin/cos/tan/log/sqrt...,
  configurable inputCount), Filter (Lowpass/Highpass/Bandpass/Bandstop), FFT,
  IFFT, Str (string ops), FrameDecoder (custom frame blocks: header/field/
  checksum/tail; named fields become output ports), Trigger (rule matching:
  pattern → value/text), Command (frame builder: const/var-ref/checksum blocks),
  TextOut (send graph strings back to a Transport), Custom (JS widget).

Widget node id pattern: `widget-XXXXXXXX` (widget params.id equals node id).

## Wiring Rules

### Port domains — only same-domain ports may connect

Every port has a fixed domain; cross-domain wiring is rejected outright by the
backend compiler (the error names both ports and their domains):

| Domain | Typical ports |
|---|---|
| points | Device.points → PointSelector.points |
| bytes | Device.rx / Device.tx, Protocol.in / Protocol.out, FrameDecoder.in, Command.loopbackOut |
| f32 | PointSelector named outputs, protocol ch0..chN, Math.result, Filter.result, IFFT.out0, input and display ports |
| freq | FFT.spectrum (output) → only IFFT.spectrum / Spectrum.spectrum inputs |
| string | RawData-preset protocol str, TextInput.str, Trigger.text, Str string ports, TextDisplay.text, TextOut.text |

Typical chains: Device.rx(bytes) → Protocol.in; Device.points → PointSelector;
numeric outputs → Waveform/Gauge/Math; FFT.spectrum(freq) → IFFT or Spectrum; str(string) →
TextDisplay / Str / TextOut.

### Other rules

- RawData widget input ports are dynamically derived (`src:<source>:<handle>`);
  targetHandle is rewritten automatically on connect. RawData accepts bytes and
  time sources; only freq is rejected.
- Every connection stays inside one tab; cross-tab edges are rejected.
- Before wiring, the built-in AI should inspect `derived_ports`, returned
  separately by get_workspace, for actual **output** port names and domains;
  use node type and config for inputs. External MCP clients do not have this
  frontend-hosted read tool.
- Wires are compile-checked by the backend: domain mismatch / cycles /
  non-existent ports fail with the real reason and no edge is created — fix
  the port or config per the message and retry.
- The built-in AI can use add_node for nodes and connect_edge for wires.
  update_graph replaces a whole tab and requires its complete documents and
  edges; never submit a partial list as a whole-tab update.