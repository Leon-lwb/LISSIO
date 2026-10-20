---
"lissio": patch:fixed
---

Fixed the waveform panel's channel identity: a curve fed from a protocol-engine
channel whose index differs from the waveform widget's own input port is now
controlled by that port.

The waveform widget exposes one input port per configured channel (`CH0..CHn`)
and its property panel is indexed by those ports, but the panel derived each
curve's configuration index, label and colour from the edge's source handle
(`ch{n}`, the protocol engine's channel index). A curve connected to `CH1` from
engine channel `ch8` therefore read `channels[8]` — out of range, falling back to
`show: true` — so its visibility, coupling and V/div controls did nothing and it
could not be switched off, while engine channels that happened to equal the port
index only worked by coincidence. Configuration, labels, colours, the horizontal
cursor readout, the thumbnail and the measurement readout now follow the widget
port, while data fetch and detail selection still follow the engine channel
index. Derived series follow the port they enter as well. An edge whose target
handle is missing or does not name a port takes the next free port slot instead
of escaping every control.

AutoSet follows the same mapping: it now fits exactly the connected engine
channels and writes each fit back to the port slot that channel feeds (previously
the fits were written positionally, so a curve fed from engine channel `ch8` on
port `CH1` received engine channel `ch1`'s V/div once configuration became
port-indexed). A suggestion that cannot be attributed to a requested channel is
not written back at all, because a wrong V/div is worse than keeping the current
one; the time base, position and run state still apply.

The graph compiler now owns the port contract: a connection naming an input port
the target widget does not declare is rejected instead of passing through the
dynamic-port fallback, and the default input handle is resolved against the
widget's real port table — a default connection to a Waveform targets `CH0`, not
the non-existent `value`. The reported `ch8 -> CH1` case, both out-of-range and
coincident indices, is covered by regression tests.
