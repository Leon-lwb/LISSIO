// 数据面板菜单条目 / Tab 轮转 —— 条目来源已从手写双表收敛为注册表派生。
//
// 这里钉住两件事:
//   1. 条目集合与顺序与收敛前逐项一致 (独立面板 6 条 + 派生面板 10 条);
//   2. 独立面板的身份来自注册表 (can / logic 是「无宿主面板」), 但每条都必须
//      在 dataTabs 侧有对应 store action 才能真正打开 —— 否则就是死条目。

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useAppStore } from '../appStore';
import { cycleDataPanelTab, getAvailableDataPanelEntries } from '../slices/dataTabs';
import { HOST_PANEL_DEFS, SINGLETON_PANEL_DEFS } from '../../components/panels/registry/panelDefs';
import type { WidgetConfig } from '../../types';

/// 收敛前的条目顺序 (standalone 6 + derived 9); table-view 是注册表补齐的派生面板。
const EXPECTED_TYPES = [
  'compile-errors',
  'compile-results',
  'can',
  'logic',
  'operation-history',
  'node-properties',
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
];

const EXPECTED_GROUPS = [
  'standalone',
  'standalone',
  'standalone',
  'standalone',
  'standalone',
  'standalone',
  'derived',
  'derived',
  'derived',
  'derived',
  'derived',
  'derived',
  'derived',
  'derived',
  'derived',
  'derived',
];

function widgetNode(widget: WidgetConfig) {
  return {
    id: widget.params.id,
    type: 'widget' as const,
    position: { x: 0, y: 0 },
    data: { widget },
  };
}

function stubActions() {
  return {
    addCompileErrorsTab: vi.fn(),
    addCompileResultsTab: vi.fn(),
    addCanTab: vi.fn(),
    addLogicTab: vi.fn(),
    addOperationHistoryTab: vi.fn(),
    addNodePropertiesTab: vi.fn(),
    addDataTab: vi.fn(),
    setActiveDataTab: vi.fn(),
    addWidgetTab: vi.fn(),
  };
}

describe('getAvailableDataPanelEntries', () => {
  it('条目集合与顺序沿用收敛前的双表', () => {
    const entries = getAvailableDataPanelEntries(
      { dataTabs: [], rfNodes: [], lang: 'en' },
      stubActions()
    );
    expect(entries.map((entry) => entry.type)).toEqual(EXPECTED_TYPES);
    expect(entries.map((entry) => entry.group)).toEqual(EXPECTED_GROUPS);
    for (const entry of entries) {
      if (entry.group === 'standalone') expect(entry.available).toBe(true);
    }
  });

  it('独立面板整库面板由注册表提供身份与标签', () => {
    const entries = getAvailableDataPanelEntries(
      { dataTabs: [], rfNodes: [], lang: 'en' },
      stubActions()
    );
    for (const def of SINGLETON_PANEL_DEFS) {
      const entry = entries.find((candidate) => candidate.type === def.tabType);
      expect(entry?.labelKey, def.panelKind).toBe(def.labelKey);
      expect(entry?.group, def.panelKind).toBe('standalone');
      expect(entry?.available, def.panelKind).toBe(true);
    }
  });

  it('派生面板覆盖注册表的每个宿主面板, 且按画布控件决定可用性', () => {
    const empty = getAvailableDataPanelEntries(
      { dataTabs: [], rfNodes: [], lang: 'en' },
      stubActions()
    );
    for (const def of HOST_PANEL_DEFS) {
      const entry = empty.find((candidate) => candidate.type === def.tabType);
      expect(entry?.labelKey, def.panelKind).toBe(def.labelKey);
      expect(entry?.group, def.panelKind).toBe('derived');
      expect(entry?.available, def.panelKind).toBe(false);
    }

    const pie: WidgetConfig = {
      kind: 'PieChart',
      params: { id: 'pie-1', label: 'Pie', segments: ['A', 'B'] },
    };
    const withPie = getAvailableDataPanelEntries(
      { dataTabs: [], rfNodes: [widgetNode(pie)], lang: 'en' },
      stubActions()
    );
    expect(withPie.find((entry) => entry.type === 'pie')?.available).toBe(true);
    expect(withPie.find((entry) => entry.type === 'waveform-extra')?.available).toBe(false);
  });

  it('派生面板的 open 用首个同类控件开窗', () => {
    const waveform: WidgetConfig = {
      kind: 'Waveform',
      params: {
        id: 'wave-1',
        label: 'Waveform',
        channels: 4,
        max_points: 10000,
        visible_channels: [true, true, true, true],
      },
    };
    const actions = stubActions();
    const entries = getAvailableDataPanelEntries(
      { dataTabs: [], rfNodes: [widgetNode(waveform)], lang: 'en' },
      actions
    );
    entries.find((entry) => entry.type === 'waveform-extra')?.open();
    expect(actions.addWidgetTab).toHaveBeenCalledWith(waveform);
  });

  it('独立面板的 open 走各自 store action', () => {
    const actions = stubActions();
    const entries = getAvailableDataPanelEntries(
      { dataTabs: [], rfNodes: [], lang: 'en' },
      actions
    );
    entries.find((entry) => entry.type === 'can')?.open();
    entries.find((entry) => entry.type === 'logic')?.open();
    entries.find((entry) => entry.type === 'compile-errors')?.open();
    expect(actions.addCanTab).toHaveBeenCalledTimes(1);
    expect(actions.addLogicTab).toHaveBeenCalledTimes(1);
    expect(actions.addCompileErrorsTab).toHaveBeenCalledTimes(1);
  });
});

describe('cycleDataPanelTab', () => {
  beforeEach(() => {
    useAppStore.setState({ dataTabs: [], activeDataTabId: '', rfNodes: [] });
  });

  it('无匹配 Tab 时创建独立面板', () => {
    cycleDataPanelTab('can');
    expect(useAppStore.getState().dataTabs.map((tab) => tab.type)).toEqual(['can']);
    cycleDataPanelTab('can');
    // 已存在 → 切过去, 不重复创建
    expect(useAppStore.getState().dataTabs).toHaveLength(1);
  });

  it('无匹配 Tab 且画布无同类控件时派生面板不创建', () => {
    cycleDataPanelTab('pie');
    expect(useAppStore.getState().dataTabs).toEqual([]);
  });

  it('多个同类 Tab 之间轮转', () => {
    useAppStore.setState({
      dataTabs: [
        { id: 'pie-a', type: 'pie', name: 'A', closable: true },
        { id: 'pie-b', type: 'pie', name: 'B', closable: true },
      ],
      activeDataTabId: 'pie-a',
    });
    cycleDataPanelTab('pie');
    expect(useAppStore.getState().activeDataTabId).toBe('pie-b');
    cycleDataPanelTab('pie');
    expect(useAppStore.getState().activeDataTabId).toBe('pie-a');
  });

  it('单个匹配 Tab 直接激活', () => {
    useAppStore.setState({
      dataTabs: [
        { id: 'logic-a', type: 'logic', name: 'L', closable: true },
        { id: 'pie-a', type: 'pie', name: 'A', closable: true },
      ],
      activeDataTabId: 'pie-a',
    });
    cycleDataPanelTab('logic');
    expect(useAppStore.getState().activeDataTabId).toBe('logic-a');
  });
});
