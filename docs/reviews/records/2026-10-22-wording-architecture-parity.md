# Wording and architecture parity review

<!-- lissio-review
date: 2026-10-22
scope: Product wording across the READMEs, umbrella living docs, shipped client i18n copy, server capability help, and the built-in AI system prompt, re-read against the current architecture
reviewer: implementation agent; maintainer sign-off pending
verdict: passed-with-conditions
-->

## Scope

Reviewed the sentences a reader meets first and the copy shipped to users, and
checked each claim against the code that owns it:

- umbrella — `README.md`, `README.zh-CN.md`, `ROADMAP.md`,
  `docs/ci.md`, `docs/README.md`, and
  `docs/governance/branch-lifecycle.md`;
- `client` — `index.html` and the shipped product copy in
  `src/i18n/resources/{en,zh}/onboarding.yml`, `layout.yml`,
  `custom-widgets.yml`, and `settings.yml`;
- `server` — the capability help in
  `crates/desktop/control-api/src/capabilities/docs/{en,zh}/` and
  `crates/desktop/ai-host/default-system-prompt.md`;
- `server/physical` and `server/data` — their `README.md` self-descriptions.

The positioning is now one phrase in both languages: a *data-acquisition and
debugging host* / 「数据采集与调试主机」 for embedded, automotive, and industrial
work, delivered as one capability core with four software exits.

## Findings

- **Capability counts are gone from prose.** A README, a help topic, and a
  settings tooltip each re-stated how many templates, palette groups, or model
  providers exist. Every one of those numbers is enforced elsewhere —
  `check:model-catalog` for widget-kind coverage, `check:web-contract` for the
  command surface, the composed-catalog tests for descriptor content — so the
  prose now names the capability and the real identifiers instead of a count
  that drifts the moment a driver lands.
- **The exits are the missing sentence.** Each repository described its own
  surface, so nothing said why Desktop and Web behave identically. The READMEs,
  the capability overview, and the AI prompt now state that `lissio-server`
  owns transport I/O, protocol decoding, the node-graph runtime, DSP, CAN and
  automotive diagnostics, and recording, and that HTTP-RPC with WebSocket
  streams, the MCP server, the CLI subcommands, and the supervised Tauri sidecar
  are four exits of that one core.
- **Node vocabulary came from `kind.rs`, not from memory.** The editor sections
  list the `NodeKind` set the contract defines (`Acquisition`, `PointSelector`,
  `Protocol`, `ProtocolSource`, `Input`, `Math`, `Str`, `Custom`, `Filter`,
  `Fft`, `Ifft`, `FrameDecoder`, `Sink`, `Trigger`, `TextInput`, `TextOut`,
  `TextDisplay`), and the graph pipeline is described through the `graph` facade
  over `kind`/`hir`/`plane`/`lower`/`eval`. `Fft` is documented as a value-plane
  node that publishes nothing: the spectrum blocks come from a 30 FPS ticker into
  `spectrum_snapshot`, which is what a Spectrum display reads.
- **Two claims written during the pass were wrong and were re-derived from code.**
  A first draft said the `Fft` node "has no output port" — `FFT_PORTS` does
  expose a `spectrum` port — and the performance-monitor bullet listed stage
  throughput and dropped-frame counters. `client/src/types/performance.ts`
  defines what the monitor actually reports: FPS, average and P95 frame time,
  long tasks, JS heap usage, and monitor RPC latency. Both sentences were
  rewritten from the source rather than softened.
- **Driver tables now list the ids and fields the drivers declare.** The
  capability help's device table carried adapter ids that no driver registers and
  config keys no `TransportConfig` variant has. It lists `serial`, `udp`,
  `tcp-client`, `tcp-server`, `slcan`, `candle-light`, `test-data`, `simulation`,
  `can-channel`, `isotp`, `diagnostic`, `modbus-tcp`, `modbus-rtu`, and `s7`, and
  each row names fields read from the driver's own schema. The two CAN-adjacent
  rows document the `can-channel` → `isotp` → `diagnostic` stack that
  `libautomotive` drives, which the previous row ordering left implicit.
- **Client copy contradicted the transport the client uses.** `custom-widgets.yml`
  and `settings.yml` both said "IPC". The UI reaches the backend over HTTP-RPC
  and a WebSocket binary stream; Tauri IPC is reserved for the platform shell.
  The custom-widget notice now describes the real round trip (inputs follow the
  preview stream into the frame by `postMessage`, an output is submitted with
  `submit_custom_output` and re-enters the graph as a node output), and the
  preview-bandwidth description names what the field is: a backpressure budget
  the frontend reports against, which makes the backend widen the push interval
  rather than drop data.
- **Palette copy pointed at groups that are not in the palette.** The help topic
  and the "no transport node" hint named `Inputs / Data Interfaces / Protocol
  Engine / …`; the categories a user can actually open are `Connections`,
  `Parsing & encoding`, `Sending`, `Signal processing`, `Text processing`,
  `Display`, `Interactive inputs`, `Attributes`, and `Custom`. The CAN and logic
  hint bars now tell the user to open the category that `openCategory('protocol')`
  opens, in both languages.
- **`index.html` described the product in one language inside `<html lang="en">`.**
  The meta description is now the English positioning phrase.
- **`branch-lifecycle.md` counted wrong.** It said "five repositories" and then
  enumerated six checkouts. The document now says the umbrella plus the five it
  composes, matching `docs/ci.md`, which was already correct.

## Follow-ups

- The repository count in `AGENTS.md` and `docs/AGENTS.md` uses "five" for the
  five composed submodules while the umbrella itself is a sixth checkout. Both
  files read correctly in context and are agent instruction files, so they were
  left for a maintainer decision rather than edited here.
- Guidance prose is Rust-owned: `client/src/i18n/__tests__/guidanceResources.test.ts`
  pins the generated `guidance_*` strings verbatim, so a change to that copy has
  to start in the catalog, not in the YAML. This pass touched only keys the test
  does not pin.
- Some Rust doc comments still name things the code does not have — a
  `ChannelSource` in `crates/desktop/pipeline/src/eval_state.rs`, an `engine`
  crate in `core/crates/shared/error/src/lib.rs` and
  `data/crates/graph/hir/src/errors.rs`, and a "no output port" line in
  `graph/kind/src/kind.rs` and `graph/plane/src/plane.rs` that means "no
  value-plane output". These are source comments, outside the reviewed surface.
- The zh capability help and zh i18n stay translations of the English files; a
  future wording change must move both, and the translation-metadata check in
  `check:docs` is what catches a declaration that was left behind.
