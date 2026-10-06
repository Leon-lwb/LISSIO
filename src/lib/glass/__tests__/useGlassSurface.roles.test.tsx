//! 角色名单漂移检测
//!
//! useGlassSurface.ts 里的 LIQUID_ROLES 与 glassTier.ts 的 MAX_TIER_BY_ROLE
//! 表达的是同一件事: 哪些角色允许到折射档。前者是类型收窄所需, 后者是判定
//! 权威 —— 于是两份名单必须一致, 否则出现的情形很隐蔽:
//! glassTier 判定某角色可到 liquid, 而 resolveLensRequest 对同一角色返回
//! null, 结果是表面停在 liquid 档却永远没有透镜 —— **折射静默失效**。
//!
//! 这类缺陷没有任何运行时报错, 所以在这里显式拦。

import { describe, expect, it } from 'vitest';
import { resolveGlassTier } from '../glassTier';
import { resolveLensRequest } from '../useGlassSurface';

const ALL_ROLES = [
  'widget',
  'dock',
  'floating',
  'chrome',
  'content',
  'surface',
  'transient',
] as const;

const APPEARANCE = { liquidGlassPreset: 'balanced', liquidGlassIntensity: 0.7 };

describe('角色名单一致性 — 判定可达 liquid ⇔ 能解析出折射参数', () => {
  for (const role of ALL_ROLES) {
    it(`角色 ${role}`, () => {
      const tier = resolveGlassTier(role, {
        liquidGlass: true,
        backendAvailable: true,
        blurEnabled: true,
        degraded: false,
      });
      const request = resolveLensRequest(role, APPEARANCE);

      if (tier === 'liquid') {
        // 能到折射档就必须拿得到透镜参数
        expect(request).not.toBeNull();
      } else {
        // 到不了折射档就不该有透镜参数 —— 否则引擎可能被无谓地唤起
        expect(request).toBeNull();
      }
    });
  }
});

describe('resolveLensRequest', () => {
  it('可折射角色返回的 role 与传入一致', () => {
    expect(resolveLensRequest('floating', APPEARANCE)?.role).toBe('floating');
    expect(resolveLensRequest('transient', APPEARANCE)?.role).toBe('transient');
  });

  it('到不了折射档的角色返回 null', () => {
    // widget / dock 是文档流里的布局容器, 折射画布只能落到 body 上,
    // 实测会盖住整个界面 —— 因此它们与 chrome/content/surface 一样拿不到参数。
    for (const role of ['widget', 'dock', 'chrome', 'content', 'surface'] as const) {
      expect(resolveLensRequest(role, APPEARANCE)).toBeNull();
    }
  });

  it('预设强度透传到折射与倒角参数', () => {
    const weak = resolveLensRequest('floating', { ...APPEARANCE, liquidGlassIntensity: 0.1 });
    const strong = resolveLensRequest('floating', { ...APPEARANCE, liquidGlassIntensity: 1 });
    expect(strong?.refraction).toBeGreaterThan(weak?.refraction ?? 0);
    expect(strong?.bevelDepth).toBeGreaterThan(weak?.bevelDepth ?? 0);
  });
});
