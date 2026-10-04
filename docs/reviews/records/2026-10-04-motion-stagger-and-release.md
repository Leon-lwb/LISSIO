# 动效弹簧续作（错峰进场 / 拖拽释放动量）

<!-- lissio-review
date: 2026-10-04
scope: 错峰进场与拖拽释放动量交接两项改造；控件调色板死代码清理；motion 架构文档同步
reviewer: 维护者（Horldsence）
verdict: 有条件通过
-->

继续 `docs/architecture/motion-spatial-plan.md` 的待改造清单，本轮落地其中两项，并
修正该文档对控件调色板行的一处事实错误。

## 范围

| 项 | 内容 |
| --- | --- |
| 1 | 新增 `src/lib/motion/stagger.ts`：`staggerDelayMs()` 与 `useStaggerEntrance()`，按索引错峰并封顶；接入 AI 对话气泡（`AiChatPanel.tsx` / `AssistantBubble.tsx`） |
| 2 | 新增 `springAtWithVelocity()` 与 `springNoOvershootVelocity()`：阻尼谐振子非零初速度的闭式解，及不过冲边界 |
| 3 | 新增 `src/lib/motion/release.ts`：`planRelease(vx, vy)` 把松手速度换算成前冲位移、初速度与幽灵存活时长；`gsapSpring.ts` 接入 `initialVelocity` |
| 4 | `dockDrag.ts` 采样最近 90ms 指针位移算松手速度；`DockDragGhost.tsx` 改由 GSAP 弹簧补间驱动，位置从 `left/top` 移到 transform |
| 5 | 删除控件调色板行的死管道：`PaletteRow` 的 `entering`/`exiting`/`onEnterPlayed`、`widget-palette.css` 及其 import、`reduced-motion.css` 中的两处登记 |
| 6 | 文档同步：`ui-motion.md` 模块表与规则、`motion-spatial-plan.md` 状态 |

## 结论

| 清单项 | 结论 |
| --- | --- |
| 1.3 引用真实性 | `ui-motion.md` 模块表新增 `stagger.ts` / `release.ts` 两行，`spring.ts` 职责改为"非零初速度的解"，与 `src/lib/motion/` 实际文件一致；`motion-spatial-plan.md` 已具备的能力表同步补齐 `springAtWithVelocity` 与 `planRelease` |
| 2.1 许可证表述 | 未新增第三方依赖，未改动任何许可证字段或对外表述 |
| 2.6 对外表述 | 未涉及 |
| 3.3 元数据 | 本记录为新增记录，`docs/reviews/README.md` 索引表已追加一行 |
| 5.1 门禁 | `pnpm typecheck`、`pnpm lint:ci`、`pnpm test`（1050 用例 / 162 文件）、`pnpm build:web`、`pnpm check:docs`、`pnpm check:tokens`、`pnpm check:web-contract`、`pnpm check:contracts`、`pnpm check:model-catalog` 通过 |

### 事实修正

`motion-spatial-plan.md` 原先把"控件调色板行"列为错峰对象，暗示它已有进场动画。
核对后确认不是：`CategoryPanel.tsx` 一直硬传 `entering={false}` 且 `onEnterPlayed`
为空函数，`git log -S 'entering={!'` 无任何提交；`animate-palette-row` 仅被
`reduced-motion.css` 的降级清单引用。判定为早已失效的遗留管道，按代码为准处理，
本轮删除而非复活。

### 设计取舍（记录理由，避免后续重复讨论）

拖拽释放只取"甩得越狠滑得越远"，未取"甩得越猛起步越快"。在线性系统里航程正比于
初速度，要让航程增长慢于速度就必须让初速度增长，而初速度一旦越过
`springNoOvershootVelocity()` 就会过冲 —— 越过落点再荡回来的离场读起来是渲染
故障。故初速度钳在边界内，航程承担动量的表达。测试同时钉住边界内不过冲、边界外
确实过冲两侧，使该边界不至于被误当成任意常数。

## 遗留项

| # | 事项 | 依据 | 负责人 | 到期 |
| --- | --- | --- | --- | --- |
| 1 | 跨端 UI 改动未做运行时目视验证：`pnpm dev:desktop` 未执行，`pnpm test:e2e` 未在本轮运行。错峰与幽灵前冲的读感（尤其甩动阈值 `MOMENTUM_FLOOR_PX_S` 与航程上限）需在真实指针设备上确认 | 本记录「结论」 | 维护者 | 下次打开应用时 |
| 2 | 释放时长由 180ms 变为 `spatial/out` 的沉降时间（约 300ms），刻意放置的幽灵淡出因此变慢。若实测偏拖沓，应调 `BASE_TIMING.spatial.out` 而非在 `release.ts` 里另填常数 | `src/lib/motion/release.ts` | 维护者 | 下次调参时 |
| 3 | `motionSpring()` 的注释写着"Memoised because it runs per animation"，但实现没有缓存；每次调用都是一次 40 次二分 + 最多 4096 次采样。`planRelease` 每次释放要解两次。属既有缺陷，本轮未扩大改动范围 | `src/lib/motion/motionConfig.ts` | 维护者 | 下次动效性能专项 |
| 4 | 菜单项与时间线节点的错峰未做：菜单项只有 `motion-row`（悬停/按下过渡），本无进场动画，需先新写关键帧 | `motion-spatial-plan.md` 待改造节 | 维护者 | 下一轮 |
| 5 | 退场位移补偿所需的"哪些行正在退出"信息尚未确定来源，与错峰的索引口径不同源 | `motion-spatial-plan.md` 待改造节 | 维护者 | 下一轮 |