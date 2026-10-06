# 分层豁免清零与效果层输入端口

<!-- lissio-review
date: 2026-10-06
scope: 把 check:layers 的 EXEMPTIONS 从 16 条压到 2 条（13 条是搬迁即可消除的摆错位置）；为效果层建立「档位输入形状」，使 useGlassSurface 不再订阅 store；新增 types/glass.ts 与 lib/hooks/useGlassAppearance.ts；panelDefs/panelTypes 移入 lib/panels/；NumericPortStatus 移入 widgets/shared/；抽离 customWidgetDef 求值内核；删零消费者 GlassSurface.tsx。2026-10-06-interaction-extraction-and-motion-handoff 的 6 条遗留项均未关闭
reviewer: 维护者（Horldsence）
verdict: 通过
-->

## 范围

上次评审把交互层立起来并钉死「交互层不认识动画」。本次评审处理它的另一半：**分层门禁
的豁免表本身就是一份债务清单**。16 条里 13 条标着 `movable: true`——意思是"这是摆错
位置，搬一下就没"，而不是"这里真的需要反向依赖"。本次把这一批全部消掉：

- `EXEMPTIONS` 从 16 条压到 2 条，且**剩余 2 条全部不标 `movable`**；
- `components/displays/common/NumericPortStatus.tsx` → `components/widgets/shared/`（L3）；
- `components/panels/registry/{panelDefs,panelTypes}.ts` → `lib/panels/`（L4 + L8）；
- `components/ui/{fields,SearchInput}.tsx` 去除对 `appStore` 的直接读取（L2）；
- `lib/glass/useGlassSurface.ts` 不再订阅 `settingsStore`，改为接收档位输入（L5）；
- `lib/utils/nodeDef.ts` 依赖的纯函数 `evalCustomWidgetDef` 下沉到 `lib/models/`（L8）；
- 删零消费者组件 `lib/glass/GlassSurface.tsx`；
- 拆分 `ui/CanvasErrorTooltip.tsx` 的读状态与画界面两部分（L2）；
- 同步 `docs/architecture/ui-layers.md`。

## 结论

1. **豁免表的长度是分层质量的直接读数，`movable` 标记则是一份待还的债。** 13 条
   `movable: true` 说明当时的判断是"目标本身是纯数据/纯函数，只是被摆在视图侧"。
   把"摆错位置"和"真的需要反向依赖"混在同一张表里，会让豁免总数失去意义：16 这个
   数字既包含必须保留的边界，也包含本可以搬走的文件。**消完之后剩下的 2 条才有资格
   被称为边界**，而门禁输出现在直接印出"其中 0 条是摆错位置"。

2. **`NumericPortStatus` 搬到 `widgets/shared/`，7 个消费点的 import 一次改完。**
   它是纯展示件（状态标签 + 数值格式化），此前住在 `displays/common/`，而 7 个消费者
   全在 `widgets/` 下——L3 的违规正是"控件反向引用显示层"这个形状。搬迁后路径深度
   不变，文件本身逐字节未改；`displays/common/` 的其余内容不受影响。

3. **面板注册表的元数据面属于实现层。** `panelDefs.ts` / `panelTypes.ts` 只含
   `PanelKind` → 元数据的映射，没有 React 组件；视图面 `panelViews.tsx` /
   `panelViewComponents.tsx` 才传递引用整个显示层。两个面此前同住
   `components/panels/registry/`，于是 `store/slices/dataTabs.ts`（L4）与
   `lib/utils/widgetTab.ts`（L8）为了实现层的一份纯数据，不得不反向依赖视图目录。
   搬走元数据面后两个违规同时消失，视图面原地不动。

4. **搬迁暴露了一个类型归属错误：`WidgetKind` 定义在视图层。** 它是
   `WidgetConfig['kind']`，而 `WidgetConfig` 一直住在实现层 `src/types/widgets.ts`——
   于是"控件种类"这个后端契约的镜像，其唯一权威却是一个视图目录里的别名。门禁把
   这条逼出来了：`lib/panels/panelTypes.ts` 要么依赖 `components/widgets/registryTypes`
   （新造一条 L8），要么让 `src/types` 凭空多出一个成员。**修法是把定义放回它派生的
   位置**：`WidgetKind` 现在定义在 `types/widgets.ts`，视图侧的 `registryTypes.ts`
   改为转发。两处形状不可能再漂移（转发而非重定义）。

