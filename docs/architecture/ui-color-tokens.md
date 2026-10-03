# 前端颜色 / 透明度 Token 表 (文字符号层)

> 单一来源: `src/styles/theme.css`。本表是人类可读索引, 与代码不一致时以 theme.css 为准,
> 并由 `pnpm check:tokens` (`scripts/check-ui-tokens.mjs`) 强制四处同步。
> 本文档同时是 `src/styles/components.css` 头注里 "token 表" 的落点。

## 分层

| 层 | 内容 | 归属 |
| --- | --- | --- |
| **文字符号层** | `text-*` 文字色、`opacity` 档位、`fill/stroke` 图标色、`state-*` 徽标 | 本文档 |
| 浮层/磨砂层 | 窗口、弹窗、菜单的表面、遮罩、阴影和 backdrop-filter | 本文档 `--frost-*` / `--shadow-*` |
| 面/边框/阴影层 | 非浮层 box-shadow 的 rgba、非徽标的整块背景色 | 各自组件内的既有定义 |
| 画布/终端 | `ctx.fillStyle`、ANSI 16 色 | `src/lib/ui/colorAlpha.ts` 与 `--term-*` |

## 透明度档位 (`--alpha-*`, 全仓唯一白名单)

数值为百分比; 同时经 `--opacity-*` 桥接成 tailwind 工具类 (变体全部可用)。

| 档位 | 值 | 工具类 | 语义 | TEXT_TONE_ALPHA |
| --- | --- | --- | --- | --- |
| `faint` | 15% | `opacity-faint` | 极弱 — 占位/几乎不可辨 | `0.15` |
| `subtle` | 40% | `opacity-subtle` | 弱 — 次要图标、辅助底纹 | `0.4` |
| `disabled` | 45% | `opacity-disabled` | 失活 — 禁用/未选中/断连 (收敛原 30/35/40/45/50/60 六档) | `0.45` |
| `muted` | 60% | `opacity-muted` | 中弱 — 空态提示、只读标签 | `0.6` |
| `secondary` | 75% | `opacity-secondary` | 中 — 次级正文 | `0.75` |

**显隐动画豁免**: `opacity-0` / `opacity-100` (含 `hover:`/`group-hover:` 变体) 不属颜色语义, 保持原样。

**禁用态标准写法**:

- 表单控件 → `disabled:opacity-disabled` (替代散落的 `disabled:opacity-30/40/50/60`)
- 非表单 (div/菜单项) 失活态 → 静态类 `opacity-disabled`
- 光标与交互抑制仍由调用方原有的 `disabled:cursor-* / pointer-events-*` 承担

新增档位须同步三处: theme.css `--alpha-*` + `--opacity-*` 桥接、
`src/lib/ui/textTone.ts` 的 `TEXT_TONE_ALPHA`、`scripts/check-ui-tokens.mjs` 注释。

## 浮层与磨砂 Token

设置、面板二级卡片、对话框、弹出菜单和悬浮读数必须使用统一基类，不在组件内拼装
`background + border + shadow + backdrop-filter`：

| 基类 | 用途 | 磨砂状态 |
| --- | --- | --- |
| `float-overlay` | Modal/Dialog 全屏遮罩 | 不磨砂 |
| `float-card` | 窗口、二级卡片、引导卡片 | `appearance.floatingGlass` |
| `float-popover` | 菜单、Popover、拖拽悬浮物、读数 | `appearance.floatingGlass` |
| `float-chrome` | 浮层标题栏/底栏 | 半透明 chrome |
| `float-chrome-muted` | 浮层侧栏/弱化区域 | 半透明 chrome |
| `frost-surface` | 面板内始终磨砂的表面 | 始终生效 |

核心 token：

