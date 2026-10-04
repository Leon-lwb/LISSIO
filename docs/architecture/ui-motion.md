# Frontend motion system

动画统一由 `src/lib/motion/` 与 `src/styles/components/motion.css` 管理。
时序是**物理弹簧**而非三次贝塞尔, 完整数值表见 `motion-tokens.md`;
尚未落地的界面改造清单见 `motion-spatial-plan.md`。

## 模块

| 模块 | 职责 |
| --- | --- |
| `spring.ts` | 阻尼谐振子的闭式解、解析速度、非零初速度的解、按实测路程拉伸时长。无 DOM 依赖 |
| `motionConfig.ts` | 唯一的时序意图来源 (`BASE_TIMING`)。五个家族 × 进场/离场 |
| `reducedMotion.ts` | 低动画模式的唯一权威源, 把系统偏好与应用内设置合并成一个根类 |
| `easingTokens.ts` | 把弹簧采样成 CSS `linear()` 缓动, 写入 `<html>` 内联样式 |
| `gsapSpring.ts` | GSAP 插件, 逐帧用同一个求解器求值, 让 JS 补间与 CSS 过渡完全一致 |
| `compositor.ts` | 引用计数的 `will-change` 预算, 动画结束即释放图层 |
| `presence.ts` | 浮层角色的几何: 从哪来、到哪去、缩放原点在哪; 停靠边的锚点推导 |
| `dockFlip.ts` | 面板组内换边的 FLIP: 测量矩形、扣掉在途位移、弹簧送回原位 |
| `stagger.ts` | 按索引错峰的进场延迟, 带上限封顶; 低动画下完全退化为零延迟 |
| `release.ts` | 松手速度换算成释放计划: 前冲位移、初速度、幽灵存活时长 |
| `MotionPresence.tsx` | 可卸载浮层的进场/退场生命周期 (退场播完才卸载) |
| `useMotionPresence.ts` | 仅进场, 用于退场由 DOM 负责的表面 |

停靠面板 (侧边栏与 AI 面板的 left / right / bottom) 由
`components/layout/DockedPanel.tsx` 组装: 宽度收拢交给 `docked-panel.css` 的
`flex-grow` 过渡, 透明度与进场交给 `MotionPresence`, 换边交给 `useDockReorder`。
一次开合因此拆成三段, 各自用各自最合适的手段。

## 家族

按"移动了屏幕多少"排序, 不按组件类型 —— 新增界面时不需要新增家族。

| 家族 | 职责 |
| --- | --- |
| `control` | 悬停 / 按下 / 聚焦, 短到无感 |
| `toggle` | 开关 / 旋钮 / 滑块的通断翻转 |
| `content` | 列表行 / 消息 / 提示 / 通知 |
| `surface` | 有锚点的浮层: 对话框 / 菜单 / 气泡 |
| `spatial` | 大尺度空间迁移: 停靠面板 / 浮动窗口 / Dock |

进场允许回弹 (到位的物体会沉降), 离场恒为临界阻尼 (离开的物体不该晃)。

## CSS 基元

- `motion-control`: 高频按钮与工具栏的即时反馈, 只改颜色/边框/阴影。
- `motion-row`: 列表行与菜单项的位移与颜色反馈。
- `motion-surface`: 模块卡片与 Widget 卡片的表面状态变化。
- `motion-float`: 对话框 / 气泡等浮层的透明度、位移、缩放与阴影过渡。
- `motion-pill`: Tab 指示器的几何移动。
- `motion-switch`: 不重挂载内容的 Tab / 模式切换容器。
- `motion-transition`: `transition-all` 的替代品, 属性集合显式钉死。
- `motion-*-in` / `motion-*-exit`: 无 JS 时的降级关键帧。进场与离场刻意不同。

## 规则

1. 时长与缓动只来自家族令牌, 不允许新写 `cubic-bezier(...)`。
2. 位移优先 `transform`。`top/left/width/height` 会每帧触发布局。唯一的例外是
   停靠面板的宽度收拢: 抽屉开合是尺寸变化, 没有等价的 transform 表达, 且由
   用户主动触发 —— 见 `motion-spatial-plan.md`。
3. `will-change` 由 `promote()` 申请、`release()` 归还, 不长期写在样式里。
4. 复杂顺序、空间重排、拖拽惯性用 GSAP; 高频状态反馈仍交给 CSS transition,
   避免每次 hover 都创建 tween。
5. 任何新增动效都必须走 `motionIsReduced()`, 不允许自行查 `matchMedia`。
6. 新增的动效表面在 `reduced-motion.css` 的清单里**只登记一次**。
7. 浮层动画优先用 `MotionPresence` 而不是 CSS 关键帧 —— 只有它能保证
   "退场播完才卸载", CSS `animation` 无法阻止 React 立刻卸载节点。
8. 同一元素的动效不应同时被 CSS 关键帧与 JS 补间驱动, 否则会重复播放。
   停靠面板曾经是反例: 进场走 `ai-panel.css` 的方向性关键帧, 浮动窗口走
   `MotionPresence`, 两套路径并存。现在停靠面板统一由 `DockedPanel` 驱动,
   方向性关键帧已删除, 见 `motion-spatial-plan.md`。
9. 错峰延迟走 `--motion-stagger-delay` 自定义属性, **不要**写内联
   `animation-delay`。内联的 `animation-delay` 会盖过 `reduced-motion.css` 里的
   `animation-delay: 0ms` 降级声明, 自定义属性不会 —— 降级路径因此仍然只需要在
   清单里登记一次。
