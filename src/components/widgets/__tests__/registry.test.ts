// ============ Widget UI 注册表完整性守卫 ============
//
// registry 是纯 UI registry (renderer/editor/icon)。业务默认值/归一化/端口表
// 的单一权威在后端 kind::widgets 注册表 (后端测试保证); 前端守卫覆盖:
// UI 挂载完整性、尺寸表、输入取值语义、测试目录 fixture 与 registry 的 kind 集合
// 一致 (fixture 是组件测试中目录的替身), 以及「节点占位 ⇒ 必有窗口」这条不变量。

import { describe, expect, it } from 'vitest';
import { WIDGET_DEFS, WIDGET_REGISTRY, type WidgetKind } from '../registry';
import { widgetInputValue } from '../../../lib/utils/widgetValue';
import { WIDGET_SIZE_LIMITS } from '../../../lib/utils/widgetSize';
import { HOST_PANEL_DEFS } from '../../../lib/panels/panelDefs';
import { translate } from '../../../i18n';
import { WIDGET_TEST_KINDS } from '../../../test/modelCatalog';
import type { WidgetConfig } from '../../../types';

const ALL_KINDS = Object.keys(WIDGET_REGISTRY) as WidgetKind[];

/// 节点内渲染占位而非真身的 kind —— 真身在 displays/**, 经 PANEL_VIEWS 到达。
/// WidgetNode 的双击处理负责开窗, 节点本身只是入口提示。
const PLACEHOLDER_KINDS: readonly WidgetKind[] = [
  'Command',
  'FrameDecoder',
  'Model3D',
  'RawData',
  'Spectrum',
  'TableView',
  'Trigger',
  'Waveform',
];

describe('widget registry completeness', () => {
  it('every def has component, icon and valid i18n label', () => {
    for (const def of WIDGET_DEFS) {
      // memo 组件是 ExoticComponent 对象 — 只能断言「已挂载实现」
      expect(def.Component, `${def.kind}.Component`).toBeDefined();
      expect(def.icon, `${def.kind}.icon`).toBeDefined();
      expect(def.labelKey, `${def.kind}.labelKey`).toBeTypeOf('string');
      // i18n t 缺键回退 key 本身 — 回退即视为漏配
      expect(translate(def.labelKey as never, 'en'), `${def.kind}.labelKey(en)`).not.toBe(def.labelKey);
      expect(translate(def.labelKey as never, 'zh'), `${def.kind}.labelKey(zh)`).not.toBe(def.labelKey);
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

  it('节点占位的每个 kind 都有宿主窗口面板 — 否则节点点不出去, 控件等于不可用', () => {
    const hosts = new Set<WidgetKind>();
    for (const def of HOST_PANEL_DEFS) {
      if (def.hostWidgetKind !== null) hosts.add(def.hostWidgetKind);
    }
    for (const kind of PLACEHOLDER_KINDS) {
      expect(ALL_KINDS, `PLACEHOLDER_KINDS 里的 ${kind} 不是已注册 kind`).toContain(kind);
      expect(hosts.has(kind), `${kind} 在节点内是占位, 但 PANEL_DEFS 里没有对应的宿主面板`).toBe(true);
    }
  });

  it('窗口面板的宿主 kind 必须已注册 — 注册表与面板注册表共用同一键空间', () => {
    for (const def of HOST_PANEL_DEFS) {
      if (def.hostWidgetKind === null) continue;
      expect(ALL_KINDS, `panel ${def.panelKind} 的宿主 ${def.hostWidgetKind} 未注册`).toContain(
        def.hostWidgetKind
      );
    }
  });
});
