# 前端颜色 / 透明度 Token 表 (文字符号层)

<!-- lissio-doc
status: maintained
owner: Lissio maintainers
last-reviewed: 2026-10-07
language: zh-CN
authoritative: false
translation-of: docs/architecture/ui-color-tokens.md
applies-to: Non-authoritative Chinese translation backup
-->

> 中文翻译备份；对应的英文源文件为权威版本。若中英文不一致，以英文为准。
> Chinese translation backup. The English source is authoritative; English controls in case of conflict.

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
| `frost-acrylic` | 通知 Toast、底部状态栏 | `appearance.acrylicBackground` |
| `sticky-section-bar` | 粘性分区标题条（行从其下方滚过） | `appearance.acrylicBackground` |

核心 token：

| token | 默认值 | 用途 |
| --- | --- | --- |
| `--frost-blur` | `18px` | 所有磨砂表面共享的模糊基线 |
| `--frost-saturate` | `180%` | 所有磨砂表面共享的饱和度基线 |
| `--frost-alpha-floating` | `72%` | 二级卡片/弹窗背景强度，由 `floatingGlassOpacity` 注入 |
| `--frost-alpha-widget` | `47%` | Widget 亚克力背景强度，由 `acrylicOpacity` 注入 |
| `--frost-alpha-sticky-bar` | `16%` | 粘性分区条标题的磨砂浓度，见下方说明 |
| `--frost-alpha-surface` | `40%` | 面板内表面（`.frost-surface`）的磨砂浓度，见下方说明 |
| `--frost-border` / `--frost-highlight` | 派生色 | 统一玻璃边缘与顶部高光 |
| `--frost-shadow` | 统一阴影 | 磨砂表面的玻璃阴影 |
| `--shadow-float` / `--shadow-popover` | 统一阴影 | 关闭磨砂时的窗口/弹窗阴影 |
| `--text-shadow-sticky-bar-title` | `1px + 3px` 双层 | 粘性分区条标题的字缘发光 |

`floatingGlass` 与 `acrylicBackground` 是两个独立开关；前者只控制浮层基类，后者控制窗口
背景和 Widget 亚克力。关闭磨砂时 `float-card` / `float-popover` 必须回退到实色且不保留
`backdrop-filter`。浮层底色使用 `--color-float-*` 的主题原色出口，不能直接引用会被
亚克力模式二次半透明化的 `--color-bg-*` 运行时值。

### 粘性分区条：为什么浓度反而低

`sticky-section-bar` 是唯一一处**故意不给整条底色**的粘性表面。它背后是面板的一整片
平色，而平色经 `backdrop-filter` 模糊与提饱和后没有任何变化——磨砂在这里真正能被看见
的成分只有底色浓度一项。由此有两条与直觉相反的结论：

- **浓度必须压低。** 浓到能看见，磨砂块就重新读成一块深色圆角底板，比任何阴影都抢眼。
  `16%` 只够让"行穿过时被化开"发生，标题的可读性交给 `--text-shadow-sticky-bar-title`。
- **磨砂块必须按文字排版。** 它挂在 `inline-flex` 的 `.sticky-section-bar-label`（图标 +
  标题 + 计数）上，而不是外层 `flex-1` 的 span 上；挂错的话 4 个字的标题会拿到一块
  156px 宽的矩形，与浓度无关地读成色块。计数也必须紧跟标题，才能一起落进这块磨砂。

字缘发光的衰减剖面是"字缘最强、快速归零"，半径全部压在 1px / 3px。加一层 7px 的远距
弥散会从"字缘发光"变成"发亮的描边"，比磨砂还显眼。

### 面板内表面：模糊半径与透明度必须成对看

`.frost-surface`（AI 输入区）不挂任何开关——亚克力与浮层玻璃都关掉时它照样生效。

这里曾经把 `--frost-alpha-surface` 定在 `90%`，与 `18px` 的模糊半径配在一起。那是**全价
付费却换不到东西**：底色越接近不透明，`backdrop-filter` 的结果与实色相差越少，而模糊
的成本照付。`backdrop-filter` 只在底色足够透时才看得见，所以半径与透明度必须成对调整，
而不是各自取一个"看起来合适"的值。现在是 `40%`。

