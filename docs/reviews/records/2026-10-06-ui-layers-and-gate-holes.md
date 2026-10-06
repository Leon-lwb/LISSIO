# 前端分层范式与门禁漏检修复

<!-- lissio-review
date: 2026-10-06
scope: 新增前端四层分层范式与 check:layers 门禁；修复 check:motion 的 camelCase 漏检与 check:tokens 的两处失效规则；删除死端口字段并钉死「节点占位 ⇒ 必有窗口」不变量
reviewer: 维护者（Horldsence）
verdict: 通过
-->

## 范围

前端此前只有约定、没有模型。`pnpm check:architecture` 与 `check:deps` 只管 Rust，
前端的结构约束只剩注释和评审，于是反向依赖可以自由生长而不让任何测试变红。本次评审
覆盖：

- 新增 `docs/architecture/ui-layers.md`（四层模型 + 8 条机器规则 + 注册表契约）与其
  索引登记；
- 新增 `scripts/check-ui-layers.mjs` / `pnpm check:layers`，并注册进 `package.json`、
  `scripts/check-all.sh` 的 `build_plan()`、`.github/workflows/build.yml` 的 quality job；
- 复核 `check:motion` 与 `check:tokens` 的既有正则，验证其覆盖是否真实；
- 复核 `WidgetDef` 的字段是否都有消费者。

## 结论

### 1. 分层从散文变成门禁

四层与单向依赖：**视图 → 效果 → 交互 → 实现**。判据是"这一层认不认识上一层"——
`lib/motion` 可以接受 `distancePx: number`，但不能订阅 `settingsStore`，否则它就无法在
非应用环境里被调用（`scripts/gen-motion-docs.mjs` 正是通过 Vite SSR 直接加载它生成
`motion-tokens.md`）。

`scripts/check-ui-layers.mjs` 扫描 `src/**/*.{ts,tsx}` 的模块说明符，解析相对路径后按
目录前缀判定 L1–L8 八条规则。三处实现要点：

- **测试不计入。** 夹具与断言本就需要同时看见两侧，约束的是生产代码的方向——与
  `check-ui-tokens.mjs` 的 500 行上限同一口径。首版把测试算进去后报出 3 条"违规"，
  全部是测试文件的正常跨层引用。
- **L7 覆盖三种写法。** `el.style.willChange = …`（赋值）、`{ willChange: … }`（对象
  字面量）、`setProperty('will-change', …)`。首版只认冒号形式，验证时发现
  `el.style.willChange = 'transform'` 能静默通过——门禁自身的漏洞，已修。
- **动态 `import()` 在扫描面内。** 注入 `import('../../store/appStore')` 确认被抓。

每条豁免写明"是什么 + 为什么这里有界"；标 `movable: true` 的是**摆错位置**而非真正需要
反向依赖（目标本身是纯数据或纯函数，搬走即可消除）。当前 16 条豁免里 13 条属于这一类。

### 2. `check:motion` 认不出 camelCase 的 `transitionProperty`

原内联样式正则 `transition(?:-property)?\s*:\s*` 匹配不到 camelCase 拼写，于是
`style={{ transitionProperty: 'width 200ms' }}` 可以静默通过——而 L7 想拦的正是它。
收紧后同时认对象字面量、赋值与模块常量三种写法，并且：

- 值是不可静态求值的成员表达式（`a.b.c`）或 TS 原始类型名时跳过，否则会把
  `compositor.ts` 里 `transitionProperty: element.style.transitionProperty` 这类正常
  的状态读写误报为违规（首版确实报了 3 条假阳性）。
- 值是同文件内的字符串常量时解析后判定。**`TourSpotlight.tsx` 的豁免项此前从未被触发过**
  ——它的内联过渡值是模块常量 `GEOMETRY_TRANSITION`，值不是字面量。把豁免临时摘掉后现在
  报出 8 条，证明这条豁免是活的。

验证：注入 4 种写法（camelCase 对象字面量、`flex-grow`、常量解析出的 `left`、
`el.style.transition = 'max-height …'`）全部被抓；仓库现状仍为绿。

### 3. `check:tokens` 的 `stripKeyframes` 吃掉了所有声明体

