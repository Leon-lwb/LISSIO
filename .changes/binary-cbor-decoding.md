---
"lissio": minor:added
---

Added a binary payload decoder to the frame schema, starting with CBOR: a
protocol frame can now end with `binary` decode blocks that turn structured
binary data into waveform channels.

- A `binary` block (format + field paths) joins the existing header/length/id/
  field/bitfield/checksum/tail blocks, so it runs inside the same streaming
  frame parser and reuses the existing frame delimiting. With `lengthRef` the
  block reads the payload length from a length block; without it the block
  parses one self-delimiting CBOR item, which also supports headerless streams
  of consecutive items.
- Fields are selected by dotted paths (`imu.temperature`, `samples[2].x`,
  `1.value`, `[0]`), including integer map keys, array indices, and CBOR tags
  that wrap a value. Numbers and booleans become channel values (true/false as
  1/0); strings, byte strings, nulls and containers produce no channel. A path
  that is missing in a frame keeps its port at 0.0 instead of desynchronising
  the frame, and ports are derived in block order, so the waveform channel
  layout is stable across frames.
- The protocol schema editor can add and edit the block: a format selector, the
  field list (path and optional port name), and the length reference, with the
  derived ports shown next to the block list.
- CBOR decoding is the first arm of an explicit format enum with a shared field
  extraction rule; Protobuf and SBE will add formats without changing the block,
  the path syntax, or the port derivation.
