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
const { allMotionTokens, timingAt } = await vite.ssrLoadModule('/src/lib/motion/motionConfig.ts');
const { springAt, springFromTiming, springSettleTime } = spring;

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
   目标时刻进入静息带的 k, 所以"0.52 秒"在任何 bounce 下都真的读作半秒。

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

## 怎么调

**想改手感, 改 \`BASE_TIMING\`, 不要改别的地方。**
它在 \`src/lib/motion/motionConfig.ts\`, 是全app 唯一的时序意图来源。

| 想达到的效果 | 改哪里 |
| --- | --- |
| 整体更快/更慢 | 应用内"动画速度"设置(fast/standard/relaxed), 不改代码 |
| 某个家族更利落 | \`BASE_TIMING[family].in.duration\` ↓ |
| 回弹更明显 | \`BASE_TIMING[family].in.bounce\` ↑ |
| 长距离迁移读起来更从容 | 已自动处理: \`spatialTiming()\` 按实测路程拉长时长并增加 bounce |
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
拉伸(封顶 1.55×)并相应增加 bounce, 因为更长的航程会把沉降过程暴露得更完整。

固定偏移的入场传名义偏移(几乎不拉伸), 实测迁移(FLIP、Dock 换边)传真实像素距离。
`;

writeFileSync(out, doc);
await vite.close();
console.log(`wrote ${out}`);