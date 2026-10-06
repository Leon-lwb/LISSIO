# 统一浮层原语与交互契约收敛

<!-- lissio-review
date: 2026-10-06
scope: 关闭 2026-10-06-motion-token-single-source-and-dead-fallback 遗留项 4 中的"9 个关闭即卸载模态框"；12 个浮层调用点收敛到 DialogOverlay / DialogSurface，交互层新增焦点陷阱与 Escape 栈
reviewer: 维护者（Horldsence）
verdict: 通过
-->

修正 [2026-10-06-motion-token-single-source-and-dead-fallback.md](2026-10-06-motion-token-single-source-and-dead-fallback.md)
遗留项 4 里的"9 个关闭即卸载模态框"。原记录不修改，按此记录为准。

## 范围

- 12 个浮层调用点：`SettingsModal`、`ThemeEditor`、`UpdateChannelDialog`、`AboutModal`、
  `HelpCenterModal`、`KeychainPermissionDialog`、`BackupModal`、`UpdateDialog`、
  `DroppedInfoPopover`、`CustomWidgetHelpModal`、`CustomWidgetEditor`、`OnboardingWizard`、
  `EdgeEditDialog`；
- `src/lib/interaction/` 新增 `focusTrap.ts` / `useFocusTrap.ts` / `dismissStack.ts` /
  `useDismissOnEscape.ts`；
- `src/lib/motion/` 新增 `retention.ts` / `RetentionScope.tsx`，`useExitSnapshot` 进入公开面；
- `dialog.css` 的遮罩层级归属；`check-ui-layers.mjs` 新增 L9、L10。

## 结论

### 1. 每个浮层都自己写一遍生命周期

改动前"关闭即卸载"是 9 个模态框的共同写法：组件各自持有 `if (!isOpen) return null;`，
于是退场动画从来没有机会播完——`open` 变假的那一刻整棵子树就被摘掉。这也是
`motion.css` 里那几个离场兜底类零消费者的原因：CSS `animation` 无法阻止 React 卸载。

现在卸载时机由 `usePresence` 一处回答（"离场播完之前仍需渲染"），保活由
`RetentionScope` 的票据集回答。调用方只声明 `open`，不再自己判断该不该渲染。

`DialogOverlay` 在自己的 `RetentionScope` 里渲染主体，主体再用 `useRetention(busy)`
向外层领票，因此**内层浮层在播离场时会把外层一起留在树上**——设置面板里的主题编辑器
退场期间，设置面板不会先消失。

### 2. 两处缺陷是原语自己带来的，不是补调用点能修的

**(a) 遮罩上的键盘激活把整个面板关掉。** 原遮罩挂着 `role="button"` 与
`onKeyDown={activateOnKeyboard}`，而键盘事件会冒泡：在设置面板的搜索框里按回车，
事件冒到遮罩上被当成"点击遮罩"，整个设置面板关闭。这类缺陷在每个调用点复制一份，
修法只能是把"遮罩不是按钮"写进原语。遮罩现在不响应键盘，关闭只走 `pointerdown`
的自目标判定与 Escape。

**(b) 嵌套浮层各挂一个 window Escape 监听。** `ThemeEditor` 渲染在 `SettingsModal`
的遮罩**内部**，两者都监听 window，一次 Escape 把两层一起关掉。现在 `dismissStack`
是唯一监听者，只调用栈顶一项；栈序由 `DialogContext` 的深度决定，而不是挂载顺序，
所以"内层先关"与 DOM 顺序无关。

关闭意图改走 `pointerdown` 而非 `click` 同样是为了边界情形：`click` 的目标是按下与
抬起两点的公共祖先，在卡片里选中文字、在遮罩上松手会被判定为点击遮罩。

### 3. `open` 必须两端同源，否则票据永不归还

`KeychainPermissionDialog` 原本没有自持门控，由 `App` 用
`startupFlow.showKeychainPermissionPrompt` 决定是否渲染。迁移时它改成读 store 的原始
标志，引入两个真实缺陷：一是绕过启动串行（向导未结束就可能弹钥匙串授权），二是宿主
描述符的 `open` 与组件内的 `open` 一旦不一致，组件领的保活票据永远不会被归还，遮罩
将永久停在屏幕上。