5. **`fields.tsx` / `SearchInput.tsx` 读 store 只为拿一个 `lang`。** 两者都只做
   `useAppStore((s) => s.lang)` 然后传给命令式 `translate(key, lang)`。而 `translate`
   的缺省参数就是 `currentLanguage()`——**这个读取本身是多余的**，改用
   `useTranslation()` 后既满足 L2 又更短。实测确认 `useTranslation` 不依赖外部
   provider（`react-i18next` 在 `i18n/instance.ts` 里已 `use(initReactI18next)`），
   且语言切换能触发重渲染：探针用例断言 `zh` 与 `en` 两次渲染的文本不同。

6. **`useGlassSurface` 的豁免是本次唯一需要新抽象的，而它其实是一处双向约束。**
   它读 `settingsStore` 才能定档位，但效果层不能订阅 store（L5）；同时交互层可以
   订阅 store、却不许引用效果层（L11）。于是**谁都不能同时做这两件事**：
   把绑定放进 `lib/hooks/` 会撞 L11，放进 `components/ui/` 会撞 L2（`Dialog` /
   `ContextMenu` 正在那里）。解法是把"档位输入的形状"独立出来放在实现层
   （`types/glass.ts`），效果层接收它（`useGlassSurface({ appearance })`），
   交互层把它绑到 store（`lib/hooks/useGlassAppearance.ts`）——两侧都只依赖实现层，
   彼此没有代码边。

7. **绑定按字段窄订阅，而不是按对象。** `useGlassAppearance` 走 `useShallow`，
   只取档位判定需要的 5 个字段。否则 appearance 每次更新都换引用，改一次字号会触发
   全应用玻璃表面重算档位——那是一次透镜重挂。原注释里"订阅面刻意收窄到三个字段"
   的意图由此保留在绑定侧，效果层只需声明形状。

8. **`GlassSurface.tsx` 是零消费者组件，已删除。** 它的文档说"绝大多数表面用这个组件
   而不是裸调 useGlassSurface"，但全仓库 `<GlassSurface` 只出现在它自己的文件里，
   三个真实调用点（`Dialog` / `ContextMenu` / `NotificationToasts`）全部裸调 hook。
   一个自称是主路径、实际无人使用的包装层，只会让后来者以为存在两种写法。

9. **`nodeDef.ts` 依赖的纯函数被关在 React 文件里。** `evalCustomWidgetDef` 是
   `new Function` + 形状校验，不含 React；它住在 `CustomWidget.tsx` 里，只为给
   同文件的一个 `useMemo` 用。`nodeDef.ts`（实现层）要用它就只能依赖视图。**抽到
   `lib/models/customWidgetDef.ts` 后，类型 `CustomWidgetDef` / `CustomWidgetRuntime`
   与两个守卫一起搬走**，`CustomWidget.tsx` 转发类型以保持既有导入路径可用。

10. **四条规则在豁免删除后逐条做了故障注入。** 把代码改回违规形状，门禁必须变红——
    否则"清零"只是删了表格行。实测：L2（`fields.tsx` 重新 import `appStore`）、
    L5（`useGlassSurface` 重新 import `settingsStore`）、L8（`nodeDef.ts` 重新
    import `CustomWidget`）、L4（`dataTabs.ts` 重新 import 视图侧 `panelDefs`）
    四条全部按预期报错，报出文件与行号。恢复后门禁回到绿色。

11. **`build:web` 在搬迁过程中没有回归。** 面板注册表移动涉及 `store` / `lib/utils`
    / `components/{layout,panels,displays,widgets}` 共 13 个消费点，逐个核对深度
    （测试文件与生产文件的相对深度不同，`__tests__/` 多一层）。`pnpm typecheck`
    与 `build:web`（9.92s）均通过。

12. **`WidgetKind` 转发的写法是 `import type` + `export type` 分开。** 只写
    `export type { WidgetKind } from '../../types'` 会让同文件里 `WidgetComponentProps`
    等签名找不到名字——转发不等于引入。两个语句都要有。

13. **`panelTypes.ts` 头部注释里"再拆分"的说法已随搬迁更新。** 原文写"既有代码刻意
    规避该循环，见 dataTabs.ts 的 widgetTabTypeOfKind 注释"——那个规避已经变成结构
    事实（元数据面在实现层），继续留着会让人以为循环仍然潜在。

14. **`docs/architecture/ui-layers.md` 的三处更新。** ①第 15 行示例引用的
    `panels/registry/panelTypes.ts` 已不存在，改为指向"元数据面 / 视图面"这条原则；
    ②注册表表格里 `panelDefs.ts` 的路径；③§3 段末补上"豁免表要短"的判据与当前 3 条
    各自的不可搬迁理由，并记录"同一形状两级拆分"的做法（效果层要形状、交互层要绑定，
    形状落实现层）。

