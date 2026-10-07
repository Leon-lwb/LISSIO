---
"lissio": patch:fixed
---

Fixed the sidebar palette clipping the top of Chinese glyphs (`右截取` / `插入` / `删除`) when the UI font has tight vertical metrics: with `leading-none` the truncated label's line box was exactly 1em, while most CJK fonts report an ascent+descent larger than that, so the row's clip line cut into the glyph ink. Palette rows now reserve line-box room (`leading-normal`), which is font-metric independent.

Fixed Quick Start templates generating the removed legacy Waveform window and losing the pinned Compile Errors / Compile Results tabs. A template snapshot replaces `dataTabs` wholesale, but the snapshots still carried the 0.4.x fixed `waveform-fixed` tab — a Waveform window with no host widget, so it appeared after applying a template and never showed data — while omitting the fixed shell tabs the default landing tab (`compile-results-fixed`) points at. Templates now emit the current fixed shell tabs, and the two remaining `waveform-fixed` fallbacks in the tab store point at `compile-results-fixed`.

Fixed the Gauge widget deforming when its node was resized: the canvas CSS box tracked the widget while its bitmap was only rebuilt on value/range changes, so the stale bitmap was stretched into an ellipse (and the radius stayed at its fixed 67.5). The bitmap now follows the widget box, and the semicircle is drawn from a single radius that scales with the box's shorter side, with proportional ticks/line widths/font, capped at 120px so a large widget no longer grows it without bound. A forced aspect ratio only adds centered padding.

Fixed the protocol-engine card being invisible on the canvas after Quick Start. The card is a projection of the device-tree child, so React Flow never got a measured height for it (`nodeHasDimensions` stayed false) and left it at `visibility: hidden`; the card's measured size is now remembered and fed back into the projection. Template widgets also start to the right of the projected card instead of under it, so the protocol engine and its edges are visible next to the device.

Added a "Text Protocol" Quick Start template that demonstrates the Protocol Engine's protocol conversion (`convert_to`): ASCII text (FireWater) is parsed and re-encoded as numeric JustFloat frames, feeding number displays and a waveform. Every other frame-producing template now also carries an explicit `convert_to` target (CAN keeps "no conversion", since SLCAN frames are not numeric samples).
