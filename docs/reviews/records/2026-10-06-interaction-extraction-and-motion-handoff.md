# 交互层抽取与动画职责交接

<!-- lissio-review
date: 2026-10-06
scope: 抽取 lib/interaction/{dockDrag,useScrollFollow}；低动画判定下沉到实现层；松手契约反转为「交互层只交出速度」；修复 check:layers 对目录导入（barrel）整条漏检；新增 L11 钉死「交互层不认识动画」。2026-10-06-dialog-primitive-and-interaction-layer 的 6 条遗留项均未关闭，其中第 1 条（highlight.js 解析失败）仍然阻塞 build:web / test:e2e
reviewer: 维护者（Horldsence）
verdict: 通过
-->

## 范围

上次评审把 9 个模态框收敛到一个原语，并立起了 `src/lib/interaction/`。本次评审覆盖
那个目录的第二批内容，以及过程中暴露的一处门禁失效：

- 把 `src/lib/dockDrag.ts`（指针拖拽控制器）移入 `src/lib/interaction/dockDrag.ts`；
- 把 `src/components/displays/rawdata/useAutoScrollBottom.ts` 抽成与业务无关的
  `src/lib/interaction/useScrollFollow.ts`（含测试）；
- 把低动画判定 `motionIsReduced` 从 `src/lib/motion/reducedMotion.ts` 下沉到
  `src/lib/utils/reducedMotion.ts`，`lib/motion` 保持转发；
- 反转松手契约：交互层只交出速度，效果层推导动画数值并回报收尾；
- 新增 L11 规则、修复 `resolveSpecifier` 的目录导入漏检；
- 同步 `docs/architecture/ui-layers.md` 的分层表、规则表与理由段，以及
  `docs/architecture/ui-motion.md` 的模块表。

## 结论

1. **交互层此前无法成立，因为它的成员依赖效果层。** `dockDrag.ts` 从 `lib/motion` 取
   `planRelease` / `ReleasePlan` / `motionIsReduced`，`useAutoScrollBottom.ts` 同样取
   `motionIsReduced`。把这两个文件搬进 `src/lib/interaction/` 就会让交互层反向依赖
   效果层，与范式方向（视图 → 效果 → 交互 → 实现）冲突。**这不是搬迁的副作用，而是
   搬迁暴露的既有事实**：搬迁前它俩住在视图层，反向依赖被"视图可以用全部三层"掩盖着。

2. **修法是把"意图"与"呈现"分开，而不是给交互层开豁免。** 松手时交互层只知道
   *指针有多快*，效果层才知道 *因此滑多远*。于是 `GhostState.release: ReleasePlan`
   变成 `GhostState.velocity: {x, y}`：前冲位移、初速度、时长全部由 `DockDragGhost`
   （视图 → 效果）在 `planRelease` 里推导。交互层与效果层之间从此没有代码边
   （实测：`src/lib/{interaction,hooks}/` 对 `lib/{motion,glass}` 零 import）。

3. **低动画判定属于实现层，不属于效果层。** 它是"用户要什么"的策略，不含任何动画
   实现；手势（两个数值控件）、异步动作、滚动跟随都要读它，却不都属于效果层。
   判定若住在效果层，这些调用点只能反向依赖效果层。下沉后 `lib/motion/index.ts` 与
   `motionConfig.ts` 继续转发，所有既有 `from '.../lib/motion'` 调用点写法不变。

4. **幽灵存活的权威只剩一个。** 从前交互层用 `setTimeout(release.durationMs)` 与
   组件的补间赛跑，两个数靠约定同步；现在补间走完即由效果层调 `endGhostRelease()`
   收尾，"动画结束"与"幽灵该消失"是同一时刻。`ghostEpoch` 随之删除 —— 它存在的
   唯一目的是让挂起的定时器失效，定时器没了它就没有意义。

5. **收尾是幂等的，且新拖拽会接管。** `begin()` 与 `__resetForTests()` 清空
   `released`，因此上一次释放的迟到收尾报告不会清掉正在拖的幽灵；`endGhostRelease()`
   对空状态无操作。这条由"新拖拽接管"与"收尾幂等"两条测试钉住。

6. **迟到订阅要补发释放态，否则幽灵会凭空消失。** `subscribeGhost` 在组件晚于松手
   挂载时曾补 `null`。改为优先补发 `released`。**反之收尾之后必须补 `null`** ——
   这一条容易被写漏，而故障注入（去掉 `released = null`）恰好能证明它的必要性：
   少了它，全套测试仍然通过 —— 也就是说"幽灵被永久复活且再也无人清除"曾是零覆盖。
   补上该用例后，同样的注入立即变红。

7. **`useScrollFollow` 是纯搬迁重命名，不是重设计。** `useAutoScrollBottom` →
   `useScrollFollow`，`AutoScrollBottomControl` → `ScrollFollowControl`，
   `ScrollTarget` 保持原名；算法、阈值（`AT_BOTTOM_PX` / `CATCH_UP_FACTOR` /
   `SNAP_DISTANCE_PX` / `WRITE_HISTORY`）、rAF 循环与全部中文注释逐字保留，
   总改动 10 行。唯一消费点 `RawDataView.tsx` 已同步。

