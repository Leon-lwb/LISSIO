# 前端动效与磨砂成本治理

<!-- lissio-review
date: 2026-10-05
scope: 删除测不到东西的高斯预算；抽屉宽度改一次性布局提交 + transform 让位；新增动效属性门禁；磨砂成本改为结构性预算
reviewer: 维护者（Horldsence）
verdict: 通过
-->

起因是 `docs/performance/frontend-render-budget.md` 里的一条结论：亚克力开/关的每帧
差值约 `-0.0 ms`，因此"不要削减高斯效果的视觉强度"。复核后认定这条结论无效，于是重做
了动效与磨砂的成本治理。

## 起因：一门测不出东西的门禁

`gaussian-budget` 场景计算的是"亚克力开/关的**帧间隔 p95 之差**"。两处使它失效：

1. **测量饱和。** 无头 Chromium 的 BeginFrame 锁 60Hz，两侧都被量化到同一根 16.7 ms
   栅格上。亚克力多花 1 ms 还是 3 ms，这个差值看不见。实测 `2.27e-13 ms` 是浮点噪声的
   字面值，不是"模糊便宜"的证据。
2. **压根不在同一条线程上。** `backdrop-filter` 在**合成器**里做，而探针打的是主线程
   原型（`setAttribute` / `getBoundingClientRect` / `getComputedStyle`）。两者之间没有
   任何因果通路。

把这两点的结论写成"不要削减视觉强度"，等于用一个量不出来的东西给决策背书。场景已删除，
文档里那条结论一并撤下。

同一份复核还暴露了第二个盲区，性质不同：**CSS 过渡触发的布局重排不经过任何 JS**，它在
浏览器 C++ 里发生，因此对主线程探针完全不可见。`transition: flex-grow` 在探针里量出来
是 0，代价却是每帧一次整棵面板子树的重排。换句话说，**性能门禁绿并不代表没有逐帧布局
动画**。

## 范围

| 项 | 内容 |
| --- | --- |
| 1 | 删除 `gaussian-budget` 场景与 `perf-collect.mjs` 的对应归一/报告分支 |
| 2 | 删除 `docked-panel.css`（其唯一内容是 `transition: flex-grow`）与 `data-dock-state` |
| 3 | `DockedPanel` 改为：开立即提交宽度、关先播退场再收布局，让位交给面板组 FLIP |
| 4 | `App.tsx` 补中央面板与底部工作台的 `data-flip-key`（缺了它们就不在 FLIP 集合里） |
| 5 | 新增 `scripts/check-motion-css.mjs`（`pnpm check:motion`） |
| 6 | `flipReorder` 的 `promote` 只申请 `transform` 一层 |
| 7 | `ProgressBarWidget` 填充块改满尺寸 + `clip-path`；`NotificationToasts` 的 `max-height` 登记豁免 |
| 8 | `check:tokens` 增加磨砂结构性预算；`--frost-alpha-surface` 由 90% 降到 40% |

## 抽屉：开与关的时序为什么不对称

原先 `transition: flex-grow` 是全样式表**唯一**的布局过渡，每帧让整个面板组重排一次。
现在宽度只提交一次，让位由面板组的 FLIP 承担（`lib/motion/flipReorder`，只写
`transform`）。

不对称是拆开验证后的结论，不是设计上的随意：

- **开**：立即提交最终尺寸。卡片的第一帧是 `opacity: 0`（`MotionPresence` 的 `fromTo`
  在 layout 阶段同步设初值），于是"宽度瞬间到位"这一步被淡入完全遮住。
- **关**：**必须串行**。`react-resizable-panels` 给 Panel 强制 `overflow: hidden`，
  一旦先收布局，卡片当场被裁没，退场淡出将完全不可见——面板会"啪"地消失。因此先播
  退场，在 `onExitComplete` 里再收布局。

代价是实打实的：内容回位比原先晚约 0.22s（`spatial-out`）。这是接受该方案的已知成本。
`onExitComplete` 同时也是解除保活挂载的信号，收布局与拆挂载因此落在同一时刻，不会出现
"内容没了但位置还占着"的中间态。

## 为什么不用 clip-path 做抽屉的展开揭示