| token | 默认值 | 用途 |
| --- | --- | --- |
| `--frost-blur` | `18px` | 所有磨砂表面共享的模糊基线 |
| `--frost-saturate` | `180%` | 所有磨砂表面共享的饱和度基线 |
| `--frost-alpha-floating` | `72%` | 二级卡片/弹窗背景强度，由 `floatingGlassOpacity` 注入 |
| `--frost-alpha-widget` | `47%` | Widget 亚克力背景强度，由 `acrylicOpacity` 注入 |
| `--frost-border` / `--frost-highlight` | 派生色 | 统一玻璃边缘与顶部高光 |
| `--frost-shadow` | 统一阴影 | 磨砂表面的玻璃阴影 |
| `--shadow-float` / `--shadow-popover` | 统一阴影 | 关闭磨砂时的窗口/弹窗阴影 |

`floatingGlass` 与 `acrylicBackground` 是两个独立开关；前者只控制浮层基类，后者控制窗口
背景和 Widget 亚克力。关闭磨砂时 `float-card` / `float-popover` 必须回退到实色且不保留
`backdrop-filter`。浮层底色使用 `--color-float-*` 的主题原色出口，不能直接引用会被
亚克力模式二次半透明化的 `--color-bg-*` 运行时值。

## 文字色档位 (`--color-text-*`)

### 基础角色

| token | 类名 | 说明 |
| --- | --- | --- |
| `--color-text-primary` | `text-text-primary` | 主文字 |
| `--color-text-secondary` | `text-text-secondary` | 次级文字 (默认弱化档) |
| `--color-text-bright` | `text-text-bright` | 高亮白 |
| `--color-text-inverse` | `text-text-inverse` | 反色文字 (实心强调底之上) — **白色文字一律用它, 不写 `text-white`** |
| `--color-text-disabled` | `text-text-disabled` | 禁用文字色 (纯色, 非透明度) |
| `--color-text-muted` | `text-text-muted` | 次要弱化 (= textDisabled 别名) |

### 次级文字透明度档位 (color-mix 派生, 随主题联动)

| 类名 | = | 用途 |
| --- | --- | --- |
| `text-text-secondary-faint` | secondary @ 15% | 底纹里的说明文字 |
| `text-text-secondary-disabled` | secondary @ 45% | 占位/禁用文字 |
| `text-text-secondary-muted` | secondary @ 60% | 空态提示、只读标签 |
| `text-text-secondary-hint` | secondary @ 75% | 次级正文提示 |
| `text-text-muted-faint` / `text-text-muted-hint` | muted @ 15/75% | muted 基色同构档位 |
| `text-text-primary-hint` / `text-text-inverse-hover` | primary/inverse @ 75% | 同上 |

> 用法: 元素上只写 `text-*` 工具类, **不再叠加 `opacity-*`** — 颜色层透明度只淡化文字本身,
> 不连带淡化同元素的图标/边框/背景。

## 语义状态文字色 (7 角色 × 4 档)

替代裸调色板 `text-red-400` / `text-amber-200` 等 — 基色取原始语义色 token, 随主题联动。

| 角色 | 基色 token | 文字类 (base / faint / muted / strong) | 徽标类 |
| --- | --- | --- | --- |
| danger | `--color-red` | `text-text-danger` `-faint` `-muted` `-strong` | `state-danger` |
| success | `--color-green` | `text-text-success` … | `state-success` |
| warning | `--color-yellow` | `text-text-warning` … | `state-warning` |
| info | `--color-blue` | `text-text-info` … | `state-info` |
| accent | `--color-accent` | `text-text-accent` … | `state-accent` |
| neutral | `--color-text-secondary` | `text-text-neutral` … | `state-neutral` |
| special | `--color-purple` | `text-text-special` … | `state-special` |

- `-faint` = 15% (底纹说明) / `-muted` = 60% (降级) / `-strong` = 混 30% 白 (悬停提亮或亮底上的浅色文字)
- `neutral` 替代裸 `text-zinc-*`; `special` 替代裸 `text-purple-*` (双角色徽标等)
- 7 角色的基色全部登记在 `src/settings/theme.ts` 的 `SEMANTIC_TOKEN_ALIASES`, 运行时注入 `:root`

## 语义徽标 (`@utility state-*`, theme.css)

**文字 + 10% 底 + 40% 边框 一套**, 替代成片的 `bg-red-500/10 text-red-300 border-red-500/40`
裸调色板拼装。底/边框用 `color-mix` 从 `currentColor` 派生 — 文字色定则底边自动跟随。

```tsx
<span className="state-danger px-2 py-1 text-[10px]">…</span>
// 支持变体: hover:state-warning / focus:state-info …
```

- 范围: **四边等宽**徽标/横条。仅下边框的 banner 不适用 —
  用 `border-b border-warning/30 bg-warning/10` 保留结构, 文字色走 `text-text-*`。
- 无边框的 chip (如状态标签) 用 `bg-success/15 text-text-success` (token + 透明度修饰)。
- 同元素不要再叠加 `text-*`/`bg-*` 颜色类 (`state-*` 自带颜色, 叠加会因层序互相覆盖)。

## 透明度修饰 (token + `/NN`)

徽标之外的底/边框淡色统一走 token + tailwind 透明度修饰 (经 `color-mix`, 随主题联动):

```
bg-danger/10  border-warning/30  ring-danger/60  bg-info/15  bg-success/15
```

固定中性色 `bg-white` / `bg-black` / `text-black` 经 `--color-white/white` 解析, 允许直用。

## TS 出口 (`src/lib/ui/textTone.ts`)

class 由数据/分支决定时用 helper, 不要手拼字符串:

```ts
textToneClass('danger', 'hover:')   // → 'hover:text-text-danger'
badgeToneClass('warning')           // → 'state-warning'
alphaVar('muted')                   // → 'var(--alpha-muted)' (canvas/内联样式)
TEXT_TONE_ALPHA                     // 档位白名单 {faint:.15, subtle:.4, disabled:.45, muted:.6, secondary:.75}
```

画布 (`ctx.fillStyle`) / 内联数值场景的唯一合成出口是 `src/lib/ui/colorAlpha.ts`
(`withAlpha` / `readCssColor` / `cssColorAlpha`)。

## 静态检查 (`pnpm check:tokens`)

| 规则 | 禁止 | 替代 |
| --- | --- | --- |
| opacity 档位 | `opacity-NN` (NN ∉ {0,100})、`opacity-[…]` | `opacity-{faint,subtle,disabled,muted,secondary}` / `disabled:opacity-disabled` |
| 调色板色阶 | `{text,bg,border,ring,fill,stroke,divide}-<色相>-<NN>` | `text-text-*` 语义角色 / `state-*` / token+修饰 |
| 白色文字 | `text-white` | `text-text-inverse` / `text-text-bright` |
| CSS 裸透明度 | `opacity: 0.NN` (@keyframes 除外) | `opacity: var(--alpha-*)` |
| 裸磨砂 | TS/TSX 中 `backdrop-blur-*` / `backdrop-filter` | `float-card` / `float-popover` / `frost-surface` |
| 磨砂参数 | CSS 中非 `--frost-*` 的 blur/saturate | `--frost-blur*` / `--frost-saturate*` |
| 四处同步 | `--alpha-*` ↔ `TEXT_TONE_ALPHA` ↔ `--opacity-*` ↔ 类名/token/别名 | — |

裸色相 (`text-green` / `bg-blue`) 经 `@theme` token 解析, **允许**; 禁的是带色阶的
`text-green-500` (tailwind 默认调色板, 不随主题联动)。


## CSS 文件与组件 Token 边界

`src/styles/component-tokens.css` 是组件局部视觉 token 的统一入口；`src/styles/theme.css`
继续拥有可被 ThemeEditor 运行时改写的主题 token。除这两个文件外，组件 CSS 不得出现
hex / rgb / hsl 颜色字面量，只能引用 `var(--*)`。

组件样式按 owner 拆到 `src/styles/components/<component>.css`，`src/styles/components.css`
只维护导入清单。前端生产 TS/TSX/CSS 单文件不得超过 500 行；`pnpm check:tokens`
同时检查颜色边界、文件上限和组件样式清单。