原实现"遇到任何 `{` 就进入跳过态"，于是把**所有**规则的声明体都挖空了。后果不是潜在风险
而是既成事实：紧跟其后的两条规则——裸 `opacity:` 必须走 `--alpha-*`、`backdrop-filter`
必须走 `--frost-blur/--frost-saturate`——在整个仓库里从未命中过任何一条规则。改成显式匹配
`@keyframes <name> {` 再配平花括号后，注入 `opacity: 0.37` + `backdrop-filter: blur(9px)`
两条都被抓；关键帧内的 `opacity: 0.5` 仍然正确地豁免，行号也准确。

同一文件还有一处后缀匹配缺陷：时长白名单用 `rel.endsWith(w)`，而
`src/styles/components/reduced-motion.css` 以 `motion.css` 结尾，于是"禁止硬编码时长"
这条规则静默放它过去——它恰好是唯一一个**必须**硬编码时长的文件（把动画压到 1ms 就是
它的职责）。已改为精确路径匹配，并把该文件显式登记进白名单。

### 4. 死代码与一条新不变量

`WidgetDef.ports` 从未被任何 def 实现（29 个 def 逐一核对），端口权威早已迁到后端
`describe_node_documents`。与之配套的 `WidgetPortSet` / `WidgetPortDef` 也**只被这个死
字段引用**——两个导出类型零消费。三者一并删除。

规划阶段曾打算给 `WidgetDef` 加 `surface: 'canvas' | 'window'`，核对后发现**这个二分是
错的**：`PieChart` 与 `Image` 的节点里就是真身、同时也能开窗口。现实是两个独立事实——
"有没有窗口"（`PANEL_DEFS` 的 `hostWidgetKind`，9 个 kind）与"节点里是不是占位"
（8 个 kind）——之间只有单向蕴含。加枚举会制造一个与注册表并行的真相，于是不加字段，
改为在 `widgets/__tests__/registry.test.ts` 里钉两条不变量：节点占位的每个 kind 必须存在
宿主面板；宿主面板的 kind 必须已注册。

已验证第二条断言会真的失败：把 `Knob`（无宿主面板）塞进占位清单后测试立刻红，报
"Knob 在节点内是占位, 但 PANEL_DEFS 里没有对应的宿主面板"。

### 5. 门禁结果

`pnpm check:tokens`、`check:motion`、`check:layers`、`check:docs`、`typecheck` 全部通过；
`docs/README.md` 与 `docs/reviews/README.md` 已登记本次新增的两份文档。

## 遗留项

1. **13 条 `movable` 豁免尚未搬迁。** 门禁把位置与理由都记下来了，但搬迁本身会改动
   `widgets/` / `panels/` / `ui/` 的 import 面，需要单独一轮验证。涉及：
   `displays/common/NumericPortStatus.tsx` 归位 `widgets/shared/`；
   `panels/registry/{panelTypes,panelDefs}.ts` 移入 `lib/panels/`；
   `ui/fields.tsx`、`ui/SearchInput.tsx` 改 props；`useGlassSurface` 的设置解析上提；
   `lib/utils/{nodeDef,widgetTab}.ts` 的依赖改向。
2. **9 个模态框仍是"关闭即卸载"。** `if (!isOpen) return null` 让 `DialogSurface` 的
   `MotionPresence` 没有机会播退场，关闭是硬切；3 处还存在 CSS keyframe 与
   `MotionPresence` 同时驱动同一元素的双写（违反 `ui-motion.md` 规则⑨）。
3. **交互底座尚未抽取。** 手势有 6 份独立实现、滚动跟随有 3 份、数值控件语义在
   knob/slider/step-knob 三处重复；`src/lib/interaction/` 仍为空。
4. **第三套 reduced-motion 权威仍存在。** Tailwind 的 `motion-safe:` 变体（2 处）跟的是
   系统媒体查询，应用内的"减弱动效"设置关不掉它，与 `ui-motion.md` 规则⑥的单一权威冲突。
5. **`check:motion` 的 Tailwind arbitrary 值仍可能绕过。** 目前靠 `transition-[…]` 正则，
   值里含转义或动态拼接时不保证覆盖。
6. **`motion-*-exit` 五个 CSS 类零消费者。** 退场全部由 GSAP 承担，这些兜底类当前是死
   代码；保留还是删除需要与 `reduced-motion.css` 的登记一起决定。
