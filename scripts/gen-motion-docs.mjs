//! Regenerates docs/architecture/motion-tokens.md from the live spring solver.
//!
//! Run via `pnpm docs:motion`. The table is derived from the same functions the
//! app calls at runtime, so it cannot drift from the code the way a hand-written
//! table does.

import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { createServer } from 'vite';

// Load the solver through the project's own bundler rather than plain Node: the
// motion modules use extensionless relative imports (the TS/Vite convention), so
// resolving them here with the same rules the app uses is what keeps the generated
// table honest. `vite-node` would do the same job but is not a dependency.
const vite = await createServer({
  configFile: false,
  appType: 'custom',
  logLevel: 'error',
  server: { middlewareMode: true },
});
const spring = await vite.ssrLoadModule('/src/lib/motion/spring.ts');
const { allMotionTokens, timingAt, REFLOW_TIMING, SPEED_SCALE } =
  await vite.ssrLoadModule('/src/lib/motion/motionConfig.ts');
const { springAt, springFromTiming, springSettleTime, spatialTiming } = spring;

function peak(spring, settle) {
  let max = 0;
  for (let i = 0; i <= 600; i += 1) max = Math.max(max, springAt(spring, (i / 600) * settle));
  return max;
}

const here = dirname(fileURLToPath(import.meta.url));
const out = resolve(here, '../docs/architecture/motion-tokens.md');

const rows = allMotionTokens().map(({ family, phase, speed }) => {
  const timing = timingAt(family, phase, speed);
  const spring = springFromTiming(timing);
  const settle = springSettleTime(spring);
  return {
    speed,
    family,
    phase,
    duration: Math.round(timing.duration * 1000),
    bounce: timing.bounce.toFixed(2),
    stiffness: spring.stiffness.toFixed(1),
    damping: spring.damping.toFixed(2),
    overshoot: `${((peak(spring, settle) - 1) * 100).toFixed(1)}%`,
  };
});

const table = (speed) =>
  [
    '| 家族 | 阶段 | 时长 | bounce | 刚度 k | 阻尼 c | 峰值过冲 |',
    '| --- | --- | ---: | ---: | ---: | ---: | ---: |',
    ...rows
      .filter((r) => r.speed === speed)
      .map(
        (r) =>
          `| \`${r.family}\` | ${r.phase} | ${r.duration}ms | ${r.bounce} | ${r.stiffness} | ${r.damping} | ${r.overshoot} |`
      ),
  ].join('\n');

const REFLOW_SPEEDS = ['fast', 'standard', 'relaxed'];

const reflowRows = REFLOW_SPEEDS.map((speed) => {
  const scale = SPEED_SCALE[speed];
  const timing = {
    duration: REFLOW_TIMING.duration * scale.duration,
    bounce: REFLOW_TIMING.bounce * scale.bounce,
  };
  const spring = springFromTiming(timing);
  const settle = springSettleTime(spring);
  // 让位按实测距离拉伸。与 `reflowSpring()` 走同一条公式, 但这里必须显式传 speed ——
  // `reflowSpring()` 从 DOM 读速度, 在生成脚本里恒为 standard, 会让三行给出同一个值。
  const yieldAt = (distancePx) =>
    Math.round(springSettleTime(springFromTiming(spatialTiming(timing, distancePx))) * 1000);
  return {
    speed,
    duration: Math.round(timing.duration * 1000),
    stiffness: spring.stiffness.toFixed(1),
    damping: spring.damping.toFixed(2),
    // 让位按实测距离拉伸, 所以这里给的是"让一格"(20px) 与"让一大段"(400px) 两端。
    yield20: yieldAt(20),
    yield400: yieldAt(400),
    overshoot: `${((peak(spring, settle) - 1) * 100).toFixed(1)}%`,
  };
});

const reflowTable = [
  '| 速度 | 基准时长 | 刚度 k | 阻尼 c | 让一格(20px) | 让一大段(400px) | 峰值过冲 |',
  '| --- | ---: | ---: | ---: | ---: | ---: | ---: |',
  ...reflowRows.map(
    (r) =>
      `| ${r.speed} | ${r.duration}ms | ${r.stiffness} | ${r.damping} | ${r.yield20}ms | ${r.yield400}ms | ${r.overshoot} |`
  ),
].join('\n');

