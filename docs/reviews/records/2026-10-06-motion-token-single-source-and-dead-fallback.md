# 浮层几何单一来源与死兜底清理

<!-- lissio-review
date: 2026-10-06
scope: 关闭 2026-10-06-ui-layers-and-gate-holes 遗留项 4、6；浮层位移与缩放收敛到单一来源，删除无消费者的离场兜底类
reviewer: 维护者（Horldsence）
verdict: 通过
-->

修正 [2026-10-06-ui-layers-and-gate-holes.md](2026-10-06-ui-layers-and-gate-holes.md) 的遗留项
4、6。原记录不修改，按此记录为准。

## 范围

- 遗留项 4：`motion-safe:` 变体构成的第三套 reduced-motion 权威（2 处）；
- 遗留项 6：`motion-*-exit` 五个零消费者 CSS 类，及其关键帧与降级登记；
- 复核 `presence.ts` 的 `VARIANT_GEOMETRY` 与 `motion.css` 关键帧之间是否一致；
- 复核 `MOTION_DISTANCE`、`--motion-ease`、`data-motion-switch` 是否仍有消费者。

## 结论

### 1. 同一角色曾经有两套位移数值

`presence.ts` 的 `VARIANT_GEOMETRY` 声明每个浮层角色"从哪来、缩放多少"，
`motion.css` 的关键帧却各自写死偏移。两条路径的数值并不一致：横幅在 CSS 上是
`5px`、在 GSAP 上是 `8px`；气泡是 `5px` 对 `6px`；消息 `5px` 对 `8px`；主表面
`5px` 对 `10px`。同一个角色因此有两条不同的动画，差异还取决于 JS 是否已经把令牌
写进 `<html>` —— 这类漂移没有任何测试能看见，因为两边都"合法"。

现在 `easingTokens.ts` 把几何一并投影成 `--motion-travel-<角色>`（`"0px, -6px"`
这样的逗号分隔参数）与 `--motion-scale-<角色>`，关键帧只消费令牌，不再持有 px
字面量。`motion.css` 里 `--motion-distance-*` 的引用已全部删除，
`MOTION_DISTANCE` 随之失去唯一用途并被移除：位移距离从此只有 `VARIANT_GEOMETRY`
一个来源。

令牌名与令牌值的对应也收进 `presence.ts`（`cssTravelToken` / `cssTravelValue`），
避免"名字在这里、数值在那里"的第二处分叉。

### 2. 关键帧读错了家族

`motion-overlay-in` 读的是 `--motion-duration-surface-out`（离场时长配进场缓动），
`motion-pop-in` 读的是 `content` 家族 —— 而 `VARIANT_GEOMETRY` 里两者都属于
`surface`。这会让兜底路径与 JS 路径快慢不一，与第 1 点是同一类缺陷。已按
`VARIANT_GEOMETRY.family` 逐一对齐，并在注释里写明"家族取自几何表，不按类名猜"。

### 3. 五个离场兜底类是死代码

`.motion-overlay-exit` / `.motion-surface-exit` / `.motion-pop-exit` /
`.motion-message-exit` / `.motion-banner-exit` 在仓库内零消费者：退场一律由
`MotionPresence` 驱动，而 CSS `animation` 无法阻止 React 立刻卸载节点，所以这条
兜底路径在设计上就走不通。类、五个 `motion-*-out` 关键帧、以及
`reduced-motion.css` 里的五条登记已一并删除，并补了一条注释说明"为什么没有离场类"。

### 4. 剩余零消费者

- `--motion-ease`：全仓库只有它自己的声明，删除；`.motion-switch` 原本被声明两次，
  合并为一处。
- `AnimatedSwitch` 的 `FALLBACK_EASE`：`installMotionTokens()` 在 `createRoot`
  之前就已写入令牌，兜底曲线只会掩盖真实缺口。移除后 `pnpm test` 仍全绿 —— 经
  jsdom 实测，内联 `transition` 简写里的 `var()` 会原样保留，断言只看时长子串，
  因此该兜底对可见行为没有贡献。
