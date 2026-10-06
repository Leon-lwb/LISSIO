//! 液态玻璃预设 — 折射参数的唯一来源
//!
//! 这里只描述"折射成什么样", 不描述"谁来渲染"。渲染后端的挑选与降级在
//! liquidGlassEngine.ts, 档位判定 (纯色 / 高斯模糊 / 折射) 在 glassTier.ts。
//! 三者分开是因为它们各自的失效方式不同: 预设错了只是不好看, 后端错了
//! 是白屏或黑屏, 档位错了会让用户以为设置没生效。
//!
//! 参数含义对齐 liquidGL v3 的同名选项 (0-1 为归一化强度, frost 为 px):
//!   refraction   整片玻璃的基础折射偏移量。0 = 平板, 值越大背景弯折越明显。
//!   bevelDepth   边缘额外折射强度, 制造厚度感。玻璃的"体积"主要来自这一项。
//!   bevelWidth   倒角带宽度 (占最短边比例)。宽倒角 = 厚玻璃, 窄倒角 = 薄片。
//!   frost        磨砂模糊半径 (px)。液态玻璃保留一点模糊, 否则背景锐利得
//!                像贴在玻璃上, 反而丢失玻璃感。
//!   aberration   色散强度。真实玻璃对短波长偏折更强; 只在倒角处可见。
//!   specular     动画高光。关掉能省一块 GPU 填充率。
//!   tint         玻璃染色。alpha 即染色浓度, null = 不染。
//!
//! **指针跟随由 liquidGL 的 `interaction: 'fluid'` 提供, 不在本文件。** 曾用
//! 的 `tilt` (悬停 3D 倾斜) 已移除, 两个原因: 对话框跟着鼠标转个角度在桌面
//! 工具里是纯粹的干扰; 且每个 tilt 透镜会额外生成一张镜像画布, 十来张浮层
//! 同时存在时白白多十次绘制。fluid 模式给出的"表面被指针推开并回弹"才是
//! 液态玻璃该有的指针反馈。
//!
//! 强度缩放 (appearance.liquidGlassIntensity) 只作用于 refraction /
//! bevelDepth / aberration 三项 —— 它们共同决定"弯折得多狠"。frost 与
//! specular 是清晰度与亮度属性, 不随强度变化: 否则强度拉到最低会得到一片
//! 什么都不折的糊玻璃, 那不是低配液态玻璃, 那就是高斯模糊档本身。

/// 一个折射预设。字段名与 liquidGL 选项同名, 便于对照上游文档。
export interface LiquidGlassPreset {
  id: string;
  refraction: number;
  bevelDepth: number;
  bevelWidth: number;
  frost: number;
  aberration: number;
  specular: boolean;
  tint: string | null;
}

/// 强度缩放作用的三项 —— 弯折量。
const REFRACTION_SCALE_KEYS = ['refraction', 'bevelDepth', 'aberration'] as const;

/**
 * 玻璃预设表。顺序即设置面板下拉的展示顺序。
 *
 * 取值参照 liquidGL 上游 README 的官方预设并按桌面应用调整: 上游面向网页
 * 大色块背景, 我们的浮层后面是密集的节点网格与波形线, 折射过强会让这些
 * 细线读不出来, 因此这里的折射量整体低于上游 "Alien" 预设。
 */
export const LIQUID_GLASS_PRESETS: readonly LiquidGlassPreset[] = [
  {
    // 贴近原生 macOS: 折射克制, 倒角给足厚度, 高光活跃。
    id: 'balanced',
    refraction: 0.012,
    bevelDepth: 0.055,
    bevelWidth: 0.21,
    frost: 2,
    aberration: 0,
    specular: true,
    tint: null,
  },
  {
    // 最薄: 接近平板玻璃, 只留一圈窄倒角勾边。密集内容后面最易读。
    id: 'thin',
    refraction: 0.008,
    bevelDepth: 0.035,
    bevelWidth: 0.11,
    frost: 1,
    aberration: 0,
    specular: true,
    tint: null,
  },
  {
    // 最厚: 宽倒角 + 强折射 + 轻染色, 边缘弯折明显。适合看效果, 不适合长时间用。
    id: 'thick',
    refraction: 0.05,
    bevelDepth: 0.16,
    bevelWidth: 0.17,
    frost: 3,
    aberration: 0.25,
    specular: true,
    tint: null,
  },
  {
    // 磨砂隐私玻璃: 折射很轻, 模糊很重。背后内容不可读。
    id: 'frost',
    refraction: 0,
    bevelDepth: 0.04,
    bevelWidth: 0.12,
    frost: 9,
    aberration: 0,
    specular: true,
    tint: null,
  },
];

/** 预设 id → 预设。查不到一律回落到 balanced, 不抛错 ——
 *  预设表是设置面板下拉的来源, 存档里的 id 可能是旧版本删掉的。 */
const PRESET_BY_ID = new Map<string, LiquidGlassPreset>(
  LIQUID_GLASS_PRESETS.map((p) => [p.id, p]),
);

export const DEFAULT_PRESET_ID = 'balanced';

/// 取预设; 未知或缺失 id 回落到默认预设。
export function resolvePreset(id: string | undefined): LiquidGlassPreset {
  // 注意不能用 `id && PRESET_BY_ID.get(id) ?? default` —— id 为空串时 `id && …`
  // 求值为空串本身而非 undefined, `??` 不会兜底, 于是返回空串。这里显式查表。
  const found = id === undefined ? undefined : PRESET_BY_ID.get(id);
  return found ?? PRESET_BY_ID.get(DEFAULT_PRESET_ID)!;
}

/**
 * 按强度缩放弯折量, 返回可直接喂给 liquidGL 的参数。
 *
 * intensity 0.1-1.0 线性映射到 [MIN_BEND, 1.0]: 下限不取 0, 因为强度拉到
 * 最低时玻璃仍应保留可辨认的弯折, 否则它和高斯模糊档在视觉上无法区分,
 * 用户会以为开关没生效。
 */
export function applyIntensity(
  preset: LiquidGlassPreset,
  intensity: number,
): LiquidGlassPreset {
  const clamped = Math.min(1, Math.max(0.1, intensity));
  const scale = 0.25 + clamped * 0.75;
  const out = { ...preset };
  for (const key of REFRACTION_SCALE_KEYS) {
    out[key] = preset[key] * scale;
  }
  return out;
}
