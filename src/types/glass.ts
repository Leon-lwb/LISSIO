//! 玻璃表面档位判定的输入形状 — 前端自有类型。
//!
//! 为什么单独放在实现层: 效果层 (`lib/glass`) 要按参数判定档位但不能订阅 store,
//! 而订阅 store 的绑定住在交互层 (`lib/hooks`) —— 两侧都要引用同一个形状, 谁也不
//! 该为了一个类型去引用对方。定义在这里, 让依赖方向保持 效果层 → 实现层 ← 交互层。

/// 决定玻璃档位的外观字段 — 刻意只有这些。
///
/// 外观设置里其余字段 (字号、字体、动效档位) 的变化不该让所有玻璃表面重算档位 ——
/// 那会让改一次字号变成一次全应用的透镜重挂。绑定侧 (`lib/hooks/useGlassAppearance`)
/// 按这份清单做窄订阅。
export interface GlassAppearance {
  /// 折射档总开关 (全应用级)
  liquidGlass: boolean;
  liquidGlassPreset: string;
  liquidGlassIntensity: number;
  /// widget / dock 角色的磨砂开关
  acrylicBackground: boolean;
  /// 其余角色的磨砂开关
  floatingGlass: boolean;
}
