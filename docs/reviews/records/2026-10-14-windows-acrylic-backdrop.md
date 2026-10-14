# Windows acrylic backdrop review

<!-- lissio-review
date: 2026-10-14
scope: Windows acrylic backplate path — DWM material, native frame polarity, theme tint, and the acrylic background token alphas that composite over the system material
reviewer: implementation agent; maintainer sign-off pending
verdict: passed-with-conditions
-->

## Scope

Read `src-tauri/src/shell.rs` (`set_window_acrylic`), `src-tauri/tauri.conf.json`
(main window), `src/settings/applyTheme.ts`, `src/settings/theme.ts`,
`src/components/layout/MenuBar.tsx`, `src/lib/performance/acrylicGuard.ts`, and
the resolved `window-vibrancy` sources (0.6.0 and 0.8.1) together with the tao
window-creation path (`tao-0.37.1/src/platform_impl/windows/{window,window_state,dark_mode}.rs`).
The subject is why the acrylic backplate does not match the application theme on
Windows, and what the shell can actually control there.

## Findings

- The platitude "the OS draws an acrylic plate, the app only tints it" is wrong in
  the direction that matters. DWM owns the Windows 11 22H2+ material
  (`DWMBT_TRANSIENTWINDOW`, Desktop Acrylic): its light/dark variant follows the
  **system** app mode, and `DWMWA_USE_IMMERSIVE_DARK_MODE` is documented as
  affecting the window **frame** only ("Allows the window frame for this window to
  be drawn in dark mode colors…", minimum Windows 11 22621). `window-vibrancy`
  never sets that attribute from `apply_acrylic` (only `apply_mica` accepts a
  `dark` flag), which is why upstream reports the acrylic effect as
  system-polarity-locked ([window-vibrancy#185](https://github.com/tauri-apps/window-vibrancy/issues/185)).
  With `acrylicBackground: true` and `theme: 'dark'` as the shipped defaults, a
  light-mode Windows produced a bright material under `rgba(#0d1016, 0.5)` — a grey
  wash with text contrast built for a dark window.
- Nothing in the repository ever told Windows which polarity the application uses.
  `set_window_acrylic` was called with `{ enabled }` only, so a decorated window
  (the main window keeps its native frame; only the *menu bar* is custom-built on
  Windows) also showed a light title bar above a dark application.
- The Windows 10 path (`ACCENT_ENABLE_ACRYLICBLURBEHIND`, builds 17763-22620) was
  called as `apply_acrylic(&window, None::<(u8, u8, u8, u8)>)`. There the material
  tint *is* application-owned, and `None` lands as alpha 1 (DWM rejects alpha 0),
  so the backplate carried no theme color at all — unlike macOS, where the
  vibrancy material sits behind an application-tinted `body`.
- The version gate in `window-vibrancy` for the system backdrop is build 22523,
  while Microsoft documents `DWMWA_SYSTEMBACKDROP_TYPE` as Windows 11 **22621**.
  Builds 22523-22620 (Windows Insider) therefore take the DWM branch, the call
  fails, and 0.6.0 swallowed the `HRESULT` — no backdrop and no fallback.
- The workspace pinned `window-vibrancy = "0.6"` while `tauri` 2.12 itself
  resolves 0.8.1, so two copies of the crate were compiled, and the shell could not
  see the `DwmSetWindowAttribute` failures that 0.8.1 started reporting.
- Two smaller drifts: `applyTheme.ts` assigned `root.dataset.acrylic = 'true'`
  twice, and the z-index comment in `theme.css` still claimed
  `appearance.acrylicBackground=false` while the shipped default is `true`.

## Changes

- `set_window_acrylic` takes `dark: Option<bool>` and `tint: Option<Vec<u8>>`. The
  Windows branch sets the immersive dark mode through `window.set_theme(...)`
  (frame, title bar), forwards the theme's window background as the DWM gradient
  tint with a fixed alpha of 0x40 (Windows 10 path), and falls back to
  `apply_blur` when the system backdrop call fails, so 22523-22620 keeps a frost
  instead of a bare transparent window. Both material paths are cleared on disable.
- `window-vibrancy` moves to `0.8` (the line `tauri` already resolves): one copy in
  the lockfile, and DWM failures surface as `Err` instead of being dropped.
- `src/settings/acrylicMaterial.ts` owns the model that the shell cannot express:
  when the host borrows a system material whose polarity is the opposite of the
  application theme, the acrylic token alphas are pushed toward opaque with a
  convex combination (`alpha + (1 - alpha) * 0.65`). That keeps the per-token
  hierarchy (window most transparent, panel header most solid) instead of flattening
  every token onto one floor, and it leaves the default opacity slider monotone.
  Compensation is enabled for Windows only; macOS carries the same class of
  limitation (see Follow-ups).
- `src/lib/platform/host.ts` becomes the single place that answers "is this
  Windows" and "does the host prefer dark", shared by `MenuBar` and the settings
  layer instead of two UA regexes.

## Verification

- `cargo check -p lissio --all-targets` (macOS host) passes, and the resolved
  dependency sources were checked by hand for the Windows-only branch:
  `window-vibrancy` 0.8.1 exports `apply_blur`/`clear_blur`/`apply_acrylic`/
  `clear_acrylic` with unchanged signatures, `Error` implements `Display`, and
  `WebviewWindow::set_theme(Option<tauri::Theme>)` exists in `tauri` 2.12.
- `cargo test -p lissio` covers `acrylic_tint` (three-channel contract, alpha).
- Vitest covers the material model (`acrylicMaterial.test.ts`, `host.test.ts`) and
  the `applyAppearance` contract (`applyTheme.test.ts`): token alphas with and
  without compensation, the `set_window_acrylic` arguments, and restoration of the
  opaque theme colors when acrylic is switched off.
- The `x86_64-pc-windows-msvc` cross-check could not run on this host: cargo tried
  to download a Windows-only crate and the sandbox refused the write into the cargo
  registry cache. The Windows branch has therefore been reviewed against, but not
  compiled for, its target — see Follow-ups.
- Not verified on Windows hardware by this review.

## Follow-ups

1. Maintainer sign-off.
2. Compile the Windows target (`cargo check -p lissio --target
   x86_64-pc-windows-msvc --all-targets`) and then run the manual pass below on
   real hardware. Owner: maintainers / Windows CI.
3. Manual Windows pass (owner: maintainers): on Windows 11 22H2+ and on Windows 10
   22H2, with the system app mode set *opposite* to the app theme, confirm the
   backplate reads as the app theme rather than the system material, the title bar
   matches the app theme, enabling/disabling acrylic leaves no blur behind, and the
   `acrylicGuard` notification still fires on a low frame rate. Record the
   `window-vibrancy` write path chosen from the debug log line in
   `set_window_acrylic`.
4. macOS has the same structural mismatch: the vibrancy material is applied with
   `NSVisualEffectMaterial::FullScreenUI` and follows the system appearance while
   the application theme is independent. `hostBorrowsSystemMaterial()` is
   deliberately Windows-only until a macOS pass validates the compensated alphas;
   extending the list is the whole change.
5. The compensation is read from `prefers-color-scheme` at apply time. A system
   theme change while the application is running does not re-run
   `applyAppearance`, so the backplate keeps the polarity it was applied with until
   the next settings write — the same staleness `configGuideStore` already accepts.
