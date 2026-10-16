# Changelog

<!-- lissio-doc
status: maintained
owner: Lissio maintainers
last-reviewed: 2026-10-12
applies-to: Release history for the current Lissio repository
-->

All notable Lissio changes are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and releases use
semantic versioning.

## [0.9.0] - 2026-10-16

### Added

- Added a configuration guide as the first screen of a fresh installation: one card
    with three steps (interface language, color theme, motion and glass) and a live
    preview beside each step, including the looping brand mark on the language step.
    The workbench is not mounted until the guide is confirmed, so the card is what a
    new installation shows first, and each choice applies immediately. An upgrading
    installation keeps its existing settings document and never meets the guide. A new
    `general.showConfigGuide` switch forces the guide on every launch so its appearance
    can be previewed without reinstalling, and the desktop `check_update` response
    reserves a `configGuide` field for a future publishing-side override. The guide
    inherits values the settings document already carries, otherwise preselects English
    for the language and follows the system appearance preference for the theme, and
    labels every value with the source it came from. Confirming records the current app
    version in `general.lastSeenVersion` and saves immediately; that field had no writer
    before this change. No workspace-level configuration layer is introduced.

### Changed

- Removed the `jobs = 2` cap from `.cargo/config.toml`. Cargo has no unlimited
    setting — a negative value is still a cap ("CPUs plus the value") — so omitting
    the key is the only way to let Rust builds use the default, which is the logical
    CPU count and therefore the maximum this machine offers. The `CARGO_BUILD_JOBS`
    cap in the CI workflow and the `RUST_TEST_THREADS` pin are unchanged: the first
    keeps cargo from competing with the browser probes, and the second is a test
    thread limit rather than compile parallelism. Machines with little memory can
    still opt back in per invocation with `cargo -j N` or `CARGO_BUILD_JOBS=N`.

### Fixed

- Keep discovered-device connection methods, device-tree adapters, and child-driver choices readable on Linux/Wayland with app-themed option lists. Give closed native selects an opaque theme surface and CSS arrow. Prevent content-switch flashes by keeping ancestor opacity stable and tying transform completion to the animation engine; retain the active CSS theme until its replacement loads and reuse unchanged stylesheets. Preserve keyboard selection and document native Linux rendering checks and host-specific build commands.
- Reduce Linux deb and AppImage sizes by disabling release debug information and
    stripping symbols from the desktop shell and bundled backend sidecar. Keep full
    symbols available in an opt-in `profiling` Cargo profile for performance analysis.
- The desktop shell no longer refuses to start when the log file cannot be
    created. `tauri-plugin-log` resolves the log directory, creates it, and opens the
    file inside its plugin initialization, so any failure there surfaces as
    `PluginInitialization("log", …)` from `tauri::Builder::build()`: on Windows this
    aborted startup with "拒绝访问。 (os error 5)" before a single window or the server
    sidecar existed, and no log line could record why. The shell now probes the same
    path before registering the plugin — create the directory, reject a directory
    where the log file belongs, and open the file the way the plugin will — and hands
    the plugin an explicit `TargetKind::Folder`. When the conventional directory
    (`%LOCALAPPDATA%\top.pengheng.lissio\logs` on Windows, `~/Library/Logs/<id>` on
    macOS) is not usable, logging continues in `<temp>/lissio-logs` and the reason,
    with both paths, is printed to stderr and written through the logger; if neither
    directory works, the file target is dropped and stdout/webview logging keeps the
    application usable. `lissio-server.log` follows the same resolved directory, so a
    blocked log directory can no longer take the backend sidecar down with it. The
    file name, log directory, and rotation behavior are unchanged when the directory
    is writable.
- Make the MCP port in the AI settings the port the server actually listens on.
    The Desktop sidecar was launched with a hard-coded `--mcp-port 0`, so the local
    MCP server always bound an OS-assigned high port, and `mcp_server_start` returned
    the already-running listener's port without ever looking at the requested one —
    `app.ai.mcpServerPort` was silently ignored on Desktop. `lissio-server` now
    resolves the port as explicit flag > `LISSIO_MCP_PORT` > `settings.json`
    (`app.ai.mcpServerPort`) > `8765`, and an explicit port switches the listener
    (the old listener is closed first). Changing the port in the settings stops and
    rebinds immediately, so the address shown in the UI and the port written in
    external MCP client configurations stay in sync.
    
    A port that cannot be bound turns into a diagnosis instead of a dead app: MCP
    startup failure no longer aborts the Web exit, the failure is recorded as
    `McpServerStatus.conflict` (requested port, bind error, the process holding the
    port, and a free alternative port), and a new read-only `mcp_port_check` command
    reports whether a candidate port is bindable, who holds it, or whether it looks
    reserved by the system (Hyper-V / WSL2 / Docker on Windows). The MCP settings
    page probes the configured port on open and on every change, shows an inline
    conflict banner with "use the suggested port", "retry", and "stop MCP", and a
    deduplicated toast carries the same diagnosis. Holder identification shells out
    to `netstat`/`tasklist` on Windows and `lsof` on Unix, and degrades to "port
    unavailable" when neither is available; the probe itself is advisory, since the
    bind performed by the server remains the authority.
