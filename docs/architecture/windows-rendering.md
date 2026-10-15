# Windows Desktop Rendering

<!-- lissio-doc
status: maintained
owner: Lissio maintainers
last-reviewed: 2026-10-15
applies-to: Windows desktop transparency, acrylic backgrounds, theme application, and native rendering verification
-->

## Authority and scope

This document describes the Windows Tauri shell and the frontend surfaces that
compose over its native backdrop. The implementation sources are:

| Concern | Authoritative source |
| --- | --- |
| Transparent native window and WebView | [`src-tauri/tauri.conf.json`](../../src-tauri/tauri.conf.json) |
| Native material, frame theme, tint, and clearing | [`src-tauri/src/shell.rs`](../../src-tauri/src/shell.rs), `set_window_acrylic` |
| Appearance settings and background alpha | [`src/settings/applyTheme.ts`](../../src/settings/applyTheme.ts) and [`acrylicMaterial.ts`](../../src/settings/acrylicMaterial.ts) |
| Window background and theme tokens | [`src/styles/theme.css`](../../src/styles/theme.css) |
| Application and setup wrappers | [`src/App.tsx`](../../src/App.tsx) and [`ConfigGuide.tsx`](../../src/components/onboarding/ConfigGuide.tsx) |
| Node-editor background and grid | [`NodeEditor.tsx`](../../src/components/layout/NodeEditor.tsx), [`node-editor.css`](../../src/styles/components/node-editor.css), and [`react-flow.css`](../../src/styles/components/react-flow.css) |
| Theme editing and settings application | [`ThemeEditor.tsx`](../../src/components/ThemeEditor.tsx), [`ThemeEditorColorPanel.tsx`](../../src/components/ThemeEditorColorPanel.tsx), and [`settingsStore.ts`](../../src/store/settingsStore.ts) |

The [color-token contract](ui-color-tokens.md) owns shared surface colors and
frost rules. The [render-budget policy](../performance/frontend-render-budget.md)
owns browser performance checks and their limits.

## Native transparency and Windows policy

The main window is created with `transparent: true`. This permits transparent
WebView content; it does not itself request a blurred desktop backdrop.
`set_window_acrylic` applies the Windows material through `window-vibrancy`,
synchronizes the native frame with the application theme, and clears both
acrylic and fallback blur when disabled. A failed acrylic application attempts
the existing blur fallback and reports errors through the shell log.

Windows controls whether its acrylic material is translucent. Turning off
**Transparency effects** in Windows Settings, enabling Battery Saver, or using
hardware that cannot support the effect can produce a solid fallback color.
Background acrylic can also become solid when the application window loses
focus. High-contrast modes use their own colors. These are system material
policies, not evidence that the WebView cannot render alpha. See Microsoft's
[Acrylic material guidance](https://learn.microsoft.com/en-us/windows/apps/design/style/acrylic).

Verify a desktop backdrop with the application focused, Windows Transparency
effects enabled, and power/accessibility conditions recorded. Application
settings do not override these Windows preferences. A Windows setting change
is separate from the application's stored appearance configuration.

## Appearance controls

| Setting | Effect |
| --- | --- |
| Windows Transparency effects | Allows Windows material translucency subject to system conditions; affects other applications too |
| `acrylicBackground` | Requests the native backdrop and converts the selected application background tokens to alpha colors; disabling it restores opaque theme colors |
| `acrylicOpacity` | Adjusts application background and widget-frost opacity; cannot force Windows to render a translucent system material |
| `windowOpacity` | Applies CSS opacity to the whole document body, including text and controls; independent of native blur |
| `floatingGlass` | Controls in-application floating surfaces; it does not enable a desktop backdrop |

The Windows system material can have a different light/dark polarity from the
application. `acrylicMaterial.ts` owns the compensating alpha calculation;
`shell.rs` owns frame-theme synchronization. Do not infer native material
behavior from the application's theme name alone.

## Paint each background once

Each logical surface has one owner for its background tint:

| Surface | Background owner | Transparent containers |
| --- | --- | --- |
| Application window | `body` paints `--color-bg-window` | `html`, `#root`, the App wrapper, its loading placeholder, and the setup-screen wrapper |
| Node editor | `.node-editor-rf` paints `--color-bg-editor` | Its React Flow container and the grid SVG background |

The grid can draw its pattern while leaving its background transparent.
Repainting the same translucent token on wrappers compounds its opacity. For
example, two copies of a 50% window tint produce 75% opacity, and three copies
of a 55% editor tint produce about 91%. Removing redundant fills preserves the
configured tint in both acrylic and opaque modes; it does not remove the
owning background surface.

## Theme editing uses the appearance path

Theme editor callbacks update settings, and `settingsStore.ts` applies the
complete appearance through `applyAppearance`. This installs the palette,
recomputes acrylic alpha, and requests the corresponding native material.
Activating, importing, creating, resetting, or editing a color theme must use
that path. A subsequent raw `applyTheme` or `applyThemeToken` write would
replace the computed background colors and lose their alpha.

When acrylic is disabled, the same path restores the original theme colors.
An edit to an inactive custom theme must not replace the active theme's
appearance. CSS theme loading retains its own stylesheet lifecycle.

## Validation

Browser checks and native desktop checks answer different questions:

| Check | What it establishes |
| --- | --- |
| Theme-editor and appearance unit tests | Settings callbacks preserve acrylic colors and opaque restoration |
| [`e2e/acrylic-background.spec.ts`](../../e2e/acrylic-background.spec.ts) | Computed browser backgrounds have one owner in acrylic and opaque modes, including the setup screen |
| Native Windows window over contrasting desktop content | The system material actually reveals and blurs content behind the application under the recorded OS conditions |
| Full quality gates | Repository contracts, dependency safety, compilation, tests, and the committed browser performance budget |

For native verification, record the Windows build, WebView2 version, system
transparency preference, power state, application focus, theme, and opacity
settings. Place contrasting content behind the active application and compare
acrylic enabled and disabled. Repeat after a theme edit, and check that turning
acrylic off leaves no native blur. Test matching and opposite application/system
themes on the Windows versions being claimed as supported by the result.

A diagnostic that temporarily makes all DOM backgrounds transparent can
separate WebView alpha support from the native material. With the native effect
disabled, visible content behind that diagnostic window proves the WebView
path can be transparent. This diagnostic is not normal product behavior:
disabling acrylic in the application restores opaque theme backgrounds.
Restore the normal DOM and settings before checking the final appearance.

Headless browser assertions and per-frame counters do not verify DWM blur,
desktop composition, or GPU appearance. Preserve actual native observations
and untested platform conditions in a dated review record. Re-review this
document when the shell material, background ownership, theme-editing path, or
supported Windows behavior changes.
