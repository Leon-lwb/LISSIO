# 前端分层范式（实现层 / 交互层 / 效果层 / 视图层）

<!-- lissio-doc
status: maintained
owner: Lissio maintainers
last-reviewed: 2026-10-07
language: zh-CN
authoritative: false
translation-of: docs/architecture/ui-layers.md
applies-to: Non-authoritative Chinese translation backup
-->

> 中文翻译备份；对应的英文源文件为权威版本。若中英文不一致，以英文为准。
> Chinese translation backup. The English source is authoritative; English controls in case of conflict.

前端结构的唯一权威。依赖方向由 `pnpm check:layers` 强制，规则编号与本文件的 §3 一一对应。
动效细节不在本文件，见 §6 的交叉引用。

## 1. 为什么需要分层

前端此前只有约定、没有模型：`pnpm check:architecture` 与 `check:deps` 只管 Rust，
前端的结构约束只剩注释和评审。后果不是"代码变丑"，而是三类具体故障：

1. **反向依赖不报错，只让下一次改动多一层惊讶。** `widgets/` 里 import 一个
   `displays/` 的状态条组件，单看那一行完全合理；代价要等到有人想单独复用控件层时
   才出现。没有任何测试会因此变红。
2. **职责会沿着反向依赖回流。** 一旦"控件 → 窗口面板 → store"这条链路被建立，
   状态模块就会把整个显示层拖进模块图，直接制造循环。面板注册表因此拆成元数据面
   （`lib/panels/`，实现层）与视图面（`components/panels/registry/`，视图层）——
   拆分理由是模块图，不是语义。
3. **"统一范式"无从谈起。** 注册表、绑定、原语一旦被视图里的实现细节污染，
   每加一个控件就要重新决定一次"这次怎么写"。

所以分层必须是**可执行**的，不是倡议：方向写进门禁，越界即失败。

## 2. 四层模型

| 层 | 目录 | 职责 | 允许依赖 |
| --- | --- | --- | --- |
| **实现层** | `src/types/`、`src/lib/{rpc,platform,tauri,data,buffers,models,utils,panels}/`、`src/store/**`、四个注册表 | 数据形状、传输、缓冲、持久化、领域规则；不知道交互与像素 | 实现层 |
| **交互层** | `src/lib/interaction/`（手势、数值控件、滚动跟随、卸载、快捷键、异步动作）、`src/lib/hooks/`（数据绑定类） | 输入 → 意图；把指针 / 键盘 / 时间轴翻译成状态变更；只交出意图（如松手速度），不决定如何呈现 | 实现层 |
| **效果层** | `src/lib/motion/`、`src/lib/glass/`、`src/styles/{theme.css,components/motion.css,components/reduced-motion.css}` | 可见反馈：位移、时序、透明度、磨砂档位；把交互层交出的意图换算成动画数值 | 实现层、交互层 |
| **视图层** | `src/components/**` | 组合与渲染 | 全部三层 |

依赖方向单向：**视图 → 效果 → 交互 → 实现**。

判据是"这一层认不认识上一层"。`lib/motion` 可以接受 `distancePx: number`，但不能订阅
`settingsStore`——否则它就无法在非应用环境（测试、文档生成）里被调用
（`scripts/gen-motion-docs.mjs` 正是通过 Vite SSR 直接加载它来生成 `motion-tokens.md` 的）。

### 2.1 视图层内部的层级顺序

`src/components/` 内部同样有方向，越靠右越"叶子"：

```
ui/ brand/  →  common/ nodes/ layout/ onboarding/  →  panels/ acquisition/  →  displays/  →  widgets/<kind>/
```

两个关键约束：

- **`ui/` 与 `brand/` 是基础件，不得依赖任何领域目录，也不得直读 store。** 基础件靠
  props 变纯。唯一的例外是全局浮层单例（`ContextMenu`），见 §4 的登记表。读状态与画
  界面要拆开：节点错误浮标是纯展示件（收 `message`），取消息的
  `useCanvasNodeError` 住在交互层。
- **`widgets/<kind>/` 是叶子内容层。** 它只能被注册表引用，不得反过来引用
  `panels/` / `displays/`。控件要能脱离完整应用外壳复用。

## 3. 机器规则（`pnpm check:layers`）

