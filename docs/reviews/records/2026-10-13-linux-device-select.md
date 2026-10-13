# Linux device selection rendering review

<!-- lissio-review
date: 2026-10-13
scope: Wayland GTK option popup contrast, device-tree comboboxes, and Linux build guidance
reviewer: Codex automated review
verdict: passed-with-conditions
-->

## Scope

Read the repository and documentation guides, the crate ownership report,
Tauri shell configuration, WebKitGTK popup implementation, frontend theme
application, and device-tree adapter/child-driver selectors. The reported
failure concerns expanded GTK options in the device-node addition list.

## Findings

- The host runs niri in a Wayland session with GTK 3.24.52 and WebKitGTK 2.54.1.
  The inherited `GDK_BACKEND=x11` would use XWayland; native verification used
  a per-process `GDK_BACKEND=wayland` and confirmed `GdkWaylandDisplay`.
- The native GTK popup is outside the page's CSS rendering tree. An isolated
  WebKitGTK probe produced the same GTK colors before and after adding page
  `color-scheme: dark` and explicit `option` text/background colors. The
  isolated baseline itself rendered black text on white, so the reporter's
  exact white-on-white GTK theme failure was not reproduced independently.
- The device tree now uses the app-rendered `Select` for its two pickers.
  This removes the dependency on the GTK popup palette at the reported
  entry point. Catalog values, availability filtering, creation callbacks,
  and stored configuration formats remain unchanged.
- Interaction lives in `useSelect`; the base UI reads no stores. The list
  portals outside dock clipping, pairs opaque theme background with theme
  text, and remains within the viewport. Keyboard navigation skips disabled
  choices and handles refreshed options without committing a removed driver.
- A real Lissio frontend connected to a temporary backend was loaded in
  WebKitGTK on native Wayland. Opening the device picker showed CandleLight,
  Modbus RTU/TCP, Siemens S7, Serial, Slcan, TCP client/server, Test Data, and
  UDP in a DOM list. No native option-menu signal was emitted. The measured
  list foreground was `rgb(226, 230, 237)` and opaque background was
  `rgb(27, 31, 38)`; its screenshot was visually checked.
- Targeted Vitest validation passed two files and six tests. The browser
  regression passed against the real backend and covered Dark, Light, Monet,
  and a custom light theme, opaque list surfaces, contrast, viewport bounds,
  typeahead, selection, and Escape cancellation.
- Full validation with `pnpm check:all -- --no-fix` passed all 24 entries in
  607 seconds, including the informational architecture report. Vitest passed
  187 files and 1334 tests; Rust passed 1490 tests with two ignored; Playwright
  passed all 11 browser tests. Production Web build, Clippy, formatting,
  contracts, source/architecture gates, release checks, render-budget checks,
  and `cargo deny` all passed. The committed performance baseline was not
  changed. Linux host builds reused the existing cache; no cross-platform
  packaging, cache clean, or other-platform sidecar replacement was run.
- README now identifies `auto-build.sh` as macOS-host-only. Linux rendering
  guidance names the owning code, native verification steps, and host/bundle
  commands that preserve other platform caches. One change file records the
  user-visible fix; version fields and CHANGELOG were not edited.
- Documentation review covered factual paths and commands, English prose,
  metadata and indexes, code authority, current behavior, unchanged licensing
  and dependencies, and release-note synchronization. Existing external links
  were not comprehensively revalidated.

## Follow-ups

1. Confirm the device picker in the reporter's usual Tauri launch environment
   before release. Native verification used the same installed WebKitGTK
   engine in an isolated GTK host; other GTK menus and selects retain their
   existing paths. Owner: maintainers. Review by 2026-10-20 or before release,
   whichever is earlier. Repeat when GTK/WebKitGTK or select behavior changes.