8. **`dockDrag` 的公开面与 6 个投放区生产点全部保持。** 模块名不加 `pointer`- 前缀：
   它完全由 `data-dock-zone` 的 6 种取值与 store 动作构成，没有第二个消费方，把
   "dock 专用"写成"通用指针拖拽"会是名不副实的抽象。`begin` / `consumeClick` /
   `subscribeGhost` / `subscribeCanvasHover` / `registerCanvasHandler` / `isDragging` /
   `__resetForTests` 与 `GhostState` / `WidgetDragSpec` / `DockDragSpec` 签名不变，
   11 个消费点的 import 路径已更新。

9. **门禁 `resolveSpecifier` 对目录导入整条失明 —— 这是本次找到的第二个静默漏检。**
   解析 `'../motion'` 得到 `src/lib/motion`（不带尾斜杠），而所有规则的 `forbid`
   都是 `.../motion/` 前缀，于是 barrel 写法恰好绕过每一条规则。脚本第 265 行的注释
   自称"目录导入由 index.ts 兜底"——它兜的是解析，不是匹配。修法是两种形态都试：
   `src/lib/motion` 与 `src/lib/motion/release` 必须得到同一判定。修复后树仍是绿的
   （说明现存代码本来就没违规），但 L5 / L8 / L11 的故障注入全部由"通过"变为"拒绝"。

10. **StrictMode 下新机制成立。** `main.tsx` 开着 StrictMode，双重挂载会双跑订阅
    与收尾。实测幽灵照常出现、补间走完照常清除；已固化为测试。

11. **两个数值控件的手势内核已收敛到 `useNumericControl`。** `StepKnob.tsx`（离散档位,
    12px/档）与 `KnobWidget.tsx`（连续量程, 120px/全量程）此前各写一份"按下捕获指针 →
    记起始 Y 与基准 → 按位移换算 → 抬起释放"的代码，两份都各自持有 `dragRef`。内核抽到
    交互层后，**两个控件只剩"换算成什么值、何时提交"**：档位旋钮交出索引步进，量程旋钮
    在 `onEnd` 提交。两个换算比例成为 `NUMERIC_CONTROL_BEHAVIOR` 里的具名条目，
    `12` 与 `120` 不再散落在组件里。

12. **抽出来的是内核而不是控件。** 两个控件对"多指同时按下"的处理原本不同（档位旋钮
    完全不校验 `pointerId`，量程旋钮校验），收敛后统一按 `pointerId` 比对 —— 只有发起
    手势的那根指针能改值。**后果**：此前第二根手指按在同一旋钮上，会以第一根的起始 Y
    为基准换算，数值跳变。这条已由两个控件各自的用例钉住。

13. **换算比例有了可区分的断言。** 既有的"旋钮相对拖拽"用例只断言 `> 50`，
    12px 与 120px 两种比例都能通过（50 + 60/120×100 已被截断到上限，换比例也是上限）。
    补上"12px = 10% = 60"的精确断言后，把比例改成 12 或 240 都会让用例失败。

14. **这笔抽取是"修缺陷 + 单一权威"的账，不是行数的账。** 净增约 78 行（两个调用点
    合计 −30，hook 108 行含类型与文档）。行数上不划算，成立的理由是另外两条：其一，
    档位旋钮此前**完全没有 `pointerId` 校验**，第二根手指按在同一旋钮上会以第一根的
    起始 Y 为基准换算而跳值 —— 这是收敛过程中修掉的真实缺陷；其二，`12` 与 `120`
    两个换算比例此前各写在组件里，现在各是一个具名条目。运算次序逐字保持 HEAD 的
    `(dy / 120) * (max - min)`：换成 `dy * ((max - min) / 120)` 会差最后一个 ulp，
    这是不可互换的写法。

15. **未迁移的两处是有意保留的。** `SliderWidget.tsx` 用的是原生 `<input type="range">`，
    没有指针手势可共享；`waveformInteractionHooks.ts` 的 `usePanDrag` 是鼠标事件下的
    `dx`/`dy` 正交平移（分别是时间轴与电压轴），与"垂直位移调一个标量"不是同一形状。
    两者与 HEAD 逐字节一致。`lib/utils/numericControl.ts` 的 `snapControlValue` 照旧复用。

16. **`build:web` 的长期失败是一个声明范围错误，已从调用侧绕开。** 失败点不在本仓库代码：
    `@ant-design/x` 的包根 `es/index.js` 会 re-export `CodeHighlighter`，后者经
    `react-syntax-highlighter` 动态 import `highlight.js/lib/languages/sql_more`；那是
    上游自己声明 `highlight.js: ^10.4.1` 却用了 `10.7.3` 才有的文件。HEAD 的 lockfile
    恰好解到 `10.7.3` 因而从未暴露，依赖升级后才解到 `10.4.1`。
    **修法不改依赖**：`AiTurnProcess.tsx` 只用到 Think / ThoughtChain / XProvider，
    改为 `@ant-design/x/es/{think,thought-chain,x-provider}` 具名子路径后，不需要的
    CodeHighlighter 整条链路不再进构建。`build:web` 与 `test:e2e`（7 例）随之通过。