`scripts/check-ui-layers.mjs` 扫描 `src/**/*.{ts,tsx}` 的模块说明符（静态 `import` /
`export from` / 动态 `import()` / `require()`），解析相对路径后按目录前缀判定。
测试文件不计入——夹具与断言本就需要同时看见两侧，约束的是生产代码的方向
（与 `check-ui-tokens.mjs` 的 500 行上限同一口径）。

| 规则 | 内容 |
| --- | --- |
| **L1** | `components/{ui,brand}/**` 不得依赖任何领域目录（`common/nodes/layout/onboarding/panels/acquisition/displays/widgets/ai`） |
| **L2** | `components/{ui,brand}/**` 不得依赖 `store/**` |
| **L3** | `components/widgets/**` 不得依赖 `{panels,displays,layout,acquisition,nodes,ai}/**` |
| **L4** | `store/**` 不得依赖 `components/**` |
| **L5** | `lib/{motion,glass}/**` 不得依赖 `store/**` |
| **L6** | `lib/{interaction,hooks}/**` 不得依赖 `components/**` |
| **L7** | JS 侧只有 `lib/motion/**` 可以写 `will-change` / `transition-property`（含 camelCase 与对象字面量） |
| **L8** | `lib/{rpc,platform,tauri,data,buffers,models,utils,panels}/**` 不得依赖 `components/**` |
| **L9** | `.dialog-overlay` 不得声明 `z-index`——遮罩层级只来自调用方传入的桥接类 |
| **L10** | `lib/{motion,glass}/**` 不得依赖 `components/**` |
| **L11** | `lib/{interaction,hooks}/**` 不得依赖 `lib/{motion,glass}/**` |

**L7 的理由**：合成层晋升必须经过 `promote()` / `release()` 的引用计数。手写
`will-change` 等于永久占据一个合成层且无人归还；`will-change: opacity` 更会让元素成为
自己的 Backdrop Root，静默废掉后代的 `backdrop-filter`。

**L9 的理由**：`.dialog-overlay` 与 `layers.css` 的 `.z-*` 桥接类都是**未分层** CSS、
特异性同为 `(0,1,0)`，于是后出现的整条规则胜出。基础规则里留一个 `z-index`，调用方
传入的 `zClassName` 就被静默盖掉——属性传了、类也挂上了，只有层高不对：
`--z-modal-secondary`（110）和 `--z-tour`（1100）一起退化成 100，比 `@xyflow/react`
的选中节点（1000）还低，引导遮罩会被节点穿透。这条失效不会让任何测试变红，控制台也
不报错，所以必须在门禁里拦住。

**L10 的理由**：§2 写的是"效果层允许依赖实现层、交互层"，但反向的那条禁令此前没有
机器检查——`lib/motion` 去 import 一个组件不会被任何规则拦住。效果层要能在非应用环境
里被调用（`gen-motion-docs.mjs` 直接用 Vite SSR 加载 `spring.ts`），一旦它认识组件，
"这段动画能不能单独跑"就得读整棵组件树才能回答。

**L11 的理由**：交互层只产出意图，不认识动画。判据是"这一层认不认识上一层"——手势
说"松手速度是多少"（`GhostState.velocity`），效果层决定"因此滑多远、滑多久"
（`planRelease` 把速度换算成前冲位移、初速度与补间时长）。反过来让手势去调弹簧，
判定低动画偏好、把令牌翻译成数值这些纯动画的事就会住进输入处理里；断言手势的测试也
不得不同时准备动画环境。低动画**判定**（`motionIsReduced`）因此住在实现层
`lib/utils/reducedMotion.ts`——它是"用户要什么"的策略而非动画实现，手势、滚动跟随与
异步动作都要读它；效果层与调用方经 `lib/motion` 转发读取，写法不变。

**目录导入与文件导入同判**：门禁把相对说明符解析成 `src` 相对路径后，规则里的
`dir/` 前缀要求末尾有斜杠，而解析 `../motion` 得到的是 `src/lib/motion`（不带斜杠）。
两种形态都要试，否则 barrel 写法（恰恰是最常见的写法）整条绕过规则——这类漏检不会让
任何测试变红。

