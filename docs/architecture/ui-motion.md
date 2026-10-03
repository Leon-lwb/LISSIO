# Frontend motion system

动画统一由 `src/lib/motion/` 和 `src/styles/components/motion.css` 管理。

## Vocabulary

- `motion-control`: 高频按钮、输入框和工具栏的即时反馈，只改变颜色/边框/阴影，并提供约 1.5% 的按压缩放。
- `motion-row`: 列表行、菜单项和标签项，使用轻微位移与颜色反馈。
- `motion-surface`: 模块卡片和 Widget 卡片的表面状态变化。
- `motion-float`: Dialog、Popover、Toast 等浮层的透明度、位移、缩放和阴影过渡。
- `motion-pill`: Tab 指示器的几何移动。
- `motion-switch`: 不重挂载内容的 Tab/模式切换容器。
- `motion-overlay-in`、`motion-surface-in`、`motion-pop-in`、`motion-tick-in`: 统一的 CSS 入场关键帧。

`src/lib/motion/MotionPresence.tsx` 负责可卸载浮层的入场/退场生命周期，`src/lib/motion/useMotionPresence.ts`
负责单纯入场；它们使用 `@gsap/react`
的 `useGSAP()` 自动清理，并在 `prefers-reduced-motion` 或 `:root.reduced-motion`
启用时直接使用最终状态。高频状态仍由 CSS transition 驱动，避免每个 hover 都创建 tween。

## Rules

1. 位移优先使用 `transform`，不要动画化 `top/left/width/height`，Tab 指示器是低频例外。
2. 一次性入场不长期写入 `will-change`，只在动画期间由 GSAP/浏览器提升图层。
3. 复杂顺序、滚动联动、拖拽或可逆转场使用 GSAP Timeline / plugin；简单反馈使用 CSS。
4. 任何新增动画都必须同时遵守 `prefers-reduced-motion` 和设置中的 `reducedMotion`。
5. 动画速度由设置中的 `motionSpeed`（`fast` / `standard` / `relaxed`）统一控制；CSS 通过
   `data-motion-speed` 读取，GSAP 通过 `motionDuration()` 读取，二者共享同一档位。
