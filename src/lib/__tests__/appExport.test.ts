import { describe, expect, it, afterEach, vi } from 'vitest';
import {
  applySnapshot,
  collectPartialSnapshot,
  detectPresentSections,
  parseSnapshot,
  serializeSnapshot,
  type AppSnapshot,
} from '../tauri/appExport';
import { useAppStore } from '../../store/appStore';
import { tauriMock } from '../../test/setup';

describe('appExport 拆分备份', () => {
  afterEach(() => {
    // 复位图状态, 避免跨用例污染
    useAppStore.setState({ rfNodes: [], rfEdges: [] } as never);
  });

  it('collectPartialSnapshot 仅包含所选分区字段', () => {
    const snap = collectPartialSnapshot(['nodeGraph', 'windowLayout']);
    expect(snap.sections).toEqual(['nodeGraph', 'windowLayout']);
    expect(snap.rfNodes).toBeDefined();
    expect(snap.rfEdges).toBeDefined();
    expect(snap.dockRoot).toBeDefined();
    expect(snap.dockCards).toBeDefined();
    expect(snap.sidebarDock).toBeDefined();
    // 未选分区应为 undefined
    expect(snap.settings).toBeUndefined();
    expect(snap.widgets).toBeUndefined();
    expect(snap.controlTabs).toBeUndefined();
    expect(snap.dataTabs).toBeUndefined();
  });

  it('serialize + parse 往返保留分区标记', () => {
    // 预置一对全局节点, transportProtocol 分区才有内容
    useAppStore.setState({
      rfNodes: [
        {
          id: 'transport-1',
          type: 'transport',
          position: { x: 0, y: 0 },
          data: {
            global: true,
            config: { kind: 'Serial', params: { port_name: '', baud_rate: 115200, data_bits: 8, parity: 'none', stop_bits: 'one', flow_control: 'none' } },
            label: 'Serial',
          },
        },
        {
          id: 'protocol-1',
          type: 'protocol',
          position: { x: 200, y: 0 },
          data: { global: true, config: { kind: 'JustFloat', channels: 4 }, convertTo: null, channels: 4, label: 'JustFloat' },
        },
      ],
      rfEdges: [
        { id: 'e-tp', source: 'transport-1', sourceHandle: 'rx', target: 'protocol-1', targetHandle: 'in' },
      ],
    } as never);
    const snap = collectPartialSnapshot(['settings', 'transportProtocol']);
    const parsed = parseSnapshot(serializeSnapshot(snap));
    expect(parsed.version).toBe(3);
    expect(detectPresentSections(parsed)).toEqual(['settings', 'transportProtocol']);
  });

  it('parseSnapshot 拒绝非法 JSON 与不支持版本', () => {
    expect(() => parseSnapshot('{oops')).toThrow();
    expect(() => parseSnapshot(JSON.stringify({ version: 99, rfNodes: [] }))).toThrow();
    expect(() => parseSnapshot(JSON.stringify({ version: 3 }))).toThrow();
  });

  it('parseSnapshot 明确拒绝 v1/v2 旧版备份 (不再自动迁移)', () => {
    for (const version of [1, 2]) {
      expect(() => parseSnapshot(JSON.stringify({ version, rfNodes: [] })))
        .toThrow(/版本过旧/);
    }
  });

  it('v3 快照往返保留内容', () => {
    const snap: AppSnapshot = {
      version: 3,
      exportedAt: '',
      rfNodes: [
        { id: 'transport-1', type: 'transport', position: { x: 0, y: 0 }, data: { global: true, config: { kind: 'Serial', params: { port_name: '', baud_rate: 115200, data_bits: 8, parity: 'none', stop_bits: 'one', flow_control: 'none' } }, label: 'Serial' } },
      ],
      rfEdges: [],
    };
    const parsed = parseSnapshot(serializeSnapshot(snap));
    expect(parsed.version).toBe(3);
    expect(parsed.rfNodes?.length).toBe(1);
    expect(parsed.rfEdges?.length).toBe(0);
  });

  it('detectPresentSections 正确识别含有的分区', () => {
    const snap: AppSnapshot = {
      version: 3,
      exportedAt: '',
      rfNodes: [
        { id: 'transport-1', type: 'transport', position: { x: 0, y: 0 }, data: { global: true, config: { kind: 'Serial', params: { port_name: '', baud_rate: 115200, data_bits: 8, parity: 'none', stop_bits: 'one', flow_control: 'none' } }, label: 'Serial' } },
      ],
      rfEdges: [],
    };
    expect(detectPresentSections(snap)).toEqual(['transportProtocol']);
  });
});

describe('applySnapshot 后端图清理', () => {
  afterEach(() => {
    useAppStore.setState({
      controlTabs: [{ id: 'default', name: 'Tab 1', widgets: [] }],
      activeControlTabId: 'default',
      rfNodes: [],
      rfEdges: [],
    } as never);
  });

  it('替换 controlTabs 后对消失的 tab 调 remove_tab_graph (在存活 tab sync 之后)', async () => {
    tauriMock.invoke.mockClear();
    useAppStore.setState({
      controlTabs: [
        { id: 'default', name: 'Tab 1', widgets: [] },
        { id: 'tab-old', name: 'Old', widgets: [] },
      ],
      activeControlTabId: 'default',
      rfNodes: [],
      rfEdges: [],
    } as never);

    await applySnapshot({
      version: 3,
      exportedAt: '',
      sections: ['widgetsTabs'],
      controlTabs: [{ id: 'default', name: 'Tab 1', widgets: [] }],
    });

    await vi.waitFor(() => {
      expect(tauriMock.invoke).toHaveBeenCalledWith('remove_tab_graph', { tabId: 'tab-old' });
    });
    const calls = tauriMock.invoke.mock.calls as unknown as [string, unknown][];
    const syncIdx = calls.findIndex(
      ([cmd, args]) => cmd === 'update_tab_graph' && (args as { tabId: string }).tabId === 'default'
    );
    const removeIdx = calls.findIndex(([cmd]) => cmd === 'remove_tab_graph');
    // 先同步存活 tab (全局节点重新托管), 再移除消失的 tab
    expect(syncIdx).toBeGreaterThanOrEqual(0);
    expect(removeIdx).toBeGreaterThan(syncIdx);
  });

  it('controlTabs 未变化时不调 remove_tab_graph', async () => {
    tauriMock.invoke.mockClear();
    useAppStore.setState({
      controlTabs: [{ id: 'default', name: 'Tab 1', widgets: [] }],
      activeControlTabId: 'default',
      rfNodes: [],
      rfEdges: [],
    } as never);

    await applySnapshot({
      version: 3,
      exportedAt: '',
      sections: ['widgetsTabs'],
      controlTabs: [{ id: 'default', name: 'Tab 1', widgets: [] }],
    });

    await vi.waitFor(() => {
      expect(tauriMock.invoke).toHaveBeenCalledWith('update_tab_graph', expect.anything());
    });
    const calls = tauriMock.invoke.mock.calls as unknown as [string, unknown][];
    expect(calls.some(([cmd]) => cmd === 'remove_tab_graph')).toBe(false);
  });
});