**违规的修法是改代码，不是加豁免。** 确属有界的例外登记在脚本的 `EXEMPTIONS` 表里，
每条写明"是什么 + 为什么这里有界"。这张表要短：**摆错位置**（目标本身是纯数据或纯
函数）不是加豁免的理由，搬到实现层即可消除，门禁的豁免数因此是分层质量的直接读数。
当前仅剩两条，且都不是搬迁能解决的：`ContextMenu`（全局浮层单例，渲染的就是
`contextMenuStore` 的内容，没有 props 可传）、`connectionRules`（连接规则必须与节点
注册表的端口声明同源）。

**同一个形状两级拆分**：效果层要按参数判定档位、但不能订阅 store，交互层能订阅 store、
但不能引用效果层。于是"档位输入的形状"落在实现层（`types/glass.ts`），效果层接收它
（`useGlassSurface({ appearance })`），交互层把它绑到 store（`lib/hooks/useGlassAppearance.ts`）。
两侧都只依赖实现层，谁也不需要认识对方。

## 4. 注册表：四处，一个契约

| 注册表 | 位置 | 键空间 | 未知键策略 |
| --- | --- | --- | --- |
| 控件 | `components/widgets/registry.ts` | `WidgetKind`（29） | 编译期穷举 `{ readonly [K in WidgetKind]: WidgetDef<K> }` |
| 面板·元数据面 | `lib/panels/panelDefs.ts` | `PanelKind`（12） | 编译期穷举 |
| 面板·视图面 | `components/panels/registry/panelViews.tsx` | 同 `PanelKind` | 编译期穷举 |
| 画布节点 | `components/nodes/registry.ts` | `CanvasNodeType`（4） | `nodeDefinition()` 抛错——只对内部穷举的调用者开放 |

共同契约：

- **唯一权威在后端。** 控件 kind 的业务权威是后端 `kind::widgets`；端口权威是
  `describe_node_documents`（前端不本地回退，见 `nodes/WidgetNode.tsx`）；面板的
  `tabType` / `category` / `labelKey` / `dataPlane` / `binding` 镜像后端 `PanelDescriptor`，
  运行时由 `panels/registry/reconcile.ts` 比对并显式暴露分歧。
- **一处声明，多处派生。** `DataTabIcon`、`DataPanelsPanel`、`widgetTab.ts`、
  `dataTabs.ts` 的菜单条目与轮转都从 `PANEL_DEFS` 派生，不各自维护平行表。
- **面板必须同时有 store 动作。** 独立面板新增一项目录条目而没有对应的
  `dataTabs` store action，就是一个死条目——`store/__tests__/dataTabs.test.ts` 钉死这条。
- **视图面必须保持 eager。** `panelViews.tsx` / `panelViewComponents.tsx` 依赖模块级常量
  元素的引用相等来实现兄弟 Tab 的 memo bailout，改懒加载会破坏 Tab 隔离
  （见 `docs/architecture/web-exit.md` §5.6）。唯一的 `React.lazy` 声明点是
  `src/components/lazy/lazyComponents.ts`，由 ESLint 强制。

`WidgetDef` 的字段语义：

```ts
interface WidgetDef<K extends WidgetKind> {
  kind: K;
  Component: ComponentType<WidgetComponentProps<K>>;
  Properties?: ComponentType<WidgetPropertiesProps<K>>;  // 缺省 = 仅通用字段
  icon: LucideIcon;
  labelKey: string;
}
```

- 控件组件是**纯内容**：不画卡片外壳。节点框由 `WidgetNode` 提供，停靠外壳由
  `DockCardFrame` + `PanelLivenessProvider` 提供。
- **"节点里画什么"与"有没有窗口"是两件独立的事**，不要合成一个枚举：
  - **窗口**：`PANEL_DEFS` 里存在以该 kind 为 `hostWidgetKind` 的条目（9 个：`Waveform` /
    `Spectrum` / `RawData` / `PieChart` / `Image` / `Model3D` / `TableView` / `Command` /
    `FrameDecoder` / `Trigger`）。
  - **节点占位**：`def.Component` 渲染的是 `NodePlaceholder`（8 个 kind），真身在
    `displays/**` 并经 `PANEL_VIEWS` 到达。这不是遗漏，是声明：画布上的节点只是入口。
  - 两者**不等价**：`PieChart` / `Image` 的节点里就是真身，同时也能开窗口；而占位的
    8 个 kind 必然有窗口——否则节点点不出去，控件等于不可用。这条单向蕴含是要守的
    不变量，由 `widgets/__tests__/registry.test.ts` 断言。
