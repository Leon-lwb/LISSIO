# Spatial Motion Decisions

<!-- lissio-doc
status: maintained
owner: Lissio maintainers
last-reviewed: 2026-10-07
applies-to: Spatial motion implementation decisions and acceptance criteria
-->

This document records completed spatial-motion work and intentional
non-goals. Runtime tokens are in [`motion-tokens.md`](motion-tokens.md).

## Acceptance questions

A motion is acceptable only when all three are true:

1. **Where does it come from?** Direction and scale origin reveal the owning surface.
2. **How far does it move?** Duration and amplitude match measured travel.
3. **Why does it move this way?** A spring-constrained object explains the motion.

Uniform or linear movement without a physical reading remains a candidate for
replacement.

## Available building blocks

| Capability | Entry |
| --- | --- |
| Family spring | `motionSpring(family, phase)` |
| Distance-aware timing | `motionSpringFor(family, phase, px)` |
| Entry/exit geometry | `MotionPresence` origin, travel, scale, exit geometry |
| Dock-edge geometry | `dockPanelGeometry(edge)` |
| Dock drawer | `DockedPanel` |
| Dock group continuity | `useDockReorder` |
| List slot continuity | `useFlipReorder` |
| Bounded stagger | `useStaggerEntrance` |
| Shared indicator movement | `pillTransform` FLIP |
| Compositor layer ownership | `promote`, `release` |
| Nonzero initial velocity | `springAtWithVelocity` |
| Release momentum | `planRelease` |

## Completed decisions

### Docked panels

`DockedPanel` owns sidebar and AI panel entry/exit. Width is committed once;
group FLIP preserves continuity with transforms only. `MotionPresence` plays
exit before the panel is removed, and `useDockReorder` moves neighbors.

Close is serial: exit completes first, then width collapses. This prevents the
panel library's forced overflow from clipping the exit. Exit moves toward its
dock edge, scales down, and yields space. Bottom panels use a smaller scale
change because they span the full window width.

### Reordering within a dock group

Removing a forced React `key` allowed panel DOM to survive edge changes.
`useDockReorder` measures final rectangles and returns panels to their settled
slots. Edge changes use `spatial/in`; simple open/close yielding uses a faster
reflow motion because the panels themselves did not move.

### List yielding

`useFlipReorder` shares one measurement across insertion, removal, and reorder.
Yield distance is scaled from measured travel. Zero bounce is intentional:
surrounding rows have no source object or momentum.

### Drag release

Pointer velocity is derived from recent movement and passed to the spring
solver. The drag ghost travels toward the drop point without overshooting it.
Very small release velocity uses an in-place fade. Release duration comes from
the plan and is shared by the component and cleanup timer.

## Intentional non-goals

### Canvas node entry/exit

Nodes appear and disappear immediately. React Flow owns node transforms, node
position is data, and batch creation can add many nodes at once. A generic
entry animation would be decorative and could make user-authored graph data
appear self-moving. Drag feedback already communicates insertion.

### Chart data transitions

Chart values are measurements. Animating data changes can misrepresent readings.

### Cross-host panel migration

Moving among sidebar, bottom dock, and floating window remains immediate because
the three hosts do not share one intermediate geometry.

## Completion criteria

- New motion uses family tokens or spring APIs, not local cubic Béziers.
- Every motion has one reduced-motion path registered in `reduced-motion.css`.
- Tests assert direction, distance, or ownership rather than exact millisecond
  values.
- Typecheck, lint, unit, production build, e2e, and desktop manual verification
  pass.
