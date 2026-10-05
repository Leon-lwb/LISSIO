# 停靠面板退场的物理与时长

<!-- lissio-review
date: 2026-10-05
scope: 修停靠面板关闭时"原地淡出 + 邻居越过槽位回弹"的动效缺陷；发现 GSAP 弹簧插件从未生效并改接 ease 函数；补借用归还与 transform 单一写者两条不变量
reviewer: 维护者（Horldsence）
verdict: 通过
-->

起因是两个观感问题：停靠面板（侧边栏与 AI 面板）关闭时"不符合物理规律"，且退场动画
过慢。逐帧实测后确认了两处独立缺陷，其中第二处的严重程度远超预期。

## 范围

评审与修改的文件：

| 文件 | 内容 |
| --- | --- |
| `src/lib/motion/gsapSpring.ts` | 删掉从未生效的自定义插件，改用 GSAP 的 `ease` 函数 |
| `src/lib/motion/compositor.ts` | 借用期间接管 `transform` 所有权；新增 `BorrowSlot` |
| `src/lib/motion/flipReorder.ts` | 让位与拖拽幽灵改走 `springTween`；按元素持有借用槽位 |
| `src/lib/motion/presence.ts` | `DockPanelGeometry` 补退场收拢；新增 `exitVars` |
| `src/lib/motion/MotionPresence.tsx` | 新增 `exitTravel` / `exitScale`；借用归还 |
| `src/lib/motion/motionConfig.ts` | `spatial/out` 220ms → 150ms |
| `src/lib/motion/dockFlip.ts` | 面板组按变化原因选时序（换边 / 开合） |
| `src/lib/motion/useMotionPresence.ts`、`src/components/ui/DockDragGhost.tsx` | 借用归还 |
| `src/App.tsx`、`src/components/layout/DockedPanel.tsx` | 调用点与几何接线 |
| `e2e/docked-panel.spec.ts` | 断言退场真的朝所属边收拢 |
| `docs/architecture/{motion-tokens,ui-motion,motion-spatial-plan}.md` | 同步现状 |

## 结论

### 一、GSAP 侧的弹簧从来没有运行过

自定义插件注册名为 `springEase`，而补间传的是 `spring:`。GSAP 的 `_initTween`
只在 `vars` 的键名与已注册插件名一致时才调用该插件（`if (_plugins[p] && ...)`），
因此 `init` / `render` 一次都没跑：`tween.duration()` 没有被改写，补间退回 GSAP 默认的
**500ms + `ease: 'none'`，也就是匀速**。

后果是全 app 的 JS 侧动效 —— `MotionPresence` 的全部进出场、所有 FLIP 让位、拖拽释放
幽灵 —— 都在跑 500ms 匀速，而令牌层给的时长与过冲一次都没生效。只有 CSS 那一半
（经 `easingTokens` 烘焙成 `linear()`）是对的，于是同一份令牌在两侧读起来是两回事。
`motion-spatial-plan.md` 把匀速明确列为待改项，说的正是这件事。

`flipReorder` 当时连 `springTween` 都没走，直接把 `spring` 当普通 tween var 传出去，
所以它的过冲断言一直是绿的 —— 断言的是一个从未被使用的中间变量。

已改为把弹簧交给 GSAP 的 `ease` 函数（`_parseEase` 原生接受函数），并把 tween 时长设成
弹簧的沉降时间。这同时消除了插件 `render` 与 `_addPropTween` 争夺同一批属性，以及模块级
注册状态。`ensureSpringPlugin()` 与 `SpringEasePlugin` 一并删除。

`flipReorder.test.tsx` 里两处过冲断言改为采样补间真正使用的曲线 `vars.ease`，并新增一条
钉住"补间时长 = 让位弹簧的沉降时间"——只断言曲线的话，接线整段失效时它照样通过。

### 二、退场原本没有任何空间位移，且让位读错了时序

- `VARIANT_GEOMETRY.panel.displaces` 为 `false`，`travelVars(panel,'exit')` 只返回
  `{opacity: 0}`：面板在 230ms 里原地淡出，画面上没有任何位移。
- 宽度随后在 `onExitComplete` 里一步收掉，中央面板再由面板组 FLIP 让位 510ms，且用的是
  `spatial/in`（`bounce: 0.28`，按 300px 实测拉伸）—— **越过槽位约 4% 再荡回来**。
  开合本质是让位：面板组没动过，相邻面板的位置是被别人的缺席顶上去的，既没有来源也没有
  动量。仓库早已为此备好 `reflowSpring`，但 `dockFlip` 对换边与开合共用了一份时序。

现按三条修：

| 项 | 改动 |
| --- | --- |
| 退场几何 | `DockPanelGeometry` 补 `exitTo` / `exitScale`：朝所属 dock 边收缩到 0.9 并向外让出 10px，与进场互为镜像；底部面板收缩量压到 0.97（横跨整窗，横向收窄是错的读法） |
| 离场时长 | `spatial/out` 220ms → 150ms。关闭是"先播完退场才收布局"的串行两段，离场慢一点整个开合就被读成拖沓 |
| 让位分流 | `useDockReorder(container, layoutKey, sizeEpoch)` 按变化原因选时序：换边读 `spatial/in`，开合读 `reflowSpring`。分流函数 `dockYieldSpring()` 导出单测，钉的是阻尼比而不是毫秒数 |

底部面板的退场位移与收缩沿用与进场同一条理由（`enterScale` 0.99 vs 0.98），已在
`presenceDock.test.ts` 中成对断言。

### 三、`transform` 曾有两个写者

卡片表面为了 hover 抬升带着 `transition: transform`（`motion-surface`），而 JS 补间每帧
写一次 `element.style.transform`。两个写者并存时浏览器会在相邻两帧之间再插一次值：实测
面板透明度已降到 0.002 时，缩放才走到 0.954（目标 0.9）、位移才走到 -6.2（目标 -10），
150ms 的弹簧被抹成 300ms 的追赶。

`promote()` 借走合成层时一并接管 `transform` 所有权（写入
`transition-property: none`），归还时逐字写回借用前的内联值。

### 四、被打断的动画会永久泄漏借用

`@gsap/react` 的 `useGSAP` **只在卸载时调用上一次返回的 cleanup，依赖变化时不会调用**
（`deferCleanup` 分支）。而进场/退场互相打断时补间是被 `killTweensOf` 杀掉的，
`onComplete` 不触发 —— 那一层 `will-change` 与那份 `transform` 所有权就永远留在元素上。
在改动三之前这只会留下一个 `will-change`（性能隐患）；改动三之后它会**让元素彻底失去
CSS 过渡**（hover 失效）。实测：重开抽屉后 `transition-property` 一直是 `none`。

`compositor.ts` 新增 `createBorrowSlot()`：把"一段动画的借用"做成可替换的一格，新的一段
进来先归还上一段，于是无论正常播完还是被下一段打断，归还都恰好发生一次。四个动画入口
（`MotionPresence`、`useMotionPresence`、`flipReorder`、`DockDragGhost`）全部接入；
`flipReorder` 按元素各持一格。

浏览器实测：首次进场 / 关闭 / 重开 / 打断 / 连点 5 次之后，`transition-property` 与
`will-change` 均已归空。

### 五、实测数字（1440×900，侧边栏停靠左侧）

| 项 | 改动前 | 改动后 |
| --- | --- | --- |
| 退场时长 | 500ms（匀速，且无位移） | 153ms（`spatial/out` @10px，临界阻尼） |
| 关闭总时长 | ≈730ms | ≈370ms |
| 关闭时中央面板让位 | 510ms，越过槽位 ~4% 后回弹 | 179ms（`reflowSpring` @245px），单调不过冲 |
| 进场 | 500ms 匀速，无过冲 | 419ms，越过槽位 ~1px 后沉降 |
| 进场时中央面板让位 | 500ms 匀速 | 165ms，单调 |

关闭全程的数字来自 `e2e` 逐帧采样：透明度、缩放、位移三条曲线现在走**同一个**弹簧
（100ms 处分别为 0.089 / 0.909 / -9.1，即同进度），改动前缩放与位移明显落后于透明度。

### 门禁

`pnpm typecheck`、`lint:ci`、`test`（1086 通过，新增 17 条）、`build:web`、`test:e2e`
（7 通过）、`check:motion`、`check:tokens`、`check:docs`、`check:web-contract`、
`check:contracts`、`check:model-catalog`、`perf:check` 全部通过。`perf:check` 未改基线：
`panel-drawer` 的 `setAttribute` 72.86/帧（基线 72.15，预算 90）。本次未改动任何 Rust
文件，cargo 门禁不受影响。

## 遗留项

| 项 | 说明 | 负责人 | 到期 |
| --- | --- | --- | --- |
| 1 | 未做 `pnpm dev:desktop`（WKWebView）目视验证。逐帧数据与 Web 出口的观感已核对，桌面壳未打开 | 维护者 | 下次打开应用时 |
| 2 | `spatial/out` 由 220ms 降到 150ms 同时影响浮动 AI 窗口的关闭（此前两者共用同一令牌且都跑在失效的 500ms 上，实际观感需要重新看一眼） | 维护者 | 下次打开 AI 面板时 |
| 3 | 打断退场时的动量交接仍未做：入场途中关闭，弹簧从静止重新起步而不是带着当前速度继续。`springAtWithVelocity` 与 `springNoOvershootVelocity` 都在，`MotionPresence` 尚未把实时速度喂进去 | 维护者 | 需要时 |
| 4 | `travelVars` 的离场方向缺陷（`exitTo` 被取负）按既有记录保留未改；本次新增的 `exitVars` 不经该路径 | 维护者 | 需要时 |