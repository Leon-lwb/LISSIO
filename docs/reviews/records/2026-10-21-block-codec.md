# Block codec review

<!-- lissio-review
date: 2026-10-21
scope: Implementation of the block-handler workstream: one parser, encoder, port rule, and validator per decoder block kind in a new L1 crate
reviewer: implementation agent; maintainer sign-off pending
verdict: passed-with-conditions
-->

## Scope

Reviewed the block-handler workstream (W4) of the device and protocol
abstraction survey
([`2026-10-20-device-protocol-abstraction.md`](2026-10-20-device-protocol-abstraction.md)),
landed across `server/core`, `server/physical`, `server/data`, and `server`:

- the new L1 crate `protocol/block-codec`: `parse_frame`, the encode faces
  (`encode_frame`, `encode_blocks`, `encode_plan`), port derivation, and block
  validation;
- `schema`: `SchemaEngine` reduced to frame delimiting plus buffering, the
  `binary` and `bitfield` modules moved out, and `protocol_impl` rewired;
- `schema_types`: `encode_by_blocks`, `ProtocolSchema::port_names`,
  `ProtocolConfig::port_names`, and `preset::protocol_port_names` deleted, so
  the crate is wire types and the registry again;
- `frame-decoder`: `blocks.rs` deleted, the state machine rewired onto
  `block_codec::parse_frame`, and `FrameDecoderTestData` reduced to an adapter;
- `physical`: the test-data and byte-simulation encoders onto `encode_frame`;
- `data`: the `FrameDecoder` widget lowering calls `block_codec::validate`;
- `server`: the `graph_ops` simulation projection onto `encode_plan` and the
  port-derivation call sites onto `block_codec::port_names`;
- the change file `.changes/block-codec.md`.

## Findings

- **The duplication was real, and it had drifted.** `SchemaEngine::try_parse`
  and `FrameParser::try_parse_frame_from` decoded the same `DecoderBlockDef`
  list with different answers for five inputs: a `Tail` mismatch was a frame
  boundary error in one and "wait for more bytes" in the other; a `Bytes`-typed
  `Length` block was invalid versus pending; a failed fixed-width decode was
  invalid versus pending; `Csv`/`AsciiField`/`Binary` were parsed by one and
  silently skipped by the other. `block_codec` now answers once, and the
  `SchemaEngine` answer won on every disagreement because it is the one the
  deployed protocol path uses.
- **A tail mismatch no longer stalls a buffer.** With `Invalid` distinct from
  `Incomplete`, `FrameParser::feed` drops past the matched header and searches
  again, matching what `SchemaEngine` already did; the previous behaviour let a
  falsely synchronized header hold the buffer forever. `test_parse_tail_mismatch_
  returns_none` still holds for the one-shot preview API, which has no stream to
  resynchronize; the new `test_feed_resyncs_after_tail_mismatch` pins the state
  machine.
- **One encoder per block kind, not three encoders per vocabulary.** The three
  former encoders were `schema_types::encode_by_blocks` (encode blocks),
  `FrameDecoderTestData::encode_frame_inner` (decode blocks, two-pass checksum),
  and `graph_ops::simulation::frame_decoder_encoding` (a strict decode-to-encode
  projection). They now live in one crate; the two block vocabularies keep their
  own entry point because they carry different data (`TypedConst` has no decoder
  counterpart; `Bitfield` and `Bytes` have no encoder counterpart), but no block
  kind is written twice. `FrameDecoderTestData` survives as a 60-line adapter so
  the frame decoder's tests and benchmark keep their call shape.
- **Port derivation is one function plus one data accessor.**
  `block_codec::port_names` owns the multi-port aggregation (`Csv` columns,
  `Binary` fields, dedup in block order) and
  `block_codec::protocol_port_names` owns the `PortKind` dispatch; the per-block
  single-port name stays `DecoderBlockDef::output_port_name` because it is a
  fact about the block, and `ProtocolConfig` lives in `schema_types` where it
  cannot depend on the codec. Three duplicates of the derivation are gone.
- **Validation found a panic, not a style problem.** Bitfields with
  `bit_length` outside `1..=32` shift-overflow in `read_bitfield`, and a
  `Bytes`-typed `Length` block can never bound a frame. `block_codec::validate`
  reports those plus duplicate block ids, dangling `length_ref`s, invalid HEX,
  inverted checksum ranges, empty CSV separators, and zero-width ASCII fields;
  it is wired into the `FrameDecoder` widget lowering, so such a graph now fails
  to compile with the offending block named. Tolerable states (an unconnected
  port, a half-typed block row) are deliberately not reported.
- **The layer boundary forced one asymmetry.** `block_codec` depends on
  `schema_types`, so `schema_types` cannot call back into it; anything that needs
  both a block list and a `ProtocolConfig` therefore lives in `block_codec`
  (`protocol_port_names`), and `ProtocolConfig::port_names` was deleted rather
  than kept as a second rule. This is why the crate exists at all: `schema` and
  `frame-decoder` are both L1 protocol crates that must not depend on each other.
- **CBOR decoding moved down with the Binary block.** `ciborium` left
  `lissio-schema` and joined `lissio-block-codec`; the reviewed lower-layer
  baseline was regenerated deliberately, and the dependency count is unchanged.

## Follow-ups

- **Encode-block checksums and decoder-block checksums disagree on the header.**
  `EncodeBlockDef::Checksum` covers every prior byte, while
  `DecoderBlockDef::Checksum` with `AllPrior` starts after the frame header. A
  simulated `FrameDecoder` with a header and an appended checksum therefore
  produces a checksum the protocol engine rejects — pre-existing, now pinned by
  `projected_checksum_covers_the_header_unlike_the_decoder_block_rule` rather
  than silently inherited. Reconciling it means deciding whether the encode-block
  contract or the decoder-block contract changes; it belongs with the simulation
  encoding workstream, not this one.
- **`Prepend` checksum placement is ill-defined on both sides.** The parser reads
  the checksum at the frame-start offset without advancing the cursor, so it
  overlaps the first field; the encoder reproduces that by writing over those
  bytes. Neither side has a test, and the behaviour is preserved rather than
  invented. A follow-up should either give `Prepend` its own reserved bytes or
  remove the position.
- **`BlockIssue` is Rust-only.** Field paths reach the user through the graph
  compile error, not a structured issue list; the wire-side `ModelIssue` and the
  preview RPC belong to the validation and preview workstream.
- **Command-frame DTOs still duplicate the encode vocabulary.** `BlockDto` and
  `EncodeBlockDef` describe the same four command blocks, and
  `compute_frame_bytes` re-walks them with range-validated packing. Out of scope
  here; recorded in the cleanup register.

## Verification

Each of the four Cargo workspaces ran `cargo fmt --check`, `cargo clippy
--workspace --all-targets`, and `cargo test --workspace`; the umbrella ran
`check:architecture` (with the deliberate baseline regeneration), `check:deps`,
`check:contracts`, `check:rust-size`, and `check:docs`. No wire type changed, so
the generated TypeScript is unchanged.
