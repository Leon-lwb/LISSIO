//! useGlassSurface — 全应用统一的玻璃表面组合 hook
//!
//! 每个想要玻璃效果的组件只调这一个 hook, 不自己判断开关、不自己算档位、
//! 不直接碰 liquidGL。hook 负责三件事:
//!
//!   1. 取性能守护状态 + 调用方传入的外观设置, 交给 resolveGlassTier() 得出档位;
//!   2. 档位写成 `data-glass-tier` 属性, 由 CSS 单点分流 (纯色 / 高斯模糊 /
//!      折射"不要 backdrop-filter") —— 判定只存在于这一处, 不散落进组件;
//!   3. 档位为 liquid 时挂 liquidGL 透镜, 卸载 / 降级 / 参数变化时精确拆除。
//!
//! **为什么 CSS 分流而不是返回 className**: 组件里的条件 class 会让"这个
//! 表面此刻是什么档"变成要读组件源码才能回答的问题, 而 backdrop-filter 与
//! 折射互斥 (见 glassTier.ts) — 这条规则一旦靠人记, 必然在某次改版里漏掉,
//! 漏掉的表现是折射无声消失。所以判定留在 JS 一处, CSS 只做无脑映射。
//!
//! 用法:
//!   const glass = useGlassSurface({ role: 'floating' });
//!   <div ref={glass.ref} data-glass-tier={glass.tier}>…</div>

import { useEffect, useMemo, useRef, useState } from 'react';
import type { GlassAppearance } from '../../types';
import { acrylicGuard, acrylicGuardActive } from '../performance/acrylicGuard';
import {
  resolveGlassTier,
  type GlassRole,
  type GlassTier,
} from './glassTier';
import {
  applyIntensity,
  resolvePreset,
  DEFAULT_PRESET_ID,
} from './glassPresets';
import {
  mountLens,
  probeLiquidGLBackend,
  subscribeBackend,
  unmountLens,
  type LensMountRequest,
} from './liquidGlassEngine';

export interface UseGlassSurfaceOptions {
  /** 表面角色 — 决定最高档位与配色档 */
  role: GlassRole;
  /**
   * 角色自身的高斯模糊开关。缺省读全局: widget/dock 跟 data-acrylic,
   * 其余跟 data-floating-glass。这与既有 CSS 的归属一致, 因此本 hook
   * 不会让某个表面在 CSS 关掉磨砂后仍然折射。
   */
  blurEnabled?: boolean;
  /** 折射档关闭时是否跳过一切工作 (纯静态表面可用, 省掉一次订阅) */
  disabled?: boolean;
  /**
   * 已解析的外观设置 — **由调用方传入, 效果层不读 store**。
   *
   * 效果层要能被任何一层按参数调用 (测试、文档生成、非应用环境); 自己订阅
   * 全局设置会让"这段玻璃此刻是什么档"变成要先起一个 store 才能回答的问题。
   * 设置 → 档位输入的绑定在 `src/settings/`。
   */
  appearance: GlassAppearance;
}

// 外观形状的唯一权威在实现层 (src/types/glass.ts); 这里只转发, 免得出现第二处定义。
export type { GlassAppearance };


export interface GlassSurface {
  /** 挂到表面根元素上 */
  ref: (el: HTMLElement | null) => void;
  /** 'solid' | 'blur' | 'liquid' — 写到 data-glass-tier */
  tier: GlassTier;
}

/**
 * 可到折射档的角色。glassTier 的 MAX_TIER_BY_ROLE 是判定权威; 这里只是把
 * 同一事实换个形式再写一遍, 用来给 LensMountRequest.role 收窄类型 ——
 * 若两份名单漂移, resolveLensRequest 返回的 role 会与档位判定矛盾。
 * 测试对这两份名单做交叉校验。
 */
const LIQUID_ROLES = ['floating', 'transient'] as const;
type LiquidRole = (typeof LIQUID_ROLES)[number];

const ACRYLIC_ROLES: ReadonlySet<GlassRole> = new Set<GlassRole>(['widget', 'dock']);

function isLiquidRole(role: GlassRole): role is LiquidRole {
  return (LIQUID_ROLES as readonly GlassRole[]).includes(role);
}

