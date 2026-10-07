import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { QUICK_START_TEMPLATES, getTemplate } from '../quickstart/templates';
import { applyTemplate } from '../quickstart/applyTemplate';
import { useAppStore } from '../../store/appStore';
import { selectWidgets } from '../../store/appStoreHelpers';
import { resetModelCatalogForTests } from '../../store/modelCatalogStore';
import { seedModelCatalogForTests, mockPrepareEcho } from '../../test/modelCatalog';
import { canvasNode } from '../nodes/document';
import { deviceTreeCanvasNodes } from '../acquisition/deviceTree';
import type { DeviceTreeNodeDecl, ProtocolConfig, ProtocolSchema } from '../../types';

describe('quick-start node documents', () => {
  beforeEach(() => {
    seedModelCatalogForTests();
    mockPrepareEcho();
  });

  afterEach(() => {
    resetModelCatalogForTests();
    vi.restoreAllMocks();
  });

  it('ships the core examples', () => {
    expect(QUICK_START_TEMPLATES.map(template => template.id))
      .toEqual(expect.arrayContaining(['math', 'filter', 'fft', 'can', 'serial', 'custom-protocol', 'text-protocol', 'demo']));
  });

  it('every template is a self-contained tab-owned v4 document', async () => {
    for (const template of QUICK_START_TEMPLATES) {
      const snapshot = await template.build();
      expect(snapshot.version).toBe(4);
      const workspace = snapshot.workspace!;
      expect(workspace.tabs).toHaveLength(1);
      expect(workspace.graphs).toHaveLength(1);
      const graph = workspace.graphs[0];
      const ids = new Set(graph.documents.map(document => document.id));
      expect(ids.size).toBe(graph.documents.length);
      expect(graph.documents.every(document => document.tabId === graph.tab_id)).toBe(true);
      expect(graph.documents.some(document => document.kind === 'device')).toBe(true);
      const device = graph.documents.find(document => document.kind === 'device');
      const childIds = device?.kind === 'device' ? device.config.node.children.map(child => child.id) : [];
      expect(device?.kind === 'device' && device.config.node.children.some(child => child.driver === 'protocol-engine')).toBe(true);
      expect(graph.edges.every(edge => [...ids, ...childIds].includes(edge.source) && [...ids, ...childIds].includes(edge.target))).toBe(true);
      expect(snapshot.dockCards?.['properties-main']?.tabIds).toEqual(['node-properties-fixed']);
    }
  });

  it('模板工作区带齐固定外壳 Tab, 且不生成已删除的旧版波形窗口', async () => {
    for (const template of QUICK_START_TEMPLATES) {
      const snapshot = await template.build();
      const workspace = snapshot.workspace!;
      const ids = workspace.dataTabs.map((tab) => tab.id);

      // 0.7.x 起常驻的固定波形窗口已移除; 模板再注入它, 快速开始就会凭空多出一个
      // 没有宿主控件、因此没有数据源的 Waveform 窗口 (codeberg #4)
      expect(workspace.dataTabs.some((tab) => tab.type === 'waveform')).toBe(false);
      expect(ids).not.toContain('waveform-fixed');

      // 快照整体替换 dataTabs — 固定外壳 Tab 必须自带, 默认落点必须存在
      expect(ids).toEqual(
        expect.arrayContaining(['compile-errors-fixed', 'compile-results-fixed', 'node-properties-fixed']),
      );
      expect(ids).toContain(workspace.activeDataTabId);

      // 派生数据窗口必须绑定宿主控件 (无 widgetId 的 waveform 窗口拿不到数据源)
      expect(
        workspace.dataTabs
          .filter((tab) => ['waveform-extra', 'spectrum', 'raw'].includes(tab.type))
          .every((tab) => tab.widgetId),
      ).toBe(true);

      // 数据卡只承载数据 Tab, 且激活 Tab 属于该卡
      const dataCard = snapshot.dockCards!['data-main'];
      expect(dataCard.tabIds).not.toContain('node-properties-fixed');
      expect(dataCard.activeTabId).toBe(workspace.activeDataTabId);
    }
  });

  it('协议引擎带「协议转换」目标 — 数值模板重编码为 JustFloat', async () => {
    for (const template of QUICK_START_TEMPLATES) {
      const device = (await template.build()).workspace!.graphs[0].documents.find((doc) => doc.kind === 'device');
      const protocol = device?.kind === 'device'
        ? device.config.node.children.find((child) => child.driver === 'protocol-engine') : undefined;
      const config = protocol?.config as { protocol: ProtocolConfig; convertTo: ProtocolConfig | null };
      if (template.id === 'can') {
        // Slcan 产 CAN 帧而非数值帧 — 重编码为 JustFloat 语义不成立, 保持无转换
        expect(config.convertTo).toBeNull();
        continue;
      }
      expect(config.convertTo?.kind).toBe('JustFloat');
    }
  });

  it('文本协议模板演示 str → 数值: FireWater 解析 + 转换到 JustFloat', async () => {
    const snapshot = await getTemplate('text-protocol')!.build();
    const documents = snapshot.workspace!.graphs[0].documents;
    const device = documents.find((doc) => doc.kind === 'device');
    const protocol = device?.kind === 'device'
      ? device.config.node.children.find((child) => child.driver === 'protocol-engine') : undefined;
    const config = protocol?.config as { protocol: ProtocolConfig; convertTo: ProtocolConfig };
    expect(config.protocol.kind).toBe('FireWater');
    expect(config.convertTo).toEqual({ kind: 'JustFloat', channels: 2 });
    expect(documents.filter((doc) => doc.kind === 'widget').map((doc) => doc.id))
      .toEqual(['nd-text-ch0', 'nd-text-ch1', 'wf-text']);
    expect(snapshot.workspace!.graphs[0].edges.every((edge) => edge.source === 'template-protocol')).toBe(true);
  });

  it('模板控件整列排在协议引擎投影卡片右侧', async () => {
    for (const template of QUICK_START_TEMPLATES) {
      const documents = (await template.build()).workspace!.graphs[0].documents;
      // 真实投影: 协议引擎在画布上是设备树子节点的卡片 (位置 = 设备 x + 深度×240)
      const cards = deviceTreeCanvasNodes(documents.map((doc) => canvasNode(doc)));
      expect(cards.map((card) => card.id)).toContain('template-protocol');

      const widgetX = documents.filter((doc) => doc.kind === 'widget').map((doc) => doc.layout.x);
      for (const card of cards) {
        const right = card.position.x + (card.width ?? 0);
        // 控件盖在协议引擎卡片上时, 卡片被完全遮住, 看起来像"没生成协议引擎"
        expect(widgetX.filter((x) => x < right)).toEqual([]);
      }
    }
  });

  it('the serial example is Serial + test attribute -> JustFloat', async () => {
    const graph = (await getTemplate('serial')!.build()).workspace!.graphs[0];
    const device = graph.documents.find(document => document.kind === 'device');
    expect(device?.kind === 'device' && device.config.node.driver).toBe('serial');
    const simulation = device?.kind === 'device'
      ? device.config.node.children.find((child) => child.driver === 'simulation')
      : undefined;
    expect((simulation?.config as { sampleRate?: number } | undefined)?.sampleRate).toBeGreaterThan(0);
    const protocol = device?.kind === 'device'
      ? device.config.node.children.find(child => child.driver === 'protocol-engine') : undefined;
    expect(((protocol?.config as { protocol?: { kind?: string } }).protocol)?.kind).toBe('JustFloat');
    expect(graph.edges.some(edge => edge.source === protocol?.id)).toBe(true);
  });

  it('custom protocol keeps named decode ports and an encoding rule', async () => {
    const graph = (await getTemplate('custom-protocol')!.build()).workspace!.graphs[0];
    const device = graph.documents.find(document => document.kind === 'device');
    const protocol = device?.kind === 'device'
      ? device.config.node.children.find(child => child.driver === 'protocol-engine') : undefined;
    const schema = (protocol?.config as { schema?: ProtocolSchema }).schema;
    expect(schema?.preset).toBe('custom');
    expect(schema?.decode.filter(block => block.type === 'field').map(block => block.portName))
      .toEqual(['speed', 'temp']);
    expect(schema?.encode?.length).toBeGreaterThan(0);
    expect(graph.edges.some(edge => edge.source_handle === 'speed')).toBe(true);
  });
});