15. **`CanvasErrorTooltip` 的豁免理由与代码不符，属于把两个职责当成一件事。** 登记
    的理由是"它必须读编译错误状态才能定位到节点；把它改成 props 会让每个节点自己订阅
    编译状态，成本高于收益"——但代码里这两件事**早就分开**了：`CanvasErrorTooltip`
    收 `message: string | null` 这个 prop，读 store 的是另一个具名导出
    `useCanvasNodeError(id, tabId)`，而 `NodeFrame` 本来就在逐节点调用它。"改成 props"
    因此没有代价可言：节点侧的订阅一个没变。**真正入门的只是把一个文件拆成三处**——
    纯展示件留在 `components/ui/`（现在只 import React）、取状态的 hook 移入
    `lib/hooks/useCanvasNodeError.ts`、纯函数 `compileErrorMessage` 移入
    `lib/models/`（它本来就被 `CompileErrorItem` 从 `ui/` 里反向借用，而那是显示层
    向基础件借实现层的活）。
    **教训**：豁免理由会和代码一起腐烂。这条理由写在"还没有 hook、组件自己订阅"的
    时刻，之后拆分发生了而理由没更新，于是它读起来仍然合理、实际早已不成立。豁免表
    值得在每次评审时逐条对照代码复核，而不只是数数。

16. **为 `compileErrorMessage` 补了 8 例分支测试。** 函数是 `switch` 带 `default`
    兜底，新增一个 `kind` 时编译器不会提醒，界面上只是少一句话（退回 'Compile error'）。
    测试逐分支钉住文案。故障注入验证：把 `port_not_found` 的"指向别的节点"分支改成
    兜底、把 `output ? 'Output' : 'Input'` 读反，两次注入各让 1 条用例变红。

17. **`vitest` 不类型检查，`port_not_found` 的夹具因此漏了必填字段。** 夹具写成
    `{ kind: 'port_not_found', node_id, port, output }`，而该分支还有必填的 `edge_id`；
    测试全绿，`pnpm typecheck` 报三条 TS2345。**这就是 typecheck 必须与 test 分开跑
    的理由**——vitest 走 transpile-only，类型错误不进它的视野。

18. **全量前端质量面通过。** 9 个静态门禁（`check:tokens` / `check:motion` /
    `check:layers` / `check:docs` / `check:architecture` / `check:web-contract` /
    `check:contracts` / `check:model-catalog` / `check:deps`）全部通过；
    `pnpm lint:ci`（零警告）、`pnpm typecheck`、`vitest run`（181 文件 / 1292 例）、
    `pnpm build:web`（11.32s）、`pnpm perf:check` 均通过；`test:e2e` 7 例通过；
    `cargo fmt --check`、`cargo clippy --workspace --all-targets`、
    `cargo test --workspace`（1515 例）均通过。

## 遗留项

1. **剩余 2 条豁免都不是搬迁能解决的，且已无 `movable` 标记。**
   `ContextMenu`（全局浮层单例，渲染的就是 `contextMenuStore` 的内容，没有 props 可传）、
   `connectionRules`（连接规则必须与节点注册表的端口声明同源）。两者的理由都写在门禁
   表里。**若将来想把它们也清零，需要的是新的抽象（如把"当前浮层内容"做成可注入端口），
   而不是搬迁。**

2. **`usePresence` 的低动画分支仍未直接断言**（沿用前两次评审的遗留项）。

3. **`DialogHost` 的按需加载仍未直接断言**，其保留语义由 `retention.test.tsx` 覆盖。

4. **向导重开是否接着上次的步骤未改**：保留挂载意味着 `stepIndex` 保留，
   `closeWizard` 不重置它。

5. **`useScrollFollow` 的层归属边界情形未变**：它读写 `scrollTop`（严格说属于渲染
   结果），这里按"滚动跟随是输入意图映射"归入交互层。

6. **`cargo deny check` 仍未在本机跑通（环境问题，非仓库问题）。** 见
   2026-10-06-interaction-extraction-and-motion-handoff 遗留项 6 的完整描述。
   `cargo fmt --check`、`cargo clippy --workspace --all-targets`、
   `cargo test --workspace`（1515 例）均通过。

7. **`pnpm dev:desktop` 仍受沙箱限制起不来**（Tauri log 插件要写
   `~/Library/Logs/top.pengheng.lissio`，该路径在文件沙箱外）。涉及 UI 的验证是用
   浏览器端点的等价路径完成的，不是桌面壳本身。
