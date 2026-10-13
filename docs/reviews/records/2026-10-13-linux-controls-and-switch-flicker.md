# Linux controls and content-switch rendering review

<!-- lissio-review
date: 2026-10-13
scope: Discovered-device connection methods, native select surfaces, content-switch completion, and CSS theme lifetime
reviewer: Codex automated review
verdict: passed-with-conditions
-->

## Scope

Follow-up to [the device-tree review](2026-10-13-linux-device-select.md).
The reporter's `dev:desktop` screenshot identifies the discovered-device card
in `DevicePanel`, which the earlier device-tree-only change did not cover.
The additional report concerns whole-surface flashing at the end of tab and
other content transitions.

## Findings

- Device cards now use the shared `Select` for connection methods. A component
  regression verifies that selecting Serial changes the adapter passed to
  node creation while retaining the discovered port's configuration patch.
  Device-tree and child-driver selectors retain their previously tested path.
- Closed native selects use CSS appearance and an opaque theme input surface;
  acrylic input transparency no longer exposes a light GTK bezel. The derived
  surface follows live `bgInput` edits without changing persisted settings.
  Expanded native lists outside the device selectors remain GTK-owned.
- `AnimatedSwitch` previously wrote ancestor opacity, forced layout, and used
  a duration timer to remove transition styles. Fractional opacity changes
  the Backdrop Root used by frosted descendants. The replacement effect uses
  transform-only Web Animations before paint, cancels on interruption or
  reduced motion, and uses engine completion without inline-style cleanup.
  The view retains its subtree and the existing travel/timing sources.
- CSS theme application previously removed the active stylesheet before
  appending another link, including repeated requests for the same theme.
  The loader now reuses identical requests and retains the active sheet until
  a replacement loads. Failures retain the old sheet and superseded callbacks
  cannot activate stale themes.
- Targeted Vitest validation passed five files and 16 tests. Browser regressions
  passed for acrylic-enabled Dark, Light, Monet, and custom light palettes,
  keyboard selection, opaque closed/native and DOM-list surfaces, tab opacity
  throughout motion and completion, and delayed stylesheet replacement.
- A separately identified `dev:desktop` instance used temporary configuration
  and WebView state on native niri Wayland with GTK 3.24.52 and WebKitGTK 2.54.1.
  The actual `/dev/ttyS0` card showed Modbus RTU, Serial, and Slcan in its DOM
  list under Dark, Light, Monet, and custom light themes with acrylic enabled.
  Dark text/background measured `rgb(226, 230, 237)` / `rgb(27, 31, 38)`;
  Light measured `rgb(15, 15, 15)` / `rgb(243, 243, 243)`. The native screenshot
  was visually inspected. A real tab switch sampled 166 frames with opacity
  fixed at 1, observed transform animation, and ended with no animation,
  transform, or inline-style residue. This supersedes the earlier review's
  isolated-GTK-host acceptance limitation for the reported device selector.
- The complete gate runner executed all 24 entries. The other 23 passed;
  the initial unit-suite failure was an existing CategoryPanel test sending
  a native `change` event to the new combobox. Updating it to select an option
  preserved its adapter/configuration assertions. The final full Vitest rerun
  passed 189 files and 1339 tests; changed-test lint and documentation checks
  also passed. Rust passed 1490 tests with two ignored, and all 13 Playwright
  tests passed. Production Web build, Clippy, contracts, architecture/layer/
  motion/token/release gates, render budgets, and `cargo deny` passed. The
  committed performance baseline was unchanged. Only Linux host builds ran;
  no cross-platform packaging, cache clean, or other-platform sidecar
  replacement was performed.
- Documentation names the implementation owners and distinguishes closed
  controls, GTK popups, device-card lists, motion completion, and stylesheet
  lifetime. Linux checks use the host target and preserve other-platform
  caches and sidecars. One change file covers the user-visible changes;
  version fields, dependencies, and CHANGELOG were not modified.
- Review covered factual paths and commands, English prose, metadata/indexes,
  documentation authority, unchanged licensing, and release-note scope.
  Existing external links were not comprehensively revalidated.

## Follow-ups

1. Repeat the native acceptance steps in `architecture/linux-rendering.md`
   when GTK/WebKitGTK, the select primitive, content motion, or CSS loading
   changes. Owner: maintainers. Review by 2026-10-20 or before release,
   whichever is earlier. Expanded GTK lists outside device selection require
   separate acceptance when their rendering path changes.