describe('template application', () => {
  beforeEach(() => {
    seedModelCatalogForTests();
    mockPrepareEcho();
    useAppStore.setState({
      controlTabs: [{ id: 'default', name: 'Tab 1' }],
      dataTabs: [], activeControlTabId: 'default', activeDataTabId: '',
      rfNodes: [], rfEdges: [], connectionStates: {},
    } as never);
  });

  afterEach(() => {
    resetModelCatalogForTests();
    vi.restoreAllMocks();
  });

  it('merge remaps every node and owns all of them from a new tab', async () => {
    const snapshot = await getTemplate('math')!.build();
    const originalIds = new Set(snapshot.workspace!.graphs[0].documents.map(document => document.id));
    await applyTemplate(snapshot, 'merge');
    const state = useAppStore.getState();
    const tab = state.controlTabs.find(candidate => candidate.id.startsWith('tpl-'))!;
    const nodes = state.rfNodes.filter(node => node.data.tabId === tab.id);
    expect(nodes).toHaveLength(snapshot.workspace!.graphs[0].documents.length);
    expect(nodes.every(node => !originalIds.has(node.id))).toBe(true);
    const treeIds = nodes.flatMap(node => node.type === 'acquisition'
      ? ((node.data.node as DeviceTreeNodeDecl).children.map(child => child.id)) : []);
    expect(treeIds).not.toContain('template-protocol');
    expect(treeIds.some(id => state.rfEdges.some(edge => edge.source === id))).toBe(true);
    expect(state.rfEdges.every(edge => [...nodes.map(node => node.id), ...treeIds].includes(edge.source)
      && [...nodes.map(node => node.id), ...treeIds].includes(edge.target))).toBe(true);
  });

  it('replace restores the exact document and remains disconnected', async () => {
    const snapshot = await getTemplate('filter')!.build();
    await applyTemplate(snapshot, 'replace');
    const state = useAppStore.getState();
    expect(state.rfNodes).toHaveLength(snapshot.workspace!.graphs[0].documents.length);
    expect(selectWidgets(state)).toHaveLength(snapshot.workspace!.graphs[0].documents.filter(document => document.kind === 'widget').length);
    expect(Object.values(state.connectionStates)).not.toContain('Connected');
  });

  it('replace 后不残留旧版常驻波形窗口, 默认落点仍可解析', async () => {
    await applyTemplate(await getTemplate('filter')!.build(), 'replace');
    const state = useAppStore.getState();
    const ids = state.dataTabs.map((tab) => tab.id);
    // 旧版 fixed waveform 窗口不得再随快速开始出现 (codeberg #4)
    expect(state.dataTabs.some((tab) => tab.type === 'waveform')).toBe(false);
    expect(ids).not.toContain('waveform-fixed');
    // 固定外壳 Tab + 默认落点随快照落地
    expect(ids).toEqual(
      expect.arrayContaining(['compile-errors-fixed', 'compile-results-fixed', 'node-properties-fixed']),
    );
    expect(ids).toContain(state.activeDataTabId);
    // 模板自带的 Waveform 控件仍有绑定宿主的数据窗口
    const waveformTabs = state.dataTabs.filter((tab) => tab.type === 'waveform-extra');
    expect(waveformTabs).toHaveLength(1);
    expect(waveformTabs[0].widgetId).toBe('wf-filter');
  });
});