修法是把它改成受控的 `isOpen` prop，由 `App` 传入门控后的值，并补一条"关闭后不渲染
卡片"的用例锁住两端同源。**不变量：组件的 `DialogOverlay open` 必须等于宿主描述符的
`open`。**

### 4. 两个 ref 必须落在同一个元素上

`DialogSurface` 同时被 `usePresence`（动画）与 `useGlassSurface`（磨砂）持有。两者
都读 `ref.current`，而且都是在 effect 里读，所以 `glass.ref(ref.current)` 是 effect
而不是回调 ref。它必须排在 `if (!busy) return null;` **之前**——`busy` 为假时提前返回
会跳过这个 effect，两个 ref 就此错位，重新打开时磨砂作用在旧节点上。

### 5. 引导遮罩需要一个不上色的变体

`OnboardingWizard` 原先是一个裸 `<div className="pointer-events-none fixed inset-0 z-tour">`，
压暗由 `TourSpotlight` 自己画——那是一块带镂空的 SVG mask（目标区域保持原色可见）。
换成 `DialogOverlay` 后，基础规则自带的 `background: var(--color-bg-overlay)` 会画在
镂空**下面**把洞填死。

调用点无法用工具类抵消：Tailwind 工具类位于 `@layer utilities`，而
`components.css` 里的这些文件是未分层的，同等权重下未分层胜出。所以新增了真实的
`.dialog-overlay--bare` 类。浏览器实测（纯绿底、遮罩下镂空处取色）：不带 `--bare`
是 `rgb(0,115,0)`（被压暗，镂空失效），带 `--bare` 是 `rgb(0,255,0)`（原色保留）。

### 6. `zClassName` 曾经完全不生效

`.dialog-overlay` 原先自带 `z-index: var(--z-modal)`，而 `layers.css` 的 `.z-*`
桥接类也是 `z-index`。两者都是未分层 CSS、特异性同为 `(0,1,0)`，于是**后出现的整条
规则胜出**，而 `.dialog-overlay` 在源序里更靠后。

后果是静默的：属性传了、类也挂上了，只有层高不对——`--z-modal-secondary`（110）与
`--z-tour`（1100）一起退化成 100，比 `@xyflow/react` 的选中节点（1000）还低，
引导遮罩会被选中节点穿透。没有任何测试会因此变红。

修法是从基础规则里删掉 `z-index`，层级只从显式桥接类来。浏览器实测（真实 Tailwind
管线）：`z-tour` → 1100、`z-modal-secondary` → 110、默认 → 100，且
`pointer-events-none` 与 `--bare` 的透明底都仍然生效。同时新增门禁规则 **L9**：
`.dialog-overlay` 不得声明 `z-index`。注入故障实测——把 `z-index` 加回去，门禁立刻
非零退出并指向该行。

顺带补上 **L10**：`lib/{motion,glass}/**` 不得依赖 `components/**`。§2 写的是
"效果层允许依赖实现层、交互层"，但反向的那条禁令此前没有机器检查，效果层 import 一个
组件不会被任何规则拦住。当前没有违规（注入故障实测能拦住）。

### 7. 交互层第一次有独立的原语

`focusTrap.ts` 是纯函数（不引 React），`useFocusTrap` 只负责在 `active` 期间安装监听。
焦点陷阱挂在**根元素**上而不是 document，并且 `trapTabKey` 先看
`event.defaultPrevented`：键盘事件由内向外冒泡，内层陷阱处理过的 Tab 必须让外层放手，
否则一次 Tab 会把焦点从内层拽出去。这里用 `defaultPrevented` 而不是
`stopPropagation`，因为"已有人接管"是事实，不是路由。

`useFocusTrap` 由 `active`（即 `open`）驱动而非挂载驱动——被保活的浮层不能一直劫持
Tab，也不能在关闭后把焦点抢回去。

### 8. 关闭时载荷会被调用方清空

