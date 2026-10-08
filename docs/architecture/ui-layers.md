# Frontend Layering Model

<!-- lissio-doc
status: maintained
owner: Lissio maintainers
last-reviewed: 2026-10-07
applies-to: Implementation, interaction, effect, and view dependency rules
-->

This is the structural authority for frontend modules. `pnpm check:layers`
enforces the dependency direction and rule numbers below.

## Why layers are executable

Unenforced conventions allowed reverse imports, pulled display state into widget
modules, created dependency cycles, and forced each new widget to invent a new
pattern. Registry metadata and views were split because of the module graph.
Direction is now a gate rather than an aspiration.

## Four layers

| Layer | Directories | Responsibility | May depend on |
| --- | --- | --- | --- |
| Implementation | `types`, `lib/{rpc,platform,tauri,data,buffers,models,utils,panels}`, `store`, registries | Shapes, transport, buffering, persistence, domain rules | Implementation |
| Interaction | `lib/interaction`, data-binding hooks in `lib/hooks` | Translate pointer, keyboard, and time input into intent | Implementation |
| Effect | `lib/{motion,glass}`, motion/frost styles | Convert intent and geometry into visible feedback | Implementation and interaction |
| View | `components` | Composition and rendering | All lower layers |

Direction: **view -> effect -> interaction -> implementation**. A lower layer
must not know its consumer. For example, motion accepts `distancePx`, not a
store subscription.

Within `components`, dependency moves toward leaves:

```text
ui/ brand/
  -> common/ nodes/ layout/ onboarding/
  -> panels/ acquisition/
  -> displays/
  -> widgets/<kind>/
```

`ui/` and `brand/` cannot depend on domain directories or read stores.
`widgets/<kind>/` cannot depend on panels, displays, layout, acquisition, nodes,
or AI. Widgets are reusable leaf content.

## Machine rules

| Rule | Enforced boundary |
| --- | --- |
| L1 | Base UI/brand components cannot import domain directories |
| L2 | Base UI/brand components cannot import stores |
| L3 | Widgets cannot import panels, displays, layout, acquisition, nodes, or AI |
| L4 | Stores cannot import components |
| L5 | Motion and glass cannot import stores |
| L6 | Interaction and hooks cannot import components |
| L7 | Only `lib/motion` may write `will-change` or `transition-property` |
| L8 | Implementation modules cannot import components |
| L9 | `.dialog-overlay` receives stacking through the caller bridge class |
| L10 | Motion and glass cannot import components |
| L11 | Interaction and hooks cannot import motion or glass |

Tests are excluded from direction scanning because fixtures intentionally see
multiple layers. Production code is constrained.

## Registries and one contract

- `lib/panels/panelDefs.ts` owns panel metadata.
- `components/panels/registry/panelViews.tsx` owns React views.
- `components/widgets/registry.ts` owns widget renderers, editors, and icons.
- `components/lazy/lazyComponents.ts` is the only `React.lazy` declaration site.

`WidgetDef` contains kind, content component, optional properties component,
icon, and label key. Ports are not frontend widget metadata; the backend owns
ports.

A widget that renders `NodePlaceholder` is an entry into a real display panel.
The registry test preserves the relationship between placeholder kinds and
hosted panel kinds.

## Interaction and effect ownership

Interaction owns intent and semantic values such as distance, velocity, or
numeric value. It does not write pixels. Effect owns visible movement,
opacity, and glass tier; it does not read pointer input or stores.

There is one writer for each animated property. Entry can overshoot; exit is
critically damped. Reduced motion has one JavaScript query and one CSS registry.
A surface is driven by either `MotionPresence` or CSS fallback, never both.

## Related authorities

| Document | Scope |
| --- | --- |
| [`ui-motion.md`](ui-motion.md) | Motion modules and rules |
| [`motion-tokens.md`](motion-tokens.md) | Generated timing values |
| [`motion-spatial-plan.md`](motion-spatial-plan.md) | Spatial motion implementation decisions |
| [`ui-color-tokens.md`](ui-color-tokens.md) | Color, opacity, frost, and glass tiers |
| [`frontend-render-budget.md`](../performance/frontend-render-budget.md) | Per-frame performance budget |

Canvas-node entrances, chart data interpolation, and cross-host panel migration
remain intentionally immediate. Changing them requires revisiting the recorded
reasons.
