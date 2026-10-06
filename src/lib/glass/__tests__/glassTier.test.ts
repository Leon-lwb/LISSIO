import { describe, expect, it } from 'vitest';
import { isLiquidTier, resolveGlassTier, type GlassTierInput } from '../glassTier';

/// 全部为真的基线输入 — 每个用例只改自己关心的那一项。
const ON: GlassTierInput = {
  liquidGlass: true,
  backendAvailable: true,
  blurEnabled: true,
  degraded: false,
};

describe('resolveGlassTier — 默认落在高斯模糊档', () => {
  it('液态玻璃关闭时, 浮层停在 blur 档', () => {
    expect(resolveGlassTier('floating', { ...ON, liquidGlass: false })).toBe('blur');
  });

  it('液态玻璃关闭时, 画布内角色同样停在 blur 档', () => {
    expect(resolveGlassTier('widget', { ...ON, liquidGlass: false })).toBe('blur');
  });
});

describe('resolveGlassTier — 折射档的可达条件', () => {
  it('开关开启 + 后端可用 + 未降级 → liquid', () => {
    expect(resolveGlassTier('floating', ON)).toBe('liquid');
  });

  it('只有浮层族在条件齐备时到 liquid', () => {
    expect(resolveGlassTier('floating', ON)).toBe('liquid');
    expect(resolveGlassTier('transient', ON)).toBe('liquid');
  });
});

describe('resolveGlassTier — 降级链', () => {
  it('后端不可用 → 退到 blur, 不退到 solid', () => {
    expect(resolveGlassTier('floating', { ...ON, backendAvailable: false })).toBe('blur');
  });

  it('帧率守护已降级 → 退到 blur, 不退到 solid', () => {
    expect(resolveGlassTier('floating', { ...ON, degraded: true })).toBe('blur');
  });

  it('自身模糊开关关闭 → solid (唯一进入 solid 的路径)', () => {
    expect(resolveGlassTier('floating', { ...ON, blurEnabled: false })).toBe('solid');
    expect(resolveGlassTier('widget', { ...ON, blurEnabled: false })).toBe('solid');
  });
});

describe('resolveGlassTier — 角色上限', () => {
  it('除浮层族外的所有角色都到不了 liquid 档', () => {
    // widget / dock 是文档流里的布局容器: position static、无自有 z-index、
    // 背后也没有"页面内容"可折射, 而折射画布只能落到 body 上 ——
    // 实测会直接盖住整个界面。chrome / content / surface 是浮层的子层或
    // 固定小控件, 叠加会二次折射并出接缝。
    for (const role of ['widget', 'dock', 'chrome', 'content', 'surface'] as const) {
      expect(resolveGlassTier(role, ON)).toBe('blur');
    }
  });

  it('角色上限优先于降级条件 —— 已在上限时降级不改变结果', () => {
    expect(resolveGlassTier('content', { ...ON, backendAvailable: false })).toBe('blur');
  });

  it('角色上限在 solid 判定之下 —— 关掉模糊仍进 solid', () => {
    expect(resolveGlassTier('content', { ...ON, blurEnabled: false })).toBe('solid');
  });
});

describe('isLiquidTier', () => {
  it('只对 liquid 档为真', () => {
    expect(isLiquidTier('liquid')).toBe(true);
    expect(isLiquidTier('blur')).toBe(false);
    expect(isLiquidTier('solid')).toBe(false);
  });
});
