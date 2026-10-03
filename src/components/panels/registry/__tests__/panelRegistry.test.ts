// 数据面板注册表 — 等价性与覆盖守卫。
//
// 注册表收敛了此前四张平行表 + 两份图标 Record:
//   widgets 侧: lib/utils/widgetTab.ts 的 switch
//   菜单侧:     store/slices/dataTabs.ts 的 derivedDefs / widgetTabTypeOfKind
//   图标侧:     layout/DataTabIcon.tsx 的 switch 与 panels/DataPanelsPanel.tsx 的 PANEL_ICONS
// 这些表已被删除, 因此把它们的**旧值**作为黄金值钉在这里: 注册表必须逐项复现,
// 任何无意漂移都会在此失败。唯一有意差异是 TableView —— 旧表漏登记, 而后端面板
// 契约 (`PanelKind::TableView` / tabType "table-view") 要求它是数据面板。

import { describe, expect, it } from 'vitest';
import {
  Activity,
  AlertTriangle,
  BarChart3,
  Box,
  CircuitBoard,
  Cpu,
  Database,
  Gauge,
  History,
  Image as ImageIcon,
  LineChart,
  ListTree,
  PieChart as PieIcon,
  ScanText,
  Send,
  Settings2,
  Zap,
  type LucideIcon,
} from 'lucide-react';
import {
  HOST_PANEL_DEFS,
  PANEL_DEFS,
  PANEL_DEFS_ORDERED,
  SHELL_TAB_ICONS,
  SINGLETON_PANEL_DEFS,
  isShellTabType,
  panelDefForKind,
  panelDefForTabType,
  panelDefForWidget,
  panelIconForTabType,
  panelKindOfWidget,
} from '../panelDefs';
import { PANEL_VIEWS, SHELL_TAB_CONTENT } from '../panelViews';
import { WIDGET_REGISTRY } from '../../../widgets/registry';
import type { WidgetKind } from '../../../widgets/registryTypes';
import type { DataTabType } from '../../../../types';

/// 旧 widgetTab.ts switch 的 kind → tab 类型映射 (不含 TableView —— 见文件头注释)。
const LEGACY_WIDGET_TABS: Readonly<Record<string, DataTabType>> = {
  Waveform: 'waveform-extra',
  PieChart: 'pie',
  Image: 'image',
  Model3D: 'model3d',
  Spectrum: 'spectrum',
  Command: 'command',
  FrameDecoder: 'frame-decoder',
  RawData: 'raw',
  Trigger: 'trigger',
};

/// 旧 derivedDefs (9 条) + can / logic 的 labelKey。
const LEGACY_LABEL_KEYS: Readonly<Record<string, string>> = {
  waveform: 'dataTabWaveform',
  spectrum: 'dataTabSpectrum',
  raw: 'dataTabRawData',
  pie: 'dataTabPie',
  image: 'dataTabImage',
  model3d: 'dataTabModel3d',
  'table-view': 'tableViewLabel',
  command: 'dataTabCommand',
  'frame-decoder': 'dataTabFrameDecoder',
  trigger: 'dataTabTrigger',
  can: 'menuPanelOpenCan',
  logic: 'menuPanelOpenLogic',
};

/// 旧 DataTabIcon switch + 旧 PANEL_ICONS 合并后的结果。
/// 两份表在 waveform / spectrum / logic / compile-results 上曾经不一致, 收敛后
/// 统一取 tab 条 (DataTabIcon) 的值 —— 这是收敛的既定结果, 不是漂移。
const LEGACY_ICONS: Readonly<Record<string, LucideIcon>> = {
  waveform: LineChart,
  'waveform-extra': LineChart,
  raw: Activity,
  pie: PieIcon,
  image: ImageIcon,
  model3d: Box,
  spectrum: BarChart3,
  command: Send,
  can: Cpu,
  logic: CircuitBoard,
  'frame-decoder': ScanText,
  trigger: Zap,
  'table-view': BarChart3,
  'compile-errors': AlertTriangle,
  'compile-results': ListTree,
  'operation-history': History,
  'node-properties': Settings2,
  'recording-database': Database,
  'performance-monitor': Gauge,
};

const LEGACY_SHELL_TABS = [
  'compile-errors',
  'compile-results',
  'operation-history',
  'node-properties',
  'recording-database',
  'performance-monitor',
] as const;