- Restore `pnpm dev:desktop`, which aborted before building anything with "Found
    version mismatched Tauri packages": `src-tauri/Cargo.lock` now resolves `tauri`
    2.12 and `tauri-plugin-opener` 2.7, matching the `@tauri-apps/api` 2.12 and
    `@tauri-apps/plugin-opener` 2.7 already declared in `package.json`. A new
    `pnpm check:tauri-versions` gate compares the Tauri npm packages installed under
    `node_modules` with the crates resolved in `src-tauri/Cargo.lock` and fails on
    any major/minor drift, so this failure class can no longer pass every gate while
    the desktop development command refuses to start.
- Make the Windows acrylic backplate follow the application theme. DWM owns the
    Windows 11 system material, so its light/dark variant tracks the *system* app
    mode and cannot be tinted by the application — with the shipped dark theme and a
    light-mode Windows the backplate turned into a bright plate under semi-transparent
    dark panels. Lissio now tells the native side which polarity the application
    theme uses (`set_window_acrylic` sets the immersive dark mode, so the title bar and
    frame match too), hands the theme's window background to DWM as the material tint
    on the Windows 10 composition-attribute path, and raises the acrylic background
    token alphas when the system material is the opposite polarity of the theme. The
    workspace also moves `window-vibrancy` from 0.6 to the 0.8 line that `tauri`
    already resolves, so one copy is compiled and a failed system backdrop is reported
    and falls back to blur instead of leaving a bare transparent window.
- Use a persistent checkout-local WebView2 profile for `pnpm dev:desktop` on
    Windows, avoiding startup failures caused by an unavailable installed-app
    profile. Development browser data stays in `output/desktop-webview` between
    restarts. An explicit `WEBVIEW2_USER_DATA_FOLDER` still takes precedence, and
    existing application data is preserved.
    
    Fix `pnpm check:ci-gates` falsely reporting generated documentation drift in
    CRLF and mixed-line-ending checkouts. Line endings are normalized before
    surrounding blank lines are removed; command and content changes still fail
    the gate.
- Finish `pnpm build:all` by repairing Low-integrity Windows NSIS/MSI installer
    labels in the existing project bundle directory and verifying unchanged SHA256
    and native integrity SIDs. This prevents NSIS from failing before its welcome
    screen with "Error writing temporary file". No separate export command or
    external output directory is needed. macOS and Linux retain their normal bundle
    outputs and skip the Windows check; checkout-local build temp handling remains.
- Update the locked rustls dependency to 0.23.46, resolving RUSTSEC-2026-0346
    through RUSTSEC-2026-0349 without relaxing dependency audit policy.
    
    Keep the window and node-editor backgrounds on one surface each so translucent
    layers do not repeatedly obscure the native Windows desktop backdrop. Preserve
    acrylic appearance when creating, activating, importing, or editing a theme.
    Windows desktop Acrylic requires the system transparency effects to be enabled;
    its system-controlled solid fallback remains available when effects are disabled.
    
    Exclude generated checkout-local output and temporary test caches from ESLint,
    so running browser tests does not cause later lint checks to fail on compiled
    artifacts.
    
    Remove Tauri's exact empty MSVC library placeholder after generation so Windows
    workspace documentation tests use the real CRT import library, while retaining
    the desktop's static runtime link arguments.

### CI

- Make four checks independent of the platform and of where the checkout is allowed
    to write. `pnpm check:docs` normalizes line endings before hashing `LICENSE`, and
    `pnpm check:ci-gates` reads the runner registration with a CRLF-tolerant fence
    pattern and compares generated gate blocks ignoring line endings, so a Windows
    checkout with `core.autocrlf=true` no longer fails either gate over its line
    endings. `pnpm check:tokens` compares file paths with forward slashes, so the
    `theme.css` and `component-tokens.css` exemptions apply on Windows instead of
    reporting 17 violations inside the exempt files. `pnpm check:contracts` exports
    into `src-tauri/target` instead of the OS temp directory, because the exporter is
    a child process and a confined environment can deny it writes outside the
    checkout while allowing the build tree.