磨砂的成本**不在浏览器里量**。原先有一个 `gaussian-budget` 场景拿"亚克力开/关的帧间隔
p95 之差"当预算，实测差值是 `2.27e-13 ms`——那不是"模糊便宜"的证据，而是测量饱和：
无头 Chromium 的 BeginFrame 锁 60Hz，两侧都被量化到同一根 16.7 ms 栅格上。更根本的是
`backdrop-filter` 在**合成器**里做，而探针打的是主线程原型，两条不同的线程。因此该场景
已删除，成本改为**结构性预算**（下表），这些量都能从源码确定推出，不需要跑浏览器，
也不会随 CI runner 负载漂移。

结构性预算拦的是"白付钱"，不是"帧率低"。真机 GPU 代价仍需桌面端实测。

### 玻璃档位：纯色块 / 高斯模糊 / 折射

全应用只有三个玻璃档位，判定在 `src/lib/glass/glassTier.ts`（纯函数），
React 组合在 `useGlassSurface.ts`，渲染后端在 `liquidGlassEngine.ts`。

| 档位 | 表现 | 何时可达 |
| --- | --- | --- |
| `solid` | 纯色块，零合成开销 | 角色自身的磨砂开关关闭 |
| `blur` | `backdrop-filter: blur + saturate` | **默认档**；折射不可用时的回落点 |
| `liquid` | WebGPU/WebGL 折射玻璃 | `liquidGlass` 开启 + 后端可用 + 未被降级，且角色是浮层 |

`blur` 是默认档，因此**引入液态玻璃不改变任何既有观感**。折射档是纯 opt-in 的升级路径。

档位经 `data-glass-tier` 写在表面根元素上，CSS 只做无脑映射，不做判定——判定留在
JS 一处，是因为下面这些规则不允许有第二份答案。

#### 折射与模糊绝不能同元素共存

带 `backdrop-filter` 的元素就是它自己的 **Backdrop Root**。liquidGL 的折射画布只能采到
元素所在 Backdrop Root 之内的背景，因此表面只要还留着 `backdrop-filter`，弯折就会折到
已经模糊过的一层上——**折射在视觉上凭空消失，且没有任何报错或告警**。

后果决定了写法：`backdrop-filter: none` 必须与角色类名**写在同一条规则**里
（`[data-glass-tier='liquid'].dialog-surface`），不能靠一条独立的
`[data-glass-tier='liquid']`。后者特异性只有 `(0,1,0)`，压不过上面的
`[data-floating-glass='true'] .dialog-surface` `(0,2,0)`，于是模糊照旧生效、折射静默失效。
`pnpm check:tokens` 专门盯这一条：声明了 `liquid` 却不关模糊即报错。

#### 只有浮层族能到折射档

`floating`（对话框、右键菜单、弹出层）与 `transient`（吐司、状态栏）可以。其余角色一律
停在 `blur`，这不是保守取舍，是库的机制决定的：

liquidGL 把目标底色清成透明，再把折射画布画在目标之下，靠"画布与目标同层、且只低一层"
让目标盖住画布。**这要求目标自己是带 z-index 的定位元素**——对话框、弹出层都是
`position: fixed` + `--z-*`，满足。`widget` / `dock` 是文档流里的布局容器
（`position: static`、无自有 z-index、背后也没有"页面内容"可折射），折射画布只能落到
`body` 上，实测直接盖住整个界面，节点卡片与停靠卡片的内容一并消失。

`chrome` / `content` / `surface` 是浮层的子层或固定小控件，另有一条理由：`content`
被钉死是因为浮层主体已经折射过背景，内容区再叠一层滤镜会在已弯折的结果上二次折射，
接缝处还会出现两层半透明叠加出的硬边。内容区的正确做法是让出透明度（只写半透明底色，
不写 `backdrop-filter`）。

#### zIndex 一律交给库推导，不传全局常量

