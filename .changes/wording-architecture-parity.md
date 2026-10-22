---
"lissio": patch:changed
---

Product wording now matches the architecture it describes, in both languages.
The positioning is one phrase — a data-acquisition and debugging host for
embedded, automotive, and industrial work — and the sentence that explains why
Desktop and Web behave identically is stated wherever a reader first meets the
product: `lissio-server` owns transport I/O, protocol decoding, the node-graph
runtime, DSP, CAN and automotive diagnostics, and recording, and HTTP-RPC with
WebSocket streams, the MCP server, the CLI subcommands, and the supervised Tauri
sidecar are four exits of that one core.

Counts left the prose: `check:model-catalog` and `check:web-contract` already
enforce how many widget kinds, drivers, and commands exist, so the READMEs, the
capability help, and the built-in AI prompt name capabilities and real
identifiers instead. The node vocabulary is the `NodeKind` set the contract
defines, and `Fft` is documented as a value-plane node whose spectrum blocks come
from a 30 FPS ticker. The capability help's device table lists the adapter ids
drivers register, each with the fields its own schema declares, plus the
`can-channel` → `isotp` → `diagnostic` stack.

Shipped copy carried three claims the code contradicts: the custom-widget notice
and the preview-bandwidth setting said "IPC" while the UI reaches the backend
over HTTP-RPC and a WebSocket binary stream; the help topic and the empty-canvas
hint named palette groups that are not in the palette; and `index.html` described
the product in Chinese inside `<html lang="en">`. Each now describes the real
mechanism — inputs following the preview stream into the iframe, an output
submitted through `submit_custom_output` back into the graph, the categories a
user can open, and the English positioning phrase.

Files: README.md, README.zh-CN.md, ROADMAP.md, docs/README.md,
docs/governance/branch-lifecycle.md, docs/reviews/README.md,
docs/reviews/records/2026-10-22-wording-architecture-parity.md, .changes/,
client/index.html, client/src/i18n/resources,
server/crates/desktop/control-api/src/capabilities/docs,
server/crates/desktop/ai-host/default-system-prompt.md, server/physical/README.md,
server/data/README.md
