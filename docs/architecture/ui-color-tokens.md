# Frontend Color and Opacity Tokens

<!-- lissio-doc
status: maintained
owner: Lissio maintainers
last-reviewed: 2026-10-13
applies-to: Theme roles, opacity tiers, frost surfaces, glass tiers, and static checks
-->

`src/styles/theme.css` is authoritative. This is a human-readable index and is
checked by `pnpm check:tokens`.

## Layers

| Layer | Content | Owner |
| --- | --- | --- |
| Text and symbol | Text colors, opacity tiers, fill/stroke, state badges | This token system |
| Floating/frost | Floating surfaces, overlays, shadows, backdrop filters | `--frost-*`, `--shadow-*` |
| Surface/border | Non-floating shadows and block backgrounds | Component token entry points |
| Canvas/terminal | Canvas fill and ANSI colors | `colorAlpha.ts`, `--term-*` |

## Opacity tiers

| Tier | Value | Utility | Meaning |
| --- | ---: | --- | --- |
| `faint` | 15% | `opacity-faint` | Placeholder or barely visible |
| `subtle` | 40% | `opacity-subtle` | Secondary icons and textures |
| `disabled` | 45% | `opacity-disabled` | Disabled, unselected, or disconnected |
| `muted` | 60% | `opacity-muted` | Empty state and read-only labels |
| `secondary` | 75% | `opacity-secondary` | Secondary body text |

`opacity-0` and `opacity-100` remain visibility-animation values. Form controls
use `disabled:opacity-disabled`; non-form disabled elements use the static
class. A new tier must be added to `theme.css`, `TEXT_TONE_ALPHA`, and the
static checker.

## Floating and frost surfaces

Use shared classes instead of composing background, border, shadow, and
backdrop-filter in each component:

| Class | Purpose |
| --- | --- |
| `float-overlay` | Dialog backdrop without frost |
| `float-card` | Windows, secondary cards, and onboarding |
| `float-popover` | Menus, tooltips, drag ghosts, and readouts |
| `float-chrome` | Floating title/footer bars |
| `float-chrome-muted` | Floating sidebars and weakened regions |
| `frost-surface` | Always-frosted in-panel surfaces |
| `frost-acrylic` | Toasts and status bars under `acrylicBackground` |
| `sticky-section-bar` | Sticky section headers under `acrylicBackground` |

Core values include `--frost-blur: 18px`, `--frost-saturate: 180%`,
`--frost-alpha-floating: 72%`, `--frost-alpha-widget: 47%`,
`--frost-alpha-sticky-bar: 16%`, and `--frost-alpha-surface: 40%`.
`floatingGlass` and `acrylicBackground` are independent settings. Disabling
frost must produce a solid surface without residual `backdrop-filter`.

Sticky section bars intentionally use low opacity because blur over flat color
is invisible; title legibility uses the shared text shadow. In-panel frosted
surfaces pair blur radius and opacity instead of maximizing either alone.

## Glass tiers

Glass roles use one tier: solid, blur, or liquid refraction.

- Refraction is allowed only for floating overlays.
- Refraction and blur cannot coexist on one element.
- The library owns canvas stacking; do not pass a global z-index.
- The engine restores pointer events to the target.
- Missing backend or low frame rate degrades liquid to blur, never directly to solid.
- Presets live in `glassPresets.ts`; strength scales refraction, bevel depth, and aberration but not frost or specular.
- Fluid pointer response is used instead of tilt.

## Text and state colors

Device-card and device-tree select popups pair `--color-text-primary` with the opaque
`--color-float-surface` preserved by `applyAppearance`. They render inside the
page instead of delegating option colors to GTK; see
[Linux desktop rendering](linux-rendering.md) for scope and acceptance checks.
Closed native selects use `--color-select-surface`, derived from the theme's
original `bgInput` by `applyTheme` and updated by `applyThemeToken`. Acrylic
changes do not make this surface translucent. The persisted token set stays
unchanged; `form-control.css` owns the closed control's bezel and arrow.

Use semantic tokens such as `text-text-primary`, `text-text-secondary`,
`text-text-bright`, `text-text-inverse`, `text-text-disabled`, and
`text-text-muted`. Never use `text-white`; use `text-text-inverse`.

Secondary text variants are derived with `color-mix` and theme linkage. Use a
text tone class instead of adding `opacity-*` to the same element so icons,
borders, and backgrounds are not dimmed accidentally. Semantic state colors
cover the seven state roles and four strength levels.

Canvas and inline numeric composition uses `colorAlpha.ts`. TS helpers in
`textTone.ts` own the approved alpha set.

## Static checks

| Rule | Reject | Use |
| --- | --- | --- |
| Opacity tiers | Arbitrary `opacity-NN` | Named tier utilities |
| Palette scales | `text-green-500` style defaults | Semantic roles or token plus modifier |
| White text | `text-white` | `text-text-inverse` or `text-text-bright` |
| Raw CSS opacity | `opacity: 0.NN` | `var(--alpha-*)` |
| Raw frost | `backdrop-blur-*` in TS/TSX | Shared float/frost classes |
| Frost parameters | Non-token blur/saturate | `--frost-*` |
| Frost structure | Alpha >=85%, unused tokens, nested backdrop filters | Visible alpha, delete dead tokens, one filter layer |
| Synchronization | Alpha token, TS map, opacity utility, aliases drift | Checked four-way |

Bare hue utilities are allowed when they resolve through `@theme`; numeric
Tailwind palette scales are rejected.

`src/styles/component-tokens.css` is the component-local visual token entry.
`theme.css` owns runtime theme tokens. Other component CSS may use only
`var(--*)` colors. Production TS/TSX/CSS files remain within 500 lines.