17. **交互改动用真实浏览器点过。** 起真实后端 + `dev:web`，在 Chromium 里走完：应用挂载、
    侧栏可见、设置对话框打开（`DialogOverlay`/`DialogSurface` 原语）、Escape 关闭
    （`dismissStack` 路径）、侧栏收放。构建产物 `dist/assets/AiChatPanel-*.js` 里
    `CodeHighlighter` 出现 0 次，确认那条链路确实没被打进去；Vite dev 侧 `AiTurnProcess.tsx`
    编译 200，运行时解析到 `@ant-design_x_es_think.js` / `@ant-design_x_es_thought-chain.js`。
    `pnpm dev:desktop` 本身在本机起不来（Tauri 的 log 插件要写
    `~/Library/Logs/top.pengheng.lissio`，该路径在文件沙箱外被拒），因此第 7 条是用
    浏览器端点的等价路径完成的，不是桌面壳本身。

18. **`e2e/sliding-pill.spec.ts` 的偶发失败已修，根因是采样在飞行途中就停了。**
    用例原先固定采 40 帧后再断言"落点"，而多个 worker 并行抢 CPU 时帧率会掉，
    40 帧可能刚好在点击生效前后耗尽 —— 于是被当成"落点"的其实是中途值，
    与目标的宽度差读出来是 −1.73（真实静止时的取整差只有 −0.359）。
    修法两步：①改用 `transform` 字符串判静止（逐帧精确、不经过取整，且在观察到位移
    之后才计数），采到静止或 5s 上限为止；②落点断言在同一时刻用渲染矩形对比
    （药丸位移是纯 transform，`offsetLeft` 恒为 0，比不了）。
    实测：单独跑 4 次全过，整套并行跑 **6 次全过**（修前是 5 次里失败 3 次）。
    顺带量清了那个子像素取整差 —— 逐个 tab 点过去，`|药丸宽 − tab 渲染宽|` 只有
    0.484 与 0.359，来自药丸取 tab 的 `offsetWidth`（整数）。
    涉及的两个文件 `SlidingPill.tsx`、`sliding-pill.spec.ts` 中，前者逐字节等于 HEAD。

## 遗留项

1. **`usePresence` 的低动画分支仍未直接断言**（沿用 2026-10-06-dialog-primitive-and-interaction-layer
   遗留项 5）。`useFocusTrap` / `useDismissOnEscape` 的 React 层行为已补齐用例：归还焦点
   给打开者（含 `preventScroll`、触发元素已移除、卸载）、焦点已在卡片内时不抢、
   `active` 为假时不装监听也不动焦点、Tab 限界；Escape 的激活/失活/卸载、嵌套只关最内层、
   重渲染不重排栈次序、同帧树序与深度相反时按深度选。其中"失活即不接管"这条由故障注入
   验证过：删掉 `!active` 判断会让 3 条焦点用例与 2 条 Escape 用例变红。

2. **`DialogHost` 的按需加载（首次打开才挂载）仍未直接断言**，其保留语义已由
   `src/lib/motion/__tests__/retention.test.tsx`（14 例）覆盖：持票期间已关闭仍渲染、
   全部交票才卸载、值清空后沿用最后一份非空值。`DialogOverlay` 关闭态的 `inert` 已补
   用例（去掉该属性即变红）。

3. **上一次评审的遗留项 4（向导重开是否接着上次的步骤）未改**：保留挂载意味着
   `stepIndex` 保留，`closeWizard` 不重置它。

4. **`useScrollFollow` 的层归属有边界情形。** 它读写滚动位置（`scrollTop` 属于渲染
   结果），严格说比"输入 → 意图"更靠近视图；这里按"滚动跟随是输入意图映射"归入
   交互层。若将来出现第二个消费方且语义分叉，应重新评估。

5. **`docs/architecture/motion-tokens.md` 与 `scripts/check-motion-css.mjs` 的改动属于
   动效令牌单一权威那条线，不在本记录范围内**；`pnpm-lock.yaml` 的依赖升级同理。

6. **`cargo deny check` 在本机跑不完，原因在环境而不在仓库。** 它要先取 RustSec 公告库，
   `~/.cargo/advisory-dbs/db.lock` 在只读路径上取不到排他锁（`attempted to take an
   exclusive lock on a read-only path`）；改用工作区内的 `CARGO_HOME` 后能过锁，但随后
   卡在公告库的 git 更新上（>13 分钟无输出，`git ls-remote` 本身可达，说明是 cargo-deny
   自身的更新路径）。**后果**：`docs/AGENTS.md` 硬性清单第 5 条里的 `cargo deny check`
   **未实际跑通**，其余三项（`cargo fmt --check`、`cargo clippy --workspace
   --all-targets`、`cargo test --workspace`）均已通过。此项需在有正常 cargo 缓存的
   环境复跑确认。
