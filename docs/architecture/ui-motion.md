# Frontend Motion System

<!-- lissio-doc
status: maintained
owner: Lissio maintainers
last-reviewed: 2026-10-07
applies-to: Motion modules, families, CSS primitives, and invariant rules
-->

## Modules

| Module | Responsibility |
| --- | --- |
| `spring.ts` | Physical spring solver |
| `motionConfig.ts` | Family timing, speed scaling, and reflow intent |
| `easingTokens.ts` | Projects spring curves into CSS `linear()` easings |
| `gsapSpring.ts` | Evaluates the same solver for GSAP |
| `presence.ts` | Role geometry and CSS travel/scale token projection |
| `MotionPresence.tsx` | Entry/exit lifecycle for removable surfaces |
| `useMotionPresence.ts` | Entry-only lifecycle when DOM removal owns exit |
| `stagger.ts` | Bounded index-based entry delay |
| `release.ts` | Converts handoff velocity into an effect-layer release plan |
| `dockReorder.ts` / `useDockReorder` | Geometry continuity and dock-yield selection |

Docked panels submit width once, use `MotionPresence` for entry/exit, and use
FLIP for geometric continuity. Exit plays first and then width collapses.

## Families

| Family | Purpose |
| --- | --- |
| `control` | Hover, press, and focus feedback |
| `toggle` | Switch, slider, and knob state changes |
| `content` | Rows, messages, toasts, and banners |
| `surface` | Dialogs, menus, and anchored popovers |
| `spatial` | Docked panels, floating windows, and large movement |

Entry may overshoot. Exit is always critically damped.

## CSS primitives

- `motion-control`: color, border, and shadow feedback.
- `motion-row`: list and menu movement plus color response.
- `motion-surface`: module and widget surface state.
- `motion-float`: floating opacity, translation, scale, and shadow.
- `motion-pill`: tab indicator geometry.
- `motion-switch`: non-remounting mode/tab transitions.
- `motion-transition`: explicit replacement for `transition-all`.
- `motion-*-in`: JavaScript-free entry fallback using role geometry tokens.

## Rules

1. Timing and easing come only from motion tokens; do not add local cubic Béziers.
2. Prefer `transform`. Dock width is submitted once and continuity uses FLIP.
3. A property has one writer. `promote()` suspends CSS transitions while GSAP owns `transform`.
4. `will-change` is requested by `promote()` and returned by `release()`.
5. Use GSAP for complex ordering, spatial reflow, and drag inertia; use CSS for high-frequency state feedback.
6. Every motion path uses `motionIsReduced()` rather than querying `matchMedia` locally.
7. Register each animated surface once in `reduced-motion.css`.
8. Use `MotionPresence` when exit must finish before unmount.
9. Do not drive one element with both CSS keyframes and JavaScript tweens.
10. Stagger uses `--motion-stagger-delay`, not inline `animation-delay`.
11. Role token names and geometry are owned by `presence.ts`; `pnpm check:motion` verifies both directions.