describe('PANEL_DEFS 与既有平行表等价', () => {
  it('控件 kind → tab 类型逐项复现旧 widgetTab 映射', () => {
    for (const [kind, tabType] of Object.entries(LEGACY_WIDGET_TABS)) {
      expect(panelDefForWidget(kind as WidgetKind)?.tabType, kind).toBe(tabType);
      expect(panelKindOfWidget(kind as WidgetKind), kind).not.toBeNull();
    }
  });

  it('TableView 是新增的宿主面板 (旧表漏登记)', () => {
    expect(panelDefForWidget('TableView')?.tabType).toBe('table-view');
    expect(panelKindOfWidget('TableView')).toBe('table-view');
  });

  it('其余 19 类控件不是数据面板宿主', () => {
    const hosts = new Set<string>([...Object.keys(LEGACY_WIDGET_TABS), 'TableView']);
    const kinds = Object.keys(WIDGET_REGISTRY) as WidgetKind[];
    expect(kinds.length).toBe(29);
    for (const kind of kinds) {
      if (hosts.has(kind)) continue;
      expect(panelDefForWidget(kind), kind).toBeUndefined();
      expect(panelKindOfWidget(kind), kind).toBeNull();
    }
  });

  it('labelKey 逐项复现旧菜单条目', () => {
    for (const [panelKind, labelKey] of Object.entries(LEGACY_LABEL_KEYS)) {
      expect(panelDefForKind(panelKind)?.labelKey, panelKind).toBe(labelKey);
    }
  });

  it('图标逐项复现旧 DataTabIcon / PANEL_ICONS', () => {
    for (const [tabType, icon] of Object.entries(LEGACY_ICONS)) {
      expect(panelIconForTabType(tabType as DataTabType), tabType).toBe(icon);
    }
  });

  it('菜单 / 面板列表顺序沿用旧 derivedDefs, 并把 table-view 插在 model3d 之后', () => {
    expect(PANEL_DEFS_ORDERED.map((def) => def.tabType)).toEqual([
      'waveform-extra',
      'spectrum',
      'raw',
      'pie',
      'image',
      'model3d',
      'table-view',
      'command',
      'frame-decoder',
      'trigger',
      'can',
      'logic',
    ]);
  });
});

describe('注册表内部一致性', () => {
  it('覆盖后端 PanelKind 的全部 12 个身份', () => {
    expect(Object.keys(PANEL_DEFS).sort()).toEqual([
      'can',
      'command',
      'frame-decoder',
      'image',
      'logic',
      'model3d',
      'pie',
      'raw',
      'spectrum',
      'table-view',
      'trigger',
      'waveform',
    ]);
  });

  it('视图面与元数据面键空间一致', () => {
    expect(Object.keys(PANEL_VIEWS).sort()).toEqual(Object.keys(PANEL_DEFS).sort());
  });

  it('宿主面板与整库面板互补且不重叠', () => {
    const host = HOST_PANEL_DEFS.map((def) => def.panelKind);
    const singleton = SINGLETON_PANEL_DEFS.map((def) => def.panelKind);
    expect([...host, ...singleton].sort()).toEqual(Object.keys(PANEL_DEFS).sort());
    expect(host).toHaveLength(10);
    expect(singleton).toEqual(['can', 'logic']);
    for (const def of HOST_PANEL_DEFS) expect(def.hostWidgetKind).not.toBeNull();
    for (const def of SINGLETON_PANEL_DEFS) expect(def.hostWidgetKind).toBeNull();
  });

  it('delivery 与操作名自洽 (后端 panel_spec::validate 的同一条不变式)', () => {
    for (const def of PANEL_DEFS_ORDERED) {
      const { delivery, pushRequest, fetchOp } = def.dataPlane;
      if (delivery === 'push' || delivery === 'both') expect(pushRequest, def.panelKind).toBeDefined();
      else expect(pushRequest, def.panelKind).toBeUndefined();
      if (delivery === 'fetch' || delivery === 'both') expect(fetchOp, def.panelKind).toBeDefined();
      else expect(fetchOp, def.panelKind).toBeUndefined();
    }
  });

  it('image 显式声明无数据面', () => {
    expect(PANEL_DEFS.image.dataPlane.delivery).toBe('unavailable');
    expect(PANEL_DEFS.image.dataPlane.pushRequest).toBeUndefined();
    expect(PANEL_DEFS.image.dataPlane.fetchOp).toBeUndefined();
  });

  it('tab 类型可反查面板, waveform 走历史别名归一', () => {
    for (const def of PANEL_DEFS_ORDERED) {
      expect(panelDefForTabType(def.tabType)?.panelKind, def.tabType).toBe(def.panelKind);
    }
    expect(panelDefForTabType('waveform')?.panelKind).toBe('waveform');
    expect(panelDefForTabType('compile-errors')).toBeUndefined();
  });

  it('未知面板身份返回 undefined', () => {
    expect(panelDefForKind('not-a-panel')).toBeUndefined();
    expect(panelDefForKind('Waveform')).toBeUndefined();
  });
});

describe('应用外壳', () => {
  it('6 个外壳的图标与内容同集合', () => {
    expect(Object.keys(SHELL_TAB_ICONS).sort()).toEqual([...LEGACY_SHELL_TABS].sort());
    expect(Object.keys(SHELL_TAB_CONTENT).sort()).toEqual([...LEGACY_SHELL_TABS].sort());
  });

  it('isShellTabType 只认外壳', () => {
    for (const type of LEGACY_SHELL_TABS) expect(isShellTabType(type)).toBe(true);
    for (const def of PANEL_DEFS_ORDERED) {
      expect(isShellTabType(def.tabType), def.tabType).toBe(false);
    }
    expect(isShellTabType('waveform')).toBe(false);
  });

  it('外壳图标与数据面板图标同源可查', () => {
    for (const type of LEGACY_SHELL_TABS) {
      expect(panelIconForTabType(type)).toBe(SHELL_TAB_ICONS[type]);
    }
    expect(panelIconForTabType('compile-errors')).toBe(AlertTriangle);
  });
});