多个调用点用哨兵值表示"没在编辑"：`EdgeEditDialog` 的 `setModal(EMPTY_MODAL)`、
`UpdateChannelDialog` 的 `setPendingChannel(null)`、`CustomWidgetEditorContainer` 的
`closeCustomEditor` 清 `widgetId`。保活窗口里这些值已经是空的，于是屏幕上会滑出一个
空壳。`useExitSnapshot` 记住最后一个非空值解决这一点；判据必须是 `null` / `undefined`，
空串与 `0` 都是真实内容——这条有专门的用例。

### 9. 验证

`npx tsc -b`（`src/` 无诊断）、`npx eslint src/ --max-warnings 0`（exit 0）、
`check:tokens`、`check:motion`、`check:layers`、`check:docs`、`check:architecture`、
`check:web-contract`、`check:contracts`、`check:model-catalog`、`check:deps`
全部通过；`npx vitest run` 173 文件 / 1192 用例全绿。

新增测试：`focusTrap.test.ts`（17）、`retention.test.tsx`（13）、
`dismissStack.test.ts`（9）、`Dialog.test.tsx`（13）。

关键断言都用注入故障验证过非平凡：去掉 `focusTrap` 的 `defaultPrevented` 判断、
把 `dismissStack` 的按深度插入改成按入栈顺序、把 `RetentionScope` 的存活条件改成
只看 `open`、让 `useExitSnapshot` 把空串与 `0` 当成已清空——各自都能让对应用例失败。

`Dialog.test.tsx` 覆盖的是原语契约而非某个调用点：关闭后遮罩与卡片都从 DOM 移除、
可以重新打开、Escape 只关最内层、外层关闭时内层跟着退场、遮罩空白处关闭而卡片内部
不关闭、关闭后 Escape 不再触发。为避免异步玻璃探测在用例结束后回写状态造成的
"not wrapped in act" 噪声，该用例 `vi.mock('liquid-gl')` 并注明原因；关掉低动画偏好的
那条用例专门覆盖保活窗口。

`.dialog-overlay` 的层级与配色无法用 jsdom 断言（无层叠计算），因此在真实 Chromium 里
用真实 Tailwind 产物逐项取 `getComputedStyle` 验证，探针产物已删除。

## 遗留项

1. **`pnpm build:web` 与 `pnpm dev:web` 在依赖解析上失败，与本次改动无关。**
   工作区里 `highlight.js` 被从 `10.7.3` 解到 `10.4.1`，而
   `react-syntax-highlighter` 的 `async-languages/hljs.js` 会动态 import
   `highlight.js/lib/languages/sql_more`，该文件在 `10.4.1` 中不存在。因此
   `docs/AGENTS.md` 硬性要求第 7 条（`pnpm dev:desktop` 实际点开验证）与
   `pnpm test:e2e` 本轮无法执行。需要把 `highlight.js` 固定回含 `sql_more` 的版本
   （或将 `sql_more` 显式 external）。
2. **`useFocusTrap` 的 React 层行为未被测试覆盖。** 已覆盖的是纯函数
   `focusTrap.ts`；"关闭后焦点还原""焦点已在内部时不抢"仍未断言。
3. **`DialogHost` 的按需加载与保留语义未被测试覆盖。** 首次打开才挂载、退场期间保留、
   关闭后的 `inert` 均无用例；`DialogOverlay open` 与宿主描述符 `open` 同源这条不变量
   目前只有 `KeychainPermissionDialog` 一个实例有用例锁定，没有全局检查。
4. **向导重开是从头开始还是接着上次。** 保留挂载意味着 `stepIndex` 会保留，
   `closeWizard` 也不重置它。若预期是"每次从欢迎页开始"，需要在关闭或重开路径上重置。
   本轮刻意未改。
5. **`usePresence` 的低动画分支显式压 `opacity: 0`** 是为了避免遮罩卸载前那一帧闪黑，
   该行为无测试覆盖。
6. 遗留项 2（离场方向 `-exitTo`）、3（`motion-tick-in` / `motion-icon-pop` 的
   `scale()` 字面量）沿用上一份记录，本轮未动。
