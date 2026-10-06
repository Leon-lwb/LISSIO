//! 玻璃档位判定 — 决定一个表面此刻该渲染成什么
//!
//! 全应用只有三个档位, 由高到低:
//!
//!   solid  纯色块。零合成开销, 是所有玻璃效果关闭时的落点, 也是性能守护
//!          把档位降级后的落点。
//!   blur   高斯模糊 (backdrop-filter: blur + saturate)。**默认档** —— 引入液态
//!          玻璃之前全应用就是这一档, 所以默认观感不因本模块而改变。
//!   liquid 折射玻璃 (WebGPU/WebGL)。opt-in, 只在 appearance.liquidGlass 开启
//!          且后端可用时可达。
//!
//! 判定与渲染严格分离: 本文件是纯函数, 不碰 DOM, 不读 store, 因此可以脱离
//! 浏览器单测 (见 __tests__/glassTier.test.ts)。渲染后端与生命周期在
//! liquidGlassEngine.ts, React 组合在 useGlassSurface.ts。
//!
//! **一条不可让步的互斥规则**: 同一元素上, `blur` 与 `liquid` 绝不能同时存在。
//! backdrop-filter 会把该元素变成自己的 Backdrop Root, liquidGL 的折射画布
//! 于是只能采到这一层背景, 折射弯折在视觉上凭空消失 —— 且没有任何报错。
//! 这不是"效果弱一点", 是折射彻底静默失效, 所以它由 resolveGlassTier() 在
//! 类型层面就排掉, 而不是靠 CSS 兜底。

/// 表面角色 —— 与既有 CSS 类一一对应, 是档位判定的输入。
export type GlassRole =
  /// 画布内节点卡片 / 数据卡片 (widget-card-acrylic)
  | 'widget'
  /// 停靠卡片外壳 (dock-card-acrylic)
  | 'dock'
  /// 对话框 / 弹出层 / 右键菜单 / 提示卡 (dialog-surface 等)
  | 'floating'
  /// 对话框头尾条 (dialog-chrome)
  | 'chrome'
  /// 浮层内部内容区 (frost-content) —— 刻意永不到 liquid 档, 见 resolveGlassTier
  | 'content'
  /// 面板内表面, 如 AI 输入区 (frost-surface)
  | 'surface'
  /// 吐司与状态栏 (frost-acrylic)
  | 'transient';

export type GlassTier = 'solid' | 'blur' | 'liquid';

/** 判定所需的最小设置面。不直接依赖 AppSettings, 便于单测构造。 */
export interface GlassTierInput {
  /// appearance.liquidGlass
  liquidGlass: boolean;
  /// 后端是否真的能用 (WebGPU/WebGL 已就绪, 或 CSS 回退可用)
  backendAvailable: boolean;
  /// 角色自身的高斯模糊开关 (如 data-acrylic / data-floating-glass)
  blurEnabled: boolean;
  /// 性能守护是否要求降级 (帧率持续偏低)
  degraded: boolean;
}

/**
 * 角色 → 该角色可达到的最高档位。
 *
 * **只有浮层族能到折射档。** 这不是保守取舍, 是库的机制决定的: liquidGL 把
 * 目标底色清成透明, 再把折射画布画在目标之下、目标内容由另一个内容层重绘。
 * 这套办法要求目标自己是一个**带 z-index 的定位元素** (对话框、弹出层、
 * 右键菜单、吐司都满足 —— 它们是 `position: fixed` + `--z-*`)。
 *
 * `widget` / `dock` 是布局容器: 它们在文档流里, `position: static`, 没有
 * 自己的 z-index, 背后也没有"页面内容"可言 —— 折射画布只能落到 body 上,
 * 于是要么盖住它们、要么被它们盖住, 两种都不成立。实测中画布直接盖住了
 * 整个界面, 节点卡片与停靠卡片的内容一并消失。
 *
 * `content` 被钉死在 blur 还有另一条理由: 浮层主体已经折射过背景, 内容区
 * 再叠一层滤镜会在已弯折的结果上二次折射, 接缝处还会出现两层半透明叠加出
 * 的硬边。内容区的正确做法是让出透明度 (只写半透明底色, 不写
 * backdrop-filter), 这条纪律原本由 check:tokens 静态兜底, 这里把它同时
 * 表达在运行时判定里。
 */
const MAX_TIER_BY_ROLE: Readonly<Record<GlassRole, GlassTier>> = {
  widget: 'blur',
  dock: 'blur',
  floating: 'liquid',
  chrome: 'blur',
  content: 'blur',
  surface: 'blur',
  transient: 'liquid',
};

/**
 * 判定一个表面此刻的档位。
 *
 * 降级顺序是刻意的: 先因后端不可用退回 blur, 再因性能守护退回 blur, 最后
 * 因自身开关关闭退回 solid。**永远退到 blur 而不是 solid** —— 后端缺失或
 * 帧率偏低都不该让界面从"玻璃"跳到"实色", 那是一次肉眼可见的观感突变;
 * 而 blur 档与 liquid 档在观感上连续, 降级几乎无感。
 */
export function resolveGlassTier(role: GlassRole, input: GlassTierInput): GlassTier {
  if (!input.blurEnabled) return 'solid';
  const ceiling = MAX_TIER_BY_ROLE[role];
  if (ceiling === 'blur') return 'blur';
  if (input.degraded || !input.backendAvailable || !input.liquidGlass) return 'blur';
  return 'liquid';
}

/**
 * 档位 → <html> 上的属性值。CSS 侧一律靠这个属性分流, 不在组件里写条件判断。
 *
 * 写成 'true' / 'blur' / 'liquid' 三态而不是布尔, 是为了让 CSS 能同时表达
 * "折射档不要 backdrop-filter" —— 若只写 data-liquid-glass='true', 想要关闭
 * 底层模糊就必须再加一条反向选择器, 而那条选择器一旦漏改某个角色, 折射就会
 * 静默失效 (见文件头互斥规则)。
 */
export function glassTierAttribute(tier: GlassTier): string {
  return tier;
}

/** 档位是否为折射档 —— 引擎据此决定是否挂 liquidGL 透镜。 */
export function isLiquidTier(tier: GlassTier): boolean {
  return tier === 'liquid';
}
