---
"lissio": minor:changed
---

Frame-block semantics now live in one crate. `protocol/block-codec` holds the
only parser, encoder, port rule, and validator for each decoder block kind;
`SchemaEngine` and the `FrameDecoder` state machine both call
`block_codec::parse_frame`, the physical test-data and simulation paths call
`block_codec::encode_frame`, and the `graph_ops` simulation encoding uses
`block_codec::encode_plan`.

Parsing answers in three states instead of an option, so a `Tail` mismatch, an
illegal ASCII field, or an inverted checksum cover makes the reader drop past
the matched header and resynchronize, while a short frame waits for more bytes.
`FrameParser` used to treat every failure as "wait", which let a falsely
synchronized header hold the buffer.

`schema_types` keeps the wire types and the protocol registry only:
`encode_by_blocks`, `ProtocolSchema::port_names`, `ProtocolConfig::port_names`,
and `preset::protocol_port_names` are gone, and `block_codec` owns those
functions. `block_codec::validate` rejects structurally impossible block lists
(a bit length outside 1..=32 shifts over, a variable-length `Length` block can
never bound a frame) and the `FrameDecoder` widget lowering reports the
offending block.

CBOR payload decoding moved from `lissio-schema` to `lissio-block-codec` with
the `Binary` block; the reviewed lower-layer dependency baseline was regenerated
and the dependency count is unchanged.
