# 控件面板粘性分区条的视觉改造

<!-- lissio-review
date: 2026-10-04
scope: 控件面板分类标题条去除色块，改为字缘发光 + 局部磨砂；亚克力关闭时保留原观感
reviewer: 维护者（Horldsence）
verdict: 有条件通过
-->

改造 `src/components/panels/widgetPalette/CategoryPanel.tsx` 的分类标题条。原实现是
`bg-bg-sidebar` 实色底板 + `border-b` 硬分隔线；由于侧边栏根容器同为 `bg-bg-sidebar`，
底板本身并无对比，视觉上只表现为"遮住滚过的行"加"一根横切列表的实线"。

## 范围

| 项 | 内容 |
| --- | --- |
| 1 | `section-heading.css` 新增 `sticky-section-bar` 与 `sticky-section-bar-label`；亚克力开启时撤掉整条底色、分隔线与投影，只保留字缘发光与局部磨砂 |
| 2 | `component-tokens.css` 新增 `--color-shadow-sticky-bar{,-mid}` 与 `--text-shadow-sticky-bar-title` |
| 3 | `theme.css` 新增 `--frost-alpha-sticky-bar` |
| 4 | `CategoryPanel.tsx` 标题结构调整为 `label(icon + 标题 + 计数)` + `flex-1` 占位；计数由条的最右端移到标题之后 |
| 5 | `ui-color-tokens.md` 补记该基类与两条反直觉结论 |

## 结论

| 清单项 | 结论 |
| --- | --- |
| 1.3 引用真实性 | `ui-color-tokens.md` 的基类表与核心 token 表已补记；新增 token 均定义在 `component-tokens.css` / `theme.css`，组件规则只引用 `var(--*)` |
| 2.1 许可证表述 | 未新增依赖，未改动许可证字段或对外表述 |
| 3.3 元数据 | 本记录为新增记录，`docs/reviews/README.md` 索引表已追加一行 |
| 5.1 门禁 | `pnpm check:tokens`、`pnpm typecheck`、`pnpm lint:ci`、`pnpm test`（1050 用例 / 162 文件）、`pnpm build:web`、`pnpm check:docs`、`pnpm check:web-contract`、`pnpm check:contracts`、`pnpm check:model-catalog`、`pnpm test:e2e`（7 用例）通过 |

### 实测值（非推断）

Playwright 在真实 Chromium 中量得亚克力开启时的计算样式：条底色 `rgba(0,0,0,0)`、
条投影 `none`、字缘发光 `rgba(0,0,0,0.58) 0 0 1px` + `rgba(0,0,0,0.22) 0 0 3px`、
磨砂底色 `color(srgb … / 0.16)`、`backdrop-filter: blur(18px) saturate(1.8)`、
标签盒宽 96px / 条宽 189px（证明磨砂按内容收紧而非按整条）。亚克力关闭时回退为实色
`rgb(27,31,38)` + 1px 实线分隔线，与改造前一致。

### 过程中的三次误判（记录以免重犯）

1. **把"文字底部阴影"读成字形光晕**，随后又读成整条下沿投影。实际指的是标题条自身的
   底部；最终形态是"字缘发光"，且明确不带底板投影。
2. **以为浓度不够就调高**。方向反了：磨砂块背后是平色，`backdrop-filter` 对平色不起作用，
   唯一可见成分就是底色浓度，所以浓度越高越像色块。正确做法是把浓度压到 16%，可读性交给字缘发光。
3. **磨砂块挂在 `flex-1` 的外层 span 上**，于是 4 个字拿到 156px 宽的矩形。问题在几何不在浓度：
   带 `flex-1` 的 flex item 会被拉伸到占满剩余宽度，块必须挂在按内容收紧的内层元素上。

## 遗留项

| # | 事项 | 依据 | 负责人 | 到期 |
| --- | --- | --- | --- | --- |
| 1 | 未做 `pnpm dev:desktop` 运行时目视验证。上述实测通过 Playwright 在 Web 出口完成，桌面壳（WKWebView）下 `backdrop-filter` 与 `mask-image` 的表现未逐一核对；`mask-image` 已同时写标准与 `-webkit-` 前缀 | 本记录「结论」 | 维护者 | 下次打开应用时 |
| 2 | `--frost-alpha-sticky-bar: 16%` 与字缘发光的 `58% / 22%` 是当前观感下的取值，未做跨主题核对（浅色主题下平色背景更亮，磨砂更不可见，可能需要上调） | 本记录「结论」 | 维护者 | 切换浅色主题时 |
| 3 | 其余四处 `sticky top-0` 表头（`TableView` / `RecordingDatabaseView` / `CanSender` / `CompileResultsView`）未纳入本次改造。它们是数据表列头，实色底板在此合理 | `grep 'sticky top-0'` | 维护者 | 另行评估 |