- **`ports` 不是 `WidgetDef` 的字段。** 端口唯一权威在后端；前端自己声明端口会造出
  第二份真相。历史上这里有一个从未被任何 def 实现的 `ports?()` 与配套的
  `WidgetPortSet`，属于死代码。

新增一个控件 kind 要动 8 个地方：`types/widgets.ts` 的联合类型、`widgets/<kind>/def.ts(x)`、
控件组件、（可选）`XProperties`、`registry.ts`、`lib/utils/widgetSize.ts`、中英文
`i18n/resources/{zh,en}/widgets.yml`、`src/test/modelCatalog.ts` 的 `WIDGET_TEST_KINDS`。
后三处与注册表的一致性由 `widgets/__tests__/registry.test.ts` 强制。

## 5. 交互层与效果层的边界

这两层最容易互相渗透，判据只有一条：**谁拥有状态**。

- **交互层拥有意图，不拥有像素。** 手势原语回答"用户拖了多远、多快、跨过阈值没有"，
  输出语义量（`dx` / `velocity` / `value`）；它不写 `style`，不知道 `transform` 是什么。
- **效果层拥有可见表达，不拥有意图。** 它接受距离与时序参数，输出位移 / 透明度 / 档位；
  它不读指针事件，也不订阅 store。

三个由此推出的约定：

1. **一个属性只能有一个写者。** JS 补间写 `transform` 时，CSS 的
   `transition: transform` 必须让位——否则浏览器在**帧之间**再插值一次，把 150ms 的弹簧
   抹成 300ms 的爬行。`src/lib/motion/compositor.ts` 的 `promote()` 在借走 `transform`
   期间把 `transition-property` 挂起，归还时原样写回。这就是 L7 存在的理由。
2. **入场可以回弹，退场一律临界阻尼。** 退场带过冲会读成"没走干净"。
   `BASE_TIMING` 的每个 `out` 相位 `bounce` 都是 0，由测试断言。
3. **降级不等于关闭。** 手写 `matchMedia`、Tailwind 的 `motion-safe:` 变体都会造出
   第二套 reduced-motion 权威；唯一的查询入口是 `motionIsReduced()`，唯一的 CSS 登记处是
   `reduced-motion.css`。

`MotionPresence` 与 CSS keyframe 兜底的关系：**同一个元素只能被一个驱动。**
需要"播完退场再卸载"的表面必须用 `MotionPresence`（CSS `animation` 无法阻止 React
卸载）；`motion-*-in/exit` 只留给没有 `MotionPresence` 的实例。

## 6. 交叉引用

本文件管**结构与方向**。以下文档各自管一块细节，不重复：

| 文档 | 管什么 |
| --- | --- |
| [ui-motion.md](ui-motion.md) | 10 条动效规则、模块职责表（频率 / 成本 / 边界） |
| [motion-tokens.md](motion-tokens.md) | 时序令牌数值表，由 `pnpm docs:motion` 生成，勿手改 |
| [motion-spatial-plan.md](motion-spatial-plan.md) | 动效改造清单与三个验收问题（从哪来 / 走多远 / 为什么这样动） |
| [ui-color-tokens.md](ui-color-tokens.md) | 颜色 / 透明度令牌与磨砂档位 |
| [web-exit.md](../architecture/web-exit.md) §5 | 传输契约、启动链、懒加载规则 |
| [frontend-render-budget.md](../performance/frontend-render-budget.md) | 每帧成本预算与两个探针盲区 |

## 7. 不做的三件事

以下都是**书面决策**，不是遗漏；改它们需要先推翻理由：

1. **画布节点没有入场动效。** `.react-flow__node` 的 `transform` 归 React Flow 所有，
   批量创建会一次加十几个节点，逐个动画会抽搐。
2. **图表数据更新不做过渡。** 读数是测量结果，动画会误导读数。
3. **跨容器面板迁移（侧栏 ↔ 底部 ↔ 浮窗）瞬时完成。** 它跨越三套布局宿主，
   中间态没有统一的几何表达；这是已知且接受的成本。