库的画布定位在 `目标 zIndex - 1`。传一个全局常量（本项目曾用 1000，而 `--z-modal` 只有
100）会把画布抬到所有浮层之上，**一块画布盖住整个界面**——目标连同文字一起消失。
不传则库按 `effectiveZ(元素)` 取真实层叠值，画布落在目标下一层，正确。代价是同时打开
且分属不同 z 层级的浮层会有多张画布，这本来就是它们真实的层叠关系。

#### 引擎必须把交互还给目标

库会设 `pointer-events: none`，假定交互由它的"内容层"承担；但那个内容层是把元素**画进
一张 canvas** 的像素镜像，接不到指针事件（库只在 `draggable` 时才装回去）。不兜住这条，
设置弹窗在折射档下会整个点不动，命中测试直接穿透到下层遮罩。

兜底分两层：装配成功后引擎把 `pointer-events` 清回空值（此时底色已透明、折射画布在下一层、
子元素仍是真实 DOM，事件路径与不折射时一致）；同时由
`[data-glass-tier='liquid'] { pointer-events: auto !important }` 作为权威保障——库的
`_activate()` 可能延后到 GPU 后端就绪才执行，也就是在装配**之后**才把内联样式设成 `none`，
只清一次并不确定能赢过它；作者样式的 `!important` 与库的时机无关。关闭时库会自行还原内联样式。

#### 降级永远退到 `blur`，不退到 `solid`

后端缺失或帧率偏低都不该让界面从"玻璃"跳到"实色"，那是一次肉眼可见的观感突变；
`blur` 与 `liquid` 在观感上连续，降级几乎无感。`solid` 只在角色自身的磨砂开关关闭时出现。

帧率告警由既有的 `acrylicGuard` 统一发出，一次告警同时约束两个档位，不为折射单开一套阈值。

#### 预设与强度

折射参数（`refraction` / `bevelDepth` / `bevelWidth` / `frost` / `aberration` /
`specular` / `tint`）打包成预设，定义在 `src/lib/glass/glassPresets.ts`。
强度滑块只缩放**弯折量**（`refraction` / `bevelDepth` / `aberration`）——
`frost` 与 `specular` 是清晰度和亮度属性，不随强度变化，否则强度拉到最低会得到一片
什么都不折的糊玻璃，那不是低配液态玻璃，那就是 `blur` 档本身。

指针跟随由库的 `interaction: 'fluid'` 提供（表面朝指针位移并回弹），不用 `tilt`：
对话框跟着鼠标转角度在桌面工具里是干扰，且每个 tilt 透镜会额外生成一张镜像画布。

注意折射效果会被既有的 `--frost-alpha-*` 底色压低——折射画布在表面**下面**，72% 的底色
叠在上面。这是正确的层次顺序，但要预期"高对比内容 + 低 alpha 区域"才看得明显。

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
| 磨砂结构性预算 | `--frost-alpha-*` ≥ 85%（模糊看不见却全价付）；无人引用的 `--frost-alpha-*`；同一元素叠多层 `backdrop-filter` | 降透明度让模糊可见 / 删死 token / 合并成一层 |
| 四处同步 | `--alpha-*` ↔ `TEXT_TONE_ALPHA` ↔ `--opacity-*` ↔ 类名/token/别名 | — |

同一元素叠多层 `backdrop-filter` 不是性能问题而是**静默失效**：元素一旦带模糊就成为
自己的 Backdrop Root，WebKit 下只渲染最外层，表现为磨砂无声消失。

裸色相 (`text-green` / `bg-blue`) 经 `@theme` token 解析, **允许**; 禁的是带色阶的
`text-green-500` (tailwind 默认调色板, 不随主题联动)。


## CSS 文件与组件 Token 边界

`src/styles/component-tokens.css` 是组件局部视觉 token 的统一入口；`src/styles/theme.css`
继续拥有可被 ThemeEditor 运行时改写的主题 token。除这两个文件外，组件 CSS 不得出现
hex / rgb / hsl 颜色字面量，只能引用 `var(--*)`。

组件样式按 owner 拆到 `src/styles/components/<component>.css`，`src/styles/components.css`
只维护导入清单。前端生产 TS/TSX/CSS 单文件不得超过 500 行；`pnpm check:tokens`
同时检查颜色边界、文件上限和组件样式清单。