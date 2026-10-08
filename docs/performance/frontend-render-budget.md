# Frontend Render Budget Gate

<!-- lissio-doc
status: maintained
owner: Lissio maintainers
last-reviewed: 2026-10-07
applies-to: Per-frame browser cost measurement and regression policy
-->

The performance gate measures per-frame frontend rendering cost in a real
browser and blocks regressions. Scenarios are `panel-drawer`, `palette-scroll`,
and `canvas-drag`.

```bash
pnpm test:perf      # collect output/perf-frontend/raw.json
pnpm perf:check     # compare with the committed baseline
pnpm perf:baseline  # intentionally replace the baseline
bash scripts/perf-gate.sh
```

Layout animation is checked by `pnpm check:motion`; frost structure is checked
by `pnpm check:tokens`.

## Why the gate counts per frame

Repeated work per frame causes interaction jank: canvas reallocation, repeated
SVG attributes, and layout reads after DOM writes are stable code properties.
FPS, frame-time percentiles, long tasks, and heap values are timing quantities.
Headless Chromium has no physical vsync and shared-runner load changes them.

| Category | Gated | Reason |
| --- | --- | --- |
| Per-frame operation counts | yes | Machine-independent and deterministic |
| Canvas reallocations | yes, absolute zero | There is no reasonable nonzero count |
| Timing metrics | no | Recorded for trends only |

## Probe blind spots

CSS transitions can cause layout work in browser C++ without JavaScript. Motion
static checks reject layout-property transitions.

Compositor `backdrop-filter` work is also invisible to main-thread counters.
Headless BeginFrame quantizes timing enough to hide meaningful blur-cost
differences. Frost cost therefore uses deterministic structural budgets: blur
radius, opacity, nesting, and invalidation source. Desktop GPU measurements are
still required for real hardware claims.

## Measurement without product changes

The probe patches canvas dimension accessors, `setAttribute`,
`getBoundingClientRect`, `getComputedStyle`, `requestAnimationFrame`, and a
Long Task observer in `addInitScript`. Business code does not contain counters.
Collection and comparison are separate so `raw.json` can be replayed to
distinguish code regressions from noisy runners.

Runtime output stays in `output/`; the committed baseline is
`docs/performance/frontend-perf.json`.

## Scenarios

| Scenario | Driver | Primary cause |
| --- | --- | --- |
| `panel-drawer` | Activity bar dock-panel switch | Layout commit, exit, and reflow |
| `palette-scroll` | Wheel through long palette | Scroll work and sticky frost |
| `canvas-drag` | React Flow pointer drag | Canvas interaction cost |

Canvas drag performs hit testing and records an explicit skip if an overlay
blocks the target.

## Baseline interpretation

| Scenario | `setAttribute` | `getBoundingClientRect` | `getComputedStyle` |
| --- | ---: | ---: | ---: |
| `panel-drawer` before | 93.79 | 5.47 | 2.07 |
| `panel-drawer` after | 71.59 | 3.56 | 2.07 |
| `canvas-drag` | 33.7 | 4.4 | 1.02 |
| `palette-scroll` | 33.4 | 5.13 | 1.01 |

Removing the `flex-grow` transition removed a full-panel layout pass that the
probe cannot see. The reduced React commit count is corroborating evidence, not
the performance measurement itself. The `setAttribute` budget is 90.

## Coverage limits

- Spectrum canvas dragging is not yet driven by a production-like scenario.
- Headless software raster does not measure desktop GPU composition.
- Main-thread probes cannot observe compositor-thread blocking.