- `data-motion-switch`：无任何 CSS 选择器消费，删除。

### 5. `motion-safe:` 已清除

`SearchInput` 与 `RawDataBackToLatest` 的 `motion-safe:active:scale-95` 换成了
`motion-control` 基元。按下的反馈因此纳入同一套令牌，并且受应用内"减弱动效"设置
约束 —— 原先 `motion-safe:` 只跟随系统媒体查询，应用内设置关不掉它。
`RawDataBackToLatest` 的 `transition-colors` 同时并入 `motion-control` 的显式属性
集合，hover 配色行为不变。

### 6. 双写点已消除

`SettingsModal` / `ThemeEditor` 的 `DialogOverlay` + `DialogSurface`、
`UpdateChannelDialog` 的 `DialogSurface` 都已由 `MotionPresence` 驱动，却仍挂着
`motion-overlay-in` / `motion-surface-in`，违反 `ui-motion.md` 规则 9。这三处已摘除，
`ui-motion.md` 的规则 9 补上了这条推论。

### 7. 门禁补上几何令牌的双向校验

`.motion-*.test.ts` 之外，这类漂移原本没有任何机器检查。`check:motion` 现在额外校验：
CSS 引用的 `--motion-travel-*` / `--motion-scale-*` 角色必须存在于
`VARIANT_GEOMETRY`，且必须在 `theme.css` 的 `@theme` 里登记；反过来，登记了却没有
关键帧消费的令牌也会报错。三者都用注入故障实测过：改错角色名、删掉登记、加一条
无人消费的登记，各自都能让门禁非零退出。

`easingTokens.test.ts` 同时补了 4 个用例覆盖 `installMotionTokens` 的几何投影。
期望值刻意写成字面量而不读 `VARIANT_GEOMETRY` —— 读同一张表只能证明"投影等于它
自己"，改表时两边一起变。把横幅的进场偏移从 `-8` 改成 `-5`（即回到旧的 CSS 兜底
值）会让用例失败，字面量版本确认如此。

### 8. 验证

`pnpm typecheck`、`check:motion`、`check:tokens`、`check:layers`、`check:docs`、
`lint:ci`、`test`（169 文件 / 1135 用例）全部通过。构建产物中确认
`--motion-travel-*` / `--motion-scale-*` 四个角色的兜底值被 Tailwind 保留
（未被引用的主题变量会被裁剪，`--motion-distance-*` 就此消失），关键帧已改为读令牌。

## 遗留项

1. **`pnpm build:web` 在依赖解析上失败，与本次改动无关。** 工作区里 `highlight.js`
   被从 `10.7.3` 解到 `10.4.1`，而 `react-syntax-highlighter` 的
   `async-languages/hljs.js` 会动态 import `highlight.js/lib/languages/sql_more`，
   该文件在 `10.4.1` 中不存在。此失败先前被 `presence.ts` 的类型错误掩盖，
   修掉类型错误后才显形。需要把 `highlight.js` 固定回含 `sql_more` 的版本
   （或将 `sql_more` 显式 external）。
2. **离场方向仍是已知偏差。** `travelVars` 的离场位移取 `enterFrom - exitTo`，
   符号上等于 `-exitTo`，于是每个角色的实际离场方向与其声明的 `exitTo` 相反。
   这在 `presence.ts` 与 `travelVars.test.ts` 中已标注为"刻意未修"：修正它会一次性
   改变全应用所有浮层的离场方向，需要单独一轮验证。本次投影只覆盖
   `enterFrom` / `enterScale`，没有触碰这个决定。
3. **`motion-tick-in` 与 `motion-icon-pop` 仍是写死的 `scale()` 字面量。** 两者都不
   属于 `VARIANT_GEOMETRY` 的浮层角色（一个是选中勾、一个是图标弹入），是否有必要
   纳入几何表需要单独判断。
4. **遗留项 1、2、3、5 未动。** 13 条 `movable` 豁免的搬迁、9 个"关闭即卸载"模态框、
   `src/lib/interaction/` 的抽取、`check:motion` 的 arbitrary 值覆盖，均按原计划
   留待后续。