- Make the local quality surface and the build commands run on Windows. The tier
    driver is now `scripts/check-all.mjs` — one implementation for the Linux CI
    checkout and for Windows, where `pnpm check:all` previously failed on the missing
    `bash` — with `scripts/check-all.sh` forwarding to it so the tier commands and the
    workflows stay unchanged. On Windows the driver, and every build or development
    script, first apply `scripts/local-env.mjs`: `TMP`/`TEMP`/`TMPDIR` move to
    `output/local-tmp` inside the checkout, and the stale `msvcrt.lib` stub an older
    `tauri-build` left behind is removed. That fixes MSVC's `cl.exe` D8050, esbuild's
    `Access is denied` during `vite build` — so `pnpm build:all` and `pnpm build:web`
    work again — and the contract exporter's IO failure, all of which are symptoms of
    a confined session denying child processes the OS temp directory.

## [0.8.0] - 2026-10-12

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
  `check:release-sync` fails when the version fields and the changelog
  disagree.
- Unified the duplicated abstractions the cleanup review found. The acquisition
  loops now share one configuration, plan, operation, session, and pump owner;
  point scaling, schema-type checksum/hex/field-type handling, the JustFloat tail
  preset, protocol text and buffer handling, and stream sinks each have a single
  implementation, and `now_us`/`now_ms`/`now_ns`, `RuntimeLimits::from(&PipelineConfig)`,
  and the adaptive sample rate moved to the type owners. The deliberate
  non-unifications (the UDP/candleLight/serial loops, Modbus register reads versus
  S7 byte windows, protocol-specific read/write bodies) are recorded with their
  reasons in `docs/reviews/records/2026-10-11-unification-batches.md`.
- Rust unit tests live in flat `<module>_tests.rs` files next to the module they
  cover instead of in a `tests/` subdirectory, so no crate `src/` carries an
  extra folder. The layout rule and its exemptions (`tests/`, `benches/`) are in
  `docs/architecture/crates.md`.

### Removed

- Repository prose is written in English. Removed the Chinese translation backups
  under `docs/community/`, dropped `language` and `authoritative` from the
  documentation metadata contract, translated the Chinese prose out of `scripts/`,
  `e2e/`, and the build/CI configuration, and `check:release-sync` no longer
  requires a Chinese CHANGELOG backup. Historical review records and product
  localization (`src/i18n/resources/zh/`, runtime capability help `docs/zh/`) are
  unchanged, and the English requirement is a reviewer-confirmed convention rather
  than a gate rule.
- Removed the Parquet export format for recorded data. Parquet was reachable only
  through the DuckDB engine's `COPY … (FORMAT PARQUET)`, and DuckDB is being
  replaced, so the export dialog now offers CSV and JSON only. A request that still
  asks for `format: "parquet"` is rejected as an invalid export request.
- Removed the dead Rust surfaces the cleanup review identified: the legacy
  `src-tauri/src/commands/` command layer with its `event_sink` and `gui_host`
  shims, the `runtime` crate under `data/`, the `graph` trait/prelude facade,
  `buffer_graph`'s unreachable `NodeGraph`/`RoutedData` types with their tests and
  benchmark, the `pipeline::runtime` facade, and the `wgpu`/`Envelope`,
  `serialport`, and `device_tree::model` re-export shims. The Rust toolbox handle
  is now the `Arc<AppState>` alias it always was.

### Fixed

- Fixed the I2C START/STOP event rendering, which threw a `TypeError` because the
  hand-written wire type declared `{ Start: null }` while Rust serializes those
  unit variants as the strings `"Start"`/`"Stop"`; the frontend now consumes the
  generated logic types. Frequency and byte values render consistently across the
  spectrum chart, measurement grid, FFT readout, recording views, performance
  monitor, and status bar instead of the three frequency and two byte formats that
  had drifted apart, and clipboard copies fall back to `execCommand` outside a
  secure context.
- Fixed onboarding reopening after dismissal or version changes. Ending or completing the tour persists the disabled preference; Help still supports manual replay. Desktop and Web settings now use the connected backend, serialize acknowledged writes, and offer retries for read or save failures without overwriting unread configuration. Open onboarding also keeps later startup dialogs queued.
  
  Bound default validation concurrency to one Vitest worker, one Playwright worker, two Cargo build jobs, and one Rust test thread to reduce peak memory use.
  
  Keep the performance-monitor entry disabled until workspace restoration finishes so an early click cannot be overwritten by the restored tab list.
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