/** 折射参数 — 从设置解析。抽出来便于单测与组件共用。 */
export function resolveLensRequest(
  role: GlassRole,
  appearance: {
    liquidGlassPreset: string;
    liquidGlassIntensity: number;
  },
): LensMountRequest | null {
  // 非浮层族被 glassTier 钉在 blur 及以下, 走到这里说明判定与参数解析脱节了
  // —— 返回 null 让调用方退回 blur。
  if (!isLiquidRole(role)) return null;
  const preset = resolvePreset(appearance.liquidGlassPreset);
  const scaled = applyIntensity(preset, appearance.liquidGlassIntensity);
  return {
    role,
    refraction: scaled.refraction,
    bevelDepth: scaled.bevelDepth,
    bevelWidth: scaled.bevelWidth,
    frost: scaled.frost,
    aberration: scaled.aberration,
    specular: scaled.specular,
    tint: scaled.tint,
  };
}

/**
 * 玻璃表面 hook。
 *
 * 外观设置经 `options.appearance` 传入而非自行订阅: 这是效果层的边界 —— 它只
 * 依赖实现层的数据形状, 怎么拿到这些字段由调用方决定 (见 `src/settings/`)。
 * 传入的字段刻意只有档位判定所需的几个。
 */
export function useGlassSurface(options: UseGlassSurfaceOptions): GlassSurface {
  const { role, blurEnabled, disabled = false, appearance } = options;
  const elementRef = useRef<HTMLElement | null>(null);

  const { liquidGlass, liquidGlassPreset, liquidGlassIntensity } = appearance;
  const acrylicBackground = appearance.acrylicBackground;
  const floatingGlass = appearance.floatingGlass;

  // 后端探测是一次性的异步过程; 未探测完成前按"不可用"处理, 停在 blur 档。
  // 这保证首帧不会挂上一个注定失败的透镜。
  const [backendAvailable, setBackendAvailable] = useState(false);
  const [degraded, setDegraded] = useState(() => acrylicGuardActive());

  useEffect(() => {
    let alive = true;
    void probeLiquidGLBackend().then((ok) => {
      if (alive) setBackendAvailable(ok);
    });
    const unsubscribe = subscribeBackend((ok) => {
      if (alive) setBackendAvailable(ok);
    });
    const unsubscribeGuard = acrylicGuard.subscribe(() => {
      if (alive) setDegraded(acrylicGuardActive());
    });
    return () => {
      alive = false;
      unsubscribe();
      unsubscribeGuard();
    };
  }, []);

  const enabledBlur = blurEnabled ?? (ACRYLIC_ROLES.has(role) ? acrylicBackground : floatingGlass);

  const tier = useMemo(
    () =>
      disabled
        ? ('solid' as const)
        : resolveGlassTier(role, {
            liquidGlass,
            backendAvailable,
            blurEnabled: enabledBlur,
            degraded,
          }),
    [disabled, role, liquidGlass, backendAvailable, enabledBlur, degraded],
  );

  // 透镜装配。依赖里刻意不含 tier 之外的可变量, 保证只在折射档才可能挂载。
  const lensRequest = useMemo(
    () => resolveLensRequest(role, { liquidGlassPreset, liquidGlassIntensity }),
    [role, liquidGlassPreset, liquidGlassIntensity],
  );

  useEffect(() => {
    const el = elementRef.current;
    if (el === null) return;
    if (tier !== 'liquid' || lensRequest === null) {
      unmountLens(el);
      return;
    }
    let alive = true;
    void mountLens(el, lensRequest).then((ok) => {
      // 装配失败 (元素已卸载 / 库拿不到) 时清回 blur, 让 CSS 补上模糊
      if (!ok && alive) el.dataset.glassTier = 'blur';
    });
    return () => {
      alive = false;
      unmountLens(el);
    };
  }, [tier, lensRequest]);

  return {
    ref: (el: HTMLElement | null) => {
      elementRef.current = el;
    },
    tier,
  };
}

export { DEFAULT_PRESET_ID };
export type { GlassRole, GlassTier };