试过让展开也走"裁切揭示"（`clip-path: inset()`），结论是不行：**`clip-path` 会让元素
成为自己的 Backdrop Root**，落在它内部的 `backdrop-filter` 只采样自身，浮层磨砂随即静默
消失——与 `MotionPresence` 头注记录的 `will-change: opacity` 是同一类失效。抽屉本体正是
亚克力面，所以这条路被放弃，改为接受"淡入 + 兄弟滑开"的揭示语义。

同一理由下 `clip-path` **不进** `check:motion` 的全局白名单，只对
`ProgressBarWidget` 登记作用域豁免：那里它是替代 `width` 过渡的那条路径本身，且挂在
widget 卡片内部，不在任何磨砂表面之下。放行整个仓库等于把这道防线的钥匙挂在门把上。

`ProgressBarWidget` 选 `clip-path` 而不是 `scaleX`：`scaleX` 会把 `rounded-full` 横向
压扁成透镜。裁切保留填充块自己的圆角——起始端圆头、裁切线平口，正是进度条该有的样子。

## 新增门禁：`pnpm check:motion`

把"动画必须留在绘制层"从散文变成可执行的白名单。覆盖面刻意包含 Tailwind 的任意值，
因为 `transition-[width]` 能完整绕过纯 CSS 扫描（本次实测三处逃逸项）。

豁免登记表里当前三条（`TourSpotlight` 的几何过渡、`ProgressBarWidget` 的 `clip-path`、
`NotificationToasts` 的 `max-height`），每条都写明为什么这里的逐帧布局是有界的。豁免是
公开的、逐条可评审的；没有登记的一律报错。

## 结论

| 清单项 | 结论 |
| --- | --- |
| 1.3 引用真实性 | `frontend-render-budget.md` 的场景表与基线表已更新；`AGENTS.md` / `docs/AGENTS.md` 命令表已补 `check:motion` |
| 2.1 许可证表述 | 未新增依赖，未改动许可证字段或对外表述 |
| 3.3 元数据 | 本记录为新增记录，`docs/reviews/README.md` 索引表已追加一行 |
| 5.1 门禁 | `pnpm check:motion`、`pnpm check:tokens`、`pnpm typecheck`、`pnpm lint:ci`、`pnpm test`（1064 用例 / 164 文件）、`pnpm build:web`、`pnpm check:docs`、`pnpm test:e2e`（7 用例）、`pnpm perf:check` 通过 |

### 实测值（非推断）

`pnpm perf:check` 前后对照（每帧速率，门禁项）：

| 场景 | `setAttribute` | `getBoundingClientRect` | `getComputedStyle` |
| --- | --- | --- | --- |
| `panel-drawer`（改动前） | 93.79 | 5.47 | 2.07 |
| `panel-drawer`（改动后） | 71.59 | 3.56 | 2.07 |
| `canvas-drag` | 33.7（未变） | 4.4（未变） | 1.02（未变） |
| `palette-scroll` | 33.4（未变） | 5.13（未变） | 1.01（未变） |

**必须说清楚这组数字证明了什么、没证明什么。** `setAttribute` 的降幅是真的，但它量的是
每帧 React 提交量，也就是这次改动的**副作用**。真正删掉的那笔开销——每帧一次面板子树
重排——这个探针从头到尾都看不见。降幅可以当作改动生效的旁证，**不能当作收益的度量**。
这也是 `check:motion` 存在的理由：静态判定才是这类缺陷的唯一可靠抓手。

预算已随之收紧：`setAttribute` 上限 120 → 90，把这次改善锁住。

### 未验证项

| 项 | 说明 | 负责人 |
| --- | --- | --- |
| 1 | 未做 `pnpm dev:desktop` 桌面壳（WKWebView）运行时目视验证。抽屉的"淡入 + 滑开"揭示语义与关抽屉晚 0.22s 的回位延迟，Web 出口已逐帧验证（`e2e/docked-panel.spec.ts`），桌面壳下的观感未核对 | 维护者 | 下次打开应用时 |
| 2 | `--frost-alpha-surface` 由 90% 降到 40% 改变了 AI 输入区的实际观感，只做了结构性校验，未做视觉回归 | 维护者 | 下次打开 AI 面板时 |
| 3 | 真机 GPU 合成开销仍未实测。删除 `gaussian-budget` 后这笔账依然欠着，结构性预算只能防"白付钱"，不能替代真机数据 | 维护者 | 需要时 |
