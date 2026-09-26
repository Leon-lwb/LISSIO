// ============ Widget UI 注册表完整性守卫 ============
//
// registry 是纯 UI registry (renderer/editor/icon)。业务默认值/归一化/端口表
// 的单一权威在后端 kind::widgets 注册表 (后端测试保证); 前端守卫覆盖:
// UI 挂载完整性、尺寸表、输入取值语义, 以及测试目录 fixture 与 registry
// 的 kind 集合一致 (fixture 是组件测试中目录的替身)。

import { describe, expect, it } from 'vitest';
import { WIDGET_DEFS, WIDGET_REGISTRY, type WidgetKind } from '../registry';
import { widgetInputValue } from '../../../lib/utils/widgetValue';
import { WIDGET_SIZE_LIMITS } from '../../../lib/utils/widgetSize';
import { t } from '../../../i18n';
import { WIDGET_TEST_KINDS } from '../../../test/modelCatalog';
import type { WidgetConfig } from '../../../types';

const ALL_KINDS = Object.keys(WIDGET_REGISTRY) as WidgetKind[];

describe('widget registry completeness', () => {
  it('every def has component, icon and valid i18n label', () => {
    for (const def of WIDGET_DEFS) {
      // memo 组件是 ExoticComponent 对象 — 只能断言「已挂载实现」
      expect(def.Component, `${def.kind}.Component`).toBeDefined();
      expect(def.icon, `${def.kind}.icon`).toBeDefined();
      expect(def.labelKey, `${def.kind}.labelKey`).toBeTypeOf('string');
      // i18n t 缺键回退 key 本身 — 回退即视为漏配
      expect(t('en', def.labelKey as never), `${def.kind}.labelKey(en)`).not.toBe(def.labelKey);
      expect(t('zh', def.labelKey as never), `${def.kind}.labelKey(zh)`).not.toBe(def.labelKey);
    }
  });

  it('every kind has UI size limits', () => {
    for (const kind of ALL_KINDS) {
      expect(WIDGET_SIZE_LIMITS[kind], `${kind}.sizeLimits`).toBeDefined();
    }
  });

  it('registry kinds match the test catalog widget models (目录 kind 集合同步)', () => {
    expect([...ALL_KINDS].sort()).toEqual([...WIDGET_TEST_KINDS].sort());
  });

  it('input value helpers stay null for non-input kinds', () => {
    const nonInput: WidgetConfig['kind'][] = ['Gauge', 'Progress', 'Waveform', 'Label'];
    for (const kind of nonInput) {
      expect(widgetInputValue({ kind, params: { id: 'x', label: kind } } as WidgetConfig)).toBeNull();
    }
  });
});
