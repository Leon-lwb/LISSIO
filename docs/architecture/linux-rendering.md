# Linux Desktop Rendering

<!-- lissio-doc
status: maintained
owner: Lissio maintainers
last-reviewed: 2026-10-13
applies-to: Linux WebKitGTK controls, content switching, and platform-safe verification
-->

The desktop shell uses Tauri's WebKitGTK WebView on Linux. Browser development
and the default Playwright suite use Chromium, so a passing browser test alone
does not establish that GTK native popups render correctly on Wayland.

Authoritative sources are
[`tauri.conf.json`](../../src-tauri/tauri.conf.json),
[`DevicePanel.tsx`](../../src/components/acquisition/DevicePanel.tsx),
[`DeviceTreePanel.tsx`](../../src/components/acquisition/DeviceTreePanel.tsx),
[`Select.tsx`](../../src/components/ui/Select.tsx),
[`useSelect.ts`](../../src/lib/interaction/useSelect.ts), and
[`form-control.css`](../../src/styles/components/form-control.css),
[`useContentSwitch.ts`](../../src/lib/motion/useContentSwitch.ts), and
[`css-theme-loader.ts`](../../src/settings/css-theme-loader.ts).

## Device selection and native popups

WebKitGTK renders a native HTML `select` popup in GTK widgets outside the page.
Those widgets use the GTK theme; setting page `option` colors or `color-scheme`
does not reliably control their foreground/background pair. A readable closed
control therefore does not establish that its expanded options are readable.

The discovered-device cards and device tree use an app-rendered select-only
combobox for connection methods, root devices, and child drivers. Serial,
Slcan, Modbus, and the other
available adapters retain their capability-catalog values and creation paths.
The list is portaled to the document body to avoid clipping by dock panels.
It uses the active theme's text color and opaque `--color-float-surface`, which
[`applyAppearance`](../../src/settings/applyTheme.ts) preserves before acrylic
backgrounds are made translucent.

The trigger keeps keyboard focus. Arrow keys, Home/End, and typing navigate
enabled options; Enter/Space and pointer selection commit. Escape cancels;
Tab commits the active option and advances focus. Outside pointer presses and
focus loss dismiss the list. Disabled options cannot be selected, and a
discovery refresh cannot commit a removed option.

Other HTML selects retain native selection behavior, with `appearance: none`
and a CSS arrow for the closed control. This prevents WebKitGTK's native light
bezel from painting over the application's background. `applyTheme` preserves
the original `bgInput` as `--color-select-surface` before acrylic changes the
input backgrounds. Native expanded lists outside the device selectors still
depend on GTK. Application menus and file dialogs retain their existing paths.
Do not change the user's GTK theme or disable GPU compositing to address a
device-picker palette mismatch.

## Content switching and CSS theme lifetime

Fractional ancestor opacity creates a Backdrop Root for frosted descendants.
Fading a whole tab therefore changes what those descendants sample when the
fade finishes. `AnimatedSwitch` uses transform-only Web Animations through
`useContentSwitch`, installed before paint. The animation engine owns completion;
there is no duration timer clearing inline opacity or transforms at a separate
time. Interrupted animations are cancelled. Reduced motion and switches without
an ordered spatial relationship complete immediately, preserving the subtree.

Repeated appearance updates reuse the current CSS theme link. A replacement
loads with `media="not all"` while the active stylesheet remains applied; its
load handler enables the new sheet and removes the old sheet in one task.
Superseded loads cannot replace the latest request, and failed loads retain
the active stylesheet. This prevents an unstyled interval during asynchronous
theme replacement.

## Verification

Run the targeted regressions from the repository root:

```sh
pnpm test src/components/ui/__tests__/Select.test.tsx src/components/acquisition/__tests__/DevicePanel.test.tsx src/components/acquisition/__tests__/DeviceTreePanel.test.tsx src/components/ui/__tests__/AnimatedSwitch.test.tsx src/settings/__tests__/cssThemeLoader.test.ts
pnpm exec playwright test e2e/device-select.spec.ts e2e/render-stability.spec.ts
```

The component tests cover selection, cancellation, discovery changes, the
device-card adapter and endpoint callback, interrupted content animation, and
stylesheet replacement. Browser regressions check Dark, Light, Monet, and a
custom light theme with acrylic enabled, opaque select surfaces and contrast,
keyboard selection, viewport bounds, opacity throughout tab animation, and
delayed CSS theme replacement. They do not assert GTK native popup pixels.

For Linux desktop acceptance, launch the native shell in the affected session:

```sh
pnpm dev:desktop
```

1. Open **Connections** in the activity bar. Expand a discovered device's
   **Connect via** picker, including `/dev/ttyS0` when present. Check Modbus RTU,
   Serial, and Slcan without connecting to hardware.
2. Open **Device tree** and expand **Add device**.
3. Confirm every unselected row is readable, including Serial, Slcan, and
   available Modbus adapters. Check the selected row separately.
4. Select Serial with the pointer, then another driver using arrows and Enter.
   Reopen and press Escape; the committed driver must remain unchanged.
5. Switch between dark and light themes and repeat with acrylic enabled.
   Resize the window and confirm the options remain within the viewport.
6. Check the child-driver picker on a device whose manifest permits children.
7. Switch tabs, sidebar categories, and settings sections. Inspect the end of
   each transition for a whole-surface flash. Repeat with rapid switches and
   reduced motion. Change CSS themes while a request is delayed and confirm
   the previous sheet remains applied until the replacement loads.

Record the session type, compositor, GTK/WebKitGTK versions, active GTK and
application themes, and whether the failure affects the closed control,
unselected rows, or only the selection highlight. Useful read-only probes:

```sh
printenv XDG_SESSION_TYPE XDG_CURRENT_DESKTOP GDK_BACKEND GTK_THEME
pkg-config --modversion gtk+-3.0 webkit2gtk-4.1
```

`GDK_BACKEND=x11` can run an app through XWayland even inside a Wayland session.
When reproducing native Wayland behavior, use a per-process override:

```sh
GDK_BACKEND=wayland pnpm dev:desktop
```

## Build scope

Use the current Linux host for validation. The gate runner's `cargo
--all-targets` refers to Rust library, binary, example, and test targets;
it does not request macOS or Windows compilation.

For a local Linux package, choose the bundle explicitly:

```sh
pnpm prepare:sidecar:release
pnpm tauri build --config src-tauri/tauri.local.conf.json --bundles deb
```

[`prepare-sidecar.mjs`](../../scripts/prepare-sidecar.mjs) defaults to the Rust
host triple and prepares that platform's sidecar. Existing target caches and
other platform sidecars are not prerequisites for this investigation and
should be preserved. [`auto-build.sh`](../../scripts/auto-build.sh) is a
macOS-host packaging matrix; it is not a Linux troubleshooting command.

Run the complete gate set from [`CONTRIBUTING.md`](../../CONTRIBUTING.md) before
claiming a green build. Keep per-scenario native rendering evidence separate
from the Chromium tests and static gates.