const doc = `# 动效令牌与调参表

本文件由 \`pnpm docs:motion\` 从 \`src/lib/motion/spring.ts\` 的求解器直接生成,
不要手工编辑 —— 手写表格一定会和代码漂移。

## 物理模型

每个令牌是一个**阻尼谐振子**: 单位质量挂在弹簧上, 从静止释放去够一个目标位置。

    ẍ = (−k·x − c·ẋ) / m,  m = 1

- \`k\` 刚度(stiffness), 越大回得越快
- \`c\` 阻尼(damping), 越大越"稳", 越小越"晃"
- 阻尼比 ζ = c / (2√k) —— ζ < 1 会过冲, ζ = 1 临界阻尼(不过冲)

与三次贝塞尔的区别: 贝塞尔是"位置关于时间的插值", 弹簧是"一个真的被积分的
系统"。差别在两处 ——

1. **过冲是解出来的, 不是画出来的。** 峰值过冲由 ζ 唯一决定, 与时长无关。
2. **时长是解出来的, 不是填进去的。** \`springFromTiming()\` 反解出使系统恰好在
   目标时刻进入静息带的 k, 所以表里写的时长在任何 bounce 下都真的读作这个时长。

## 为什么进场允许回弹、离场恒为临界阻尼

进场是"到位": 物体到达后自然沉降, 一点过冲读起来是弹性, 不是错误。
离场是"离开": 一个正在离开的面板如果还晃, 读起来是渲染故障。��以 \`-out\` 令牌的
bounce 一律为 0, 这条规则写在 \`motionConfig.ts\` 的 \`BASE_TIMING\` 里而不是散落
在各调用点, 并由测试锁定。

## 五个家族

按"移动了屏幕多少"排序, 不按组件类型 —— 这样新增界面时不需要新增家族。

| 家族 | 职责 | 典型使用者 |
| --- | --- | --- |
| \`control\` | 悬停/按下/聚焦, 短到无感 | 按钮、输入框、图标 |
| \`toggle\` | 通断翻转 | 开关、滑块、旋钮 |
| \`content\` | 内容级出现与消失 | 列表行、消息、Toast、横幅 |
| \`surface\` | 有锚点的浮层 | 对话框、菜单、气泡 |
| \`spatial\` | 大尺度空间迁移 | 停靠面板、浮动窗口、Dock |

## 调参表

### standard

${table('standard')}

### fast

${table('fast')}

### relaxed

${table('relaxed')}

## 让位（家族之外的第四种意图）

让位是列表里一次小范围局部位移: 某一行消失或换序, 相邻的行挪一格。它刻意比任何家族
令牌都快, 因为**事件本身比家族-进场/离场更小** —— 家族按"移动了屏幕多少"排序,
\`content\` 那一档是消息、Toast、横幅这类整块表面的出现与消失, 而让位是两三行之间挪一格。

家族体系在这里不够用, 因为需要区分的不是"多大范围", 而是"这是一个物体到达, 还是
周围让开"。所以它是一份具名时序 (\`REFLOW_TIMING\`) 加一个解析器 (\`reflowSpring\`),
不是第六个家族 —— 新家族会把上面三张表都撑大, 而让位不需要按家族分别调优。

让位按实测距离拉伸, 与家族令牌共用 \`spatialTiming\`: 删掉一个展开的块会让位距离远大于
一格, 那次让位不该和删掉一个收起的块一样快。速度设置照常生效。

${reflowTable}

\`bounce\` 为 0 的理由与离场令牌同源: 让位没有来源也没有动量, 越过槽位再荡回来读起来
是渲染故障。

## 怎么调

**想改手感, 改 \`BASE_TIMING\`, 不要改别的地方。**
它在 \`src/lib/motion/motionConfig.ts\`, 是全app 唯一的时序意图来源。

| 想达到的效果 | 改哪里 |
| --- | --- |
| 整体更快/更慢 | 应用内"动画速度"设置(fast/standard/relaxed), 不改代码 |
| 某个家族更利落 | \`BASE_TIMING[family].in.duration\` ↓ |
| 回弹更明显 | \`BASE_TIMING[family].in.bounce\` ↑ |
| 长距离迁移读起来更从容 | 已自动处理: \`spatialTiming()\` 按实测路程拉长时长并增加 bounce |
| 列表让位更快/更慢 | \`REFLOW_TIMING.duration\`, 不在 \`BASE_TIMING\` 里 |
| 某个浮层该从别的方向来 | 传 \`MotionPresence\` 的 \`origin\` / \`travel\` prop |

**bounce 的可感知范围是 0 ~ 0.45。** 超过之后位移比弹簧周期还短, 看到的是频闪
而不是弹性; \`springFromTiming\` 内部把 ζ 夹在 0.25 以上正是为此。

**bounce 与刚度不是单调关系。** 临界阻尼的尾巴是 \`(1+ω₀t)·e^(−ω₀t)\`, 比纯指数
衰减慢得多, 所以从 bounce 0 往上加时反而需要**更高**的刚度才能维持同样的沉降
时间。这不是 bug, 是物理。可感知的旋钮(时长、过冲)都是单调的, 只有中间那个
中间量不是 —— 调参时看"峰值过冲"那一列, 不要看"刚度"。

## 一个令牌, 三处投影

    motionConfig.ts  ──► easingTokens.ts  ──► CSS --ease-<家族>-<阶段>  (linear() 采样)
      (物理意图)      └─► gsapSpring.ts   ──► GSAP 补间 (逐帧求解)

CSS 侧把弹簧采样成 \`linear()\` 缓动函数写入 \`<html>\` 内联样式, 于是**整个 CSS
过渡体系都用上了真弹簧, 却仍然跑在合成器线程上** —— 时长与缓动在样式计算阶段
解完, 每帧不做任何曲线求值。JS 侧用同一个求解器逐帧求值, 所以一个由 CSS 驱动的
过渡和一个由 GSAP 驱动的补间, 只要令牌相同, 运动就完全一致。

## 距离感知

\`springFromTiming()\` 只回答"多久到位"。位移多远还会影响读感: 同样的 280ms,
移动 600px 明显比移动 40px 显得被"拽"。\`spatialTiming()\` 因此按实测路程做对数
拉伸(封顶 1.35×)并相应增加 bounce, 因为更长的航程会把沉降过程暴露得更完整。
上限刻意压得很浅: 远距离迁移已经多花了自己的时间, 再往上加就成了等待。

固定偏移的入场传名义偏移(几乎不拉伸), 实测迁移(FLIP、Dock 换边)传真实像素距离。
`;

writeFileSync(out, doc);
await vite.close();
console.log(`wrote ${out}`);