# 前端渲染预算门禁

用真实浏览器计量前端交互的**每帧渲染成本**，并在回归时阻断提交。

覆盖 `panel-drawer`、`palette-scroll`、`canvas-drag` 三个交互场景。

另有两类成本**不由本门禁计量**，改由静态检查拦：`pnpm check:motion` 管逐帧布局
动画，`pnpm check:tokens` 管磨砂的结构性预算。理由见文末。

```bash
pnpm test:perf      # 只计量：真实浏览器逐场景采样，落盘 output/perf-frontend/raw.json
pnpm perf:check     # 只判定：与已提交基线比较，回归则非零退出
pnpm perf:baseline  # 覆盖基线（仅在确认改动是有意为之时使用）
bash scripts/perf-gate.sh   # 上面两步的组合，CI 与 check:all 调用的就是它
```

## 为什么门禁只卡"每帧速率"，不卡帧率

这是本设计唯一需要解释的取舍。

交互卡顿的**成因**几乎都是"每帧重复做了重活"，而不是"帧率低"。给
`canvas.width` 赋值会重新分配并清空整块位图；逐帧 `setAttribute` 刷 SVG 属性；
逐帧 `getBoundingClientRect` 在写 DOM 之后读布局，强制同步布局。这些都是**代码
的性质**：同一份代码在任何机器上，每帧做多少次都是同一个数量。

而帧率、帧时间分位、长任务时长是**时序量**，无头 Chromium 没有真实 vsync，
帧间隔由 BeginFrame 调度器决定，共享 CI runner 的负载会直接改写它们。实测同一
份代码两次运行，`fps` 从 57.5 漂到 58.1。把这种量做成硬门禁的必然结局是团队
学会无视红灯，然后门禁就死了。

所以分工是：

| 类别 | 例子 | 是否门禁 | 理由 |
| --- | --- | --- | --- |
| 每帧速率 | 每帧属性写入次数、每帧强制布局读次数 | **是** | 与机器无关，回归时精确失败 |
| 每帧重分配 | `canvas.width` 赋值次数 | **是**（绝对值卡 0） | 不存在"合理次数" |
| 时序 | fps、帧时间 p95/max、长任务、JS 堆 | 否 | 随 runner 负载漂移，只记录供看趋势 |

时序量照常写进产物。趋势要看真的帧率，得在桌面端实测。

### 探针看不见的两类成本

这个探针打的是**主线程原型**，所以下面两类成本对它的每个计数器都不可见。它们不是
"测不准"，是压根不在同一条线程上。把它们的结论算到本门禁头上是范畴错误。

**1. CSS 过渡触发的布局重排。** `transition: flex-grow` 在这里量出来是 0，代价却是
每帧一次整棵面板子树的重排——它发生在浏览器 C++ 里，不经过任何 JS。想在浏览器里
量它，只能改用 Paint/Raster 追踪，而那是时序量，本文档开头就说了不能做门禁。

所以这类缺陷改成静态判定：`pnpm check:motion` 枚举全部 `transition` 声明、
`@keyframes` 帧属性与 Tailwind 的 `transition-[...]`，只允许绘制层属性。纯静态、
零浏览器成本、评审时看得见，而且能抓到探针抓不到的东西。

**2. `backdrop-filter`（磨砂/高斯）。** 它在**合成器**里做。原先的 `gaussian-budget`
场景拿"亚克力开/关的帧间隔 p95 之差"当预算，实测差值 `2.27e-13 ms`——这不是"模糊很
便宜"的证据，而是**测量饱和**的证据：无头 Chromium 的 BeginFrame 锁 60Hz，两侧都被
量化到同一根 16.7 ms 栅格上，亚克力多花 1 ms 还是 3 ms 都被抹平了。一个量不出来的东西
不能拿来支持"不要削减视觉强度"这种结论，因此该场景已删除。

磨砂成本改为**结构性预算**（`pnpm check:tokens`）：模糊半径、底色透明度、嵌套深度、
背后是否逐帧失效，全部可以从源码确定性地推出，不需要跑浏览器。真机 GPU 代价仍需桌面
端实测。

## 计量怎么做到零业务改动

性能缺陷几乎都长得像一行无害的代码。把计数器塞进业务组件，等于给这些调用留一个
永久的常驻开销，也会诱使人去优化"探针数字"而不是真实成本。

因此探针在 `addInitScript` 里打**原型**：`HTMLCanvasElement.prototype` 的
`width`/`height` 访问器、`Element.prototype.setAttribute`、
getBoundingClientRect`、`getComputedStyle`、`requestAnimationFrame`，以及一个
`longtask` PerformanceObserver。业务代码写法完全不变，探针只存在于测量会话中。

计量与判定分成两个脚本，因此同一份原始数据可以反复重放：**"这次红灯到底是代码
变了还是机器热了"**可以靠重放 `raw.json` 复查，而不必重跑浏览器。分工与
`bench-audit.sh` / `bench-collect.mjs` 对 Criterion 的做法一致。

产物（`output/`）与基线（`docs/performance/frontend-perf.json`）分开存放：前者是
本次运行的数字，不进版本库；后者必须提交，否则 CI 里的 `--check` 会因找不到基线
而静默跳过。注意 `docs/experiments/` 是 gitignore 的，基线不能放那里。

## 场景

| 场景 | 驱动方式 | 要抓的病因 |
| --- | --- | --- |
| `panel-drawer` | ActivityBar 切换停靠面板 | 一次性布局提交 + MotionPresence 退场 + 让位 FLIP |
| `palette-scroll` | 逐段滚轮推进长列表 | 逐帧滚动处理，以及滚动中 sticky 表头每帧重新模糊 |
| `canvas-drag` | 节点画布指针拖拽 | 画布类交互的逐帧成本 |

`canvas-drag` 带命中测试：若目标点被浮层遮挡就明确跳过并写明原因，不往基线里写
一个名不副实的数字。

## 基线数字

每帧速率，门禁项。`panel-drawer` 一行是修复前后对照，其余两行未受该改动影响：

| 场景 | `setAttribute` | `getBoundingClientRect` | `getComputedStyle` |
| --- | --- | --- | --- |
| `panel-drawer`（2026-10-04） | 93.79 | 5.47 | 2.07 |
| `panel-drawer`（2026-10-05） | 71.59 | 3.56 | 2.07 |
| `canvas-drag` | 33.7 | 4.4 | 1.02 |
| `palette-scroll` | 33.4 | 5.13 | 1.01 |

抽屉开合原先走 `transition: flex-grow`，是全样式表唯一的布局过渡，每帧让整个面板组
重排一次。现在宽度只提交一次，让位由面板组的 FLIP 承担（只写 `transform`）。

必须说清楚这组数字**证明了什么、没证明什么**：`setAttribute` 的降幅是真的，但它
量的是每帧 React 提交量，也就是这次改动的**副作用**。真正删掉的那笔开销——每帧一次
面板子树重排——这个探针从头到尾都看不见（见上文"探针看不见的两类成本"）。降幅可以
当作改动生效的旁证，不能当作收益的度量。

预算已随之收紧：`setAttribute` 上限从 120 降到 90，把这次改善锁住。

`setAttribute` 的前几名是 `path[d]` / `path[fill]` / `path[class]`，来自
lucide-react 图标在每次 React 提交时重发属性。它是重渲染成本的信号，而不是某个图标
实现的瑕疵——所以修法是减少重渲染，不是去改图标组件。

### 尚未覆盖

- **SpectrumChart 画布拖拽**。`SpectrumChart.tsx` 的绘制路径已把后备存储分配拆到
  只依赖尺寸的独立副作用（原先每次 `mousemove` 都重分配一次位图），但当前没有场景
  驱动它——`canvas-drag` 命中的是节点画布（ReactFlow），不是频谱控件。要真正锁住
  这条修复，需要能在 CI 里搭出"FFT 求解器 → 频谱控件"的工作区。
- **真机 GPU 合成开销**。无头通常走软件光栅，本门禁量化的是主线程侧 CPU 成本。
  亚克力在真机上的 GPU 代价需要桌面端实测——这正是删掉 `gaussian-budget` 之后
  仍然欠着的一笔账，结构性预算只能防"白付钱"，不能替代实测。
- **主线程与合成器线程的相互阻塞**（真机上"动画掉了但主线程空闲"的情形）。本门禁
  在架构上就看不见这类问题：它只打主线程。