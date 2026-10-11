---
"lissio": patch:fixed
---

Fixed the I2C START/STOP event rendering, which threw a `TypeError` because the
hand-written wire type declared `{ Start: null }` while Rust serializes those
unit variants as the strings `"Start"`/`"Stop"`; the frontend now consumes the
generated logic types. Frequency and byte values render consistently across the
spectrum chart, measurement grid, FFT readout, recording views, performance
monitor, and status bar instead of the three frequency and two byte formats that
had drifted apart, and clipboard copies fall back to `execCommand` outside a
secure context.
