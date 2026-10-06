import { describe, expect, it } from 'vitest';
import {
  applyIntensity,
  LIQUID_GLASS_PRESETS,
  resolvePreset,
  DEFAULT_PRESET_ID,
} from '../glassPresets';

describe('resolvePreset', () => {
  it('按 id 返回预设', () => {
    expect(resolvePreset('thin').id).toBe('thin');
    expect(resolvePreset('thick').id).toBe('thick');
  });

  it('未知 id 回落到默认预设而不抛错', () => {
    // 存档里的 id 可能来自旧版本 —— 删掉过一个预设就会走到这里。
    expect(resolvePreset('does-not-exist').id).toBe(DEFAULT_PRESET_ID);
    expect(resolvePreset(undefined).id).toBe(DEFAULT_PRESET_ID);
  });

  it('预设 id 唯一', () => {
    const ids = LIQUID_GLASS_PRESETS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('预设取值落在库的有效区间内', () => {
  it('归一化强度项落在 0-1', () => {
    for (const preset of LIQUID_GLASS_PRESETS) {
      expect(preset.refraction).toBeGreaterThanOrEqual(0);
      expect(preset.refraction).toBeLessThanOrEqual(1);
      expect(preset.bevelDepth).toBeGreaterThanOrEqual(0);
      expect(preset.bevelDepth).toBeLessThanOrEqual(1);
      expect(preset.aberration).toBeGreaterThanOrEqual(0);
      expect(preset.aberration).toBeLessThanOrEqual(1);
      expect(preset.bevelWidth).toBeGreaterThanOrEqual(0);
      expect(preset.bevelWidth).toBeLessThanOrEqual(1);
      expect(preset.frost).toBeGreaterThanOrEqual(0);
    }
  });
});

describe('applyIntensity — 只缩放弯折量', () => {
  const base = resolvePreset('balanced');

  it('强度提高时折射与倒角同步增强', () => {
    const low = applyIntensity(base, 0.1);
    const high = applyIntensity(base, 1);
    expect(high.refraction).toBeGreaterThan(low.refraction);
    expect(high.bevelDepth).toBeGreaterThan(low.bevelDepth);
  });

  it('强度不改变磨砂与高光 —— 它们是清晰度/亮度属性', () => {
    // 否则强度拉到最低会得到一片什么都不折的糊玻璃, 那不是低配液态玻璃,
    // 那就是高斯模糊档本身。
    const low = applyIntensity(base, 0.1);
    const high = applyIntensity(base, 1);
    expect(low.frost).toBe(base.frost);
    expect(high.frost).toBe(base.frost);
    expect(low.specular).toBe(base.specular);
    expect(low.tint).toBe(base.tint);
  });

  it('强度 0.1 仍保留可辨认的弯折 (不塌到零)', () => {
    const low = applyIntensity(base, 0.1);
    expect(low.refraction).toBeGreaterThan(0);
    expect(low.bevelDepth).toBeGreaterThan(0);
  });

  it('越界强度被夹到 [0.1, 1]', () => {
    expect(applyIntensity(base, -5)).toEqual(applyIntensity(base, 0.1));
    expect(applyIntensity(base, 99)).toEqual(applyIntensity(base, 1));
  });

  it('不修改传入的预设 (纯函数)', () => {
    const snapshot = { ...base };
    applyIntensity(base, 1);
    expect(base).toEqual(snapshot);
  });
});
