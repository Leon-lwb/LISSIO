# Changelog

<!-- lissio-doc
status: maintained
owner: Lissio maintainers
last-reviewed: 2026-10-08
applies-to: Release history for the current Lissio repository
-->

All notable Lissio changes are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and releases use
semantic versioning.

## [0.8.0] - 2026-10-08

### Added

- Added a "Text Protocol" Quick Start template that demonstrates the Protocol
  Engine's protocol conversion (`convert_to`): ASCII text (FireWater) is parsed
  and re-encoded as numeric JustFloat frames, feeding number displays and a
  waveform. Every other frame-producing template now also carries an explicit
  `convert_to` target (CAN keeps "no conversion", since SLCAN frames are not
  numeric samples).

### Changed

- Releases are now prepared from change files instead of a hand-picked version.
  Contributors record each change in `.changes/`, and `pnpm release:prepare`
  derives the next version, generates the `CHANGELOG.md` entry, and synchronizes
  every version file. Two new PR-tier gates keep that state honest:
  `check:changes` rejects change files that covector would silently drop, and
  `check:release-sync` fails when the version fields, the changelog, and its
  Chinese backup disagree.

### Fixed

- Fixed the sidebar palette clipping the top of Chinese glyphs (`右截取` /
  `插入` / `删除`) when the UI font has tight vertical metrics: with
  `leading-none` the truncated label's line box was exactly 1em, while most CJK
  fonts report an ascent+descent larger than that, so the row's clip line cut
  into the glyph ink. Palette rows now reserve line-box room (`leading-normal`),
  which is font-metric independent.
- Fixed Quick Start templates generating the removed legacy Waveform window and
  losing the pinned Compile Errors / Compile Results tabs. A template snapshot
  replaces `dataTabs` wholesale, but the snapshots still carried the 0.4.x fixed
  `waveform-fixed` tab — a Waveform window with no host widget, so it appeared
  after applying a template and never showed data — while omitting the fixed
  shell tabs the default landing tab (`compile-results-fixed`) points at.
  Templates now emit the current fixed shell tabs, and the two remaining
  `waveform-fixed` fallbacks in the tab store point at `compile-results-fixed`.
- Fixed the Gauge widget deforming when its node was resized: the canvas CSS box
  tracked the widget while its bitmap was only rebuilt on value/range changes,
  so the stale bitmap was stretched into an ellipse (and the radius stayed at
  its fixed 67.5). The bitmap now follows the widget box, and the semicircle is
  drawn from a single radius that scales with the box's shorter side, with
  proportional ticks/line widths/font, capped at 120px so a large widget no
  longer grows it without bound. A forced aspect ratio only adds centered
  padding.
- Fixed the protocol-engine card being invisible on the canvas after Quick
  Start. The card is a projection of the device-tree child, so React Flow never
  got a measured height for it (`nodeHasDimensions` stayed false) and left it at
  `visibility: hidden`; the card's measured size is now remembered and fed back
  into the projection. Template widgets also start to the right of the projected
  card instead of under it, so the protocol engine and its edges are visible
  next to the device.

## [0.7.2] - 2026-10-01 (pre-release)

### Changed

- Disabled the recording database by default. A fresh install or a settings
  reset opens no DuckDB connection until recording is enabled in
  Settings → Data → Recording database; persisted `true` values keep recording
  on.
- Separated workspace pause and stop semantics. Pause keeps connections,
  acquisition, parsing, caches, graph evaluation, and recording active while
  disabling automatic sends and device writes. Stop is a hard gate that drops
  in-flight data while preserving existing caches.
- Split execution tickets into an ingestion ticket and a send ticket so data
  routing and device output have independent state transitions.
- Unified live-panel liveness through `displayLiveness`. A panel is live only
  while the workspace runs and the panel follows the latest data.
- Added a consistent jump-to-latest behavior after pause recovery and a visible
  non-live state on frozen panels.
- Replaced duplicated MCP, built-in AI, and skill declarations with a runtime
  capability-node registry. Tool schemas, routing, dispatch, skill discovery,
  and prompt indexes now derive from one registry.
- Removed legacy persisted-data and wire-format compatibility. Current files,
  IPC payloads, and configuration are read and written only in the current
  format.
- Standardized tool names, optional parameter defaults, and CAN identifier
  handling.

### Added

- Completed the Web command surface and isolated host-only capabilities behind
  platform shims.
- Added graph HIR and frame-decoder parsing exports through the shared control
  API.
- Added dynamic skill listing and shared tool execution errors.
- Added recording, stop-snapshot, CSV export, command-frame, and buffer-control
  capabilities to headless and MCP workflows.
- Added transport discovery, acquisition, waveform, CAN, logic, recording, and
  knowledge capability documentation in English and Chinese.

### Fixed

- Prevented list-panel scrolling from pausing the workspace unless the user
  actively scrolls upward.
- Fixed recovery synchronization in headless server and CLI startup.
- Fixed long-running soak benchmark lifetime and drop-accounting behavior.
- Fixed benchmark auditing after crate renames and pipeline status handling.

### CI

- Added benchmark audit, full-run, collection, and comparison commands.

## [0.6.1] - 2026-09-09 (pre-release)

### Added

- Enriched serial discovery with platform-specific USB and device metadata.
- Added an acquisition-device panel and discoverable endpoint selection.
- Added a one-click default Serial → JustFloat → RawData canvas.
- Reorganized the widget palette into connection, processing, display, and
  extension categories.
- Added bilingual schema field labels.

### Fixed

- Made startup seeding asynchronous-safe so it cannot duplicate nodes or
  overwrite a restored workspace.

### CI

- Added cross-platform serial-discovery contract tests.
- Allowed release validation to accept a build head that descends from the
  release commit.

## [0.6.0] - 2026-09-09 (pre-release)

### Added

- Added a high-rate waveform pipeline with per-sample clocking, stop snapshots,
  overload handling, and stable high-rate visualization.
- Added waveform measurements, backend pyramid statistics, period detection,
  AutoSet, and measurement panels.
- Added resizable widgets, configurable ranges and ticks, string-domain RawData
  views, Modbus TCP/RTU acquisition, unified recording/history, and string
  nodes.

### Architecture and performance

- Reworked the data plane around a sampling-clock authority, decoupled
  recording and evaluation, pyramid layers, and deduplicated routing.
- Added SIMD graph evaluation, chunked fork-join execution, resident workers,
  partitioned value planes, and a WebGPU envelope prototype.
- Reorganized crates by domain and layer and added architecture, dependency,
  500-line module, and Rust CI gates.
- Consolidated transport backends and frontend widget accounting.

### Fixed

- Fixed blank startup windows, high-rate ingestion distortion, AutoSet window
  behavior, and dock canvas layout ownership.

### CI

- Reworked release builds, synchronized frontend and backend versions, moved
  Linux builds to Ubuntu 26.04, and removed invalid packaging targets.

### Branding

- Refreshed the splash screen and Lissio visual identity.
