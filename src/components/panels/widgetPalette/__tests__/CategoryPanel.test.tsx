import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DiscoveredEndpoint } from '../../../../types';
import { act, cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { renderWithI18n } from '../../../../test/renderWithI18n';;
import { ActivityBar } from '../../../layout/ActivityBar';
import { CategoryPanel } from '../CategoryPanel';
import { useAppStore } from '../../../../store/appStore';
import { useHistoryStore } from '../../../../store/historyStore';
import { dockDrag, __resetForTests } from '../../../../lib/dockDrag';
import { addPaletteNode } from '../../../../lib/utils/paletteCreation';
import { api } from '../../../../lib/tauri/tauri';
import { resetCapabilityCatalogForTests } from '../../../../lib/acquisition/capabilityCatalog';
import { seedModelCatalogForTests, mockPrepareEcho, makeCatalog, defaultTestCatalog } from '../../../../test/modelCatalog';
import { resetModelCatalogForTests } from '../../../../store/modelCatalogStore';
import type { ModelDescriptor } from '../../../../types/generated/ModelDescriptor';
import type { JsonValue } from '../../../../types/generated/serde_json/JsonValue';

/// 设备条目夹具 — defaultConfig 即 prepare 的配置默认值来源 (后端合同)
function deviceModel(driverId: string, defaultConfig: Record<string, unknown>): ModelDescriptor {
  return {
    id: `driver:${driverId}`, family: 'device', schemaVersion: 1,
    display: { fallbackLabel: driverId, category: 'device', sortValue: 0 },
    ui: { rendererKey: 'acquisition', editorKey: 'acquisition', icon: null },
    configuration: { schemaVersion: 1, jsonSchema: { type: 'object' }, uiHints: null },
    defaultConfig: defaultConfig as ModelDescriptor['defaultConfig'], variants: [], actions: ['createNode'],
    availability: { state: 'available', reason: null },
  };
}
const catalogWithTestDrivers = (): ReturnType<typeof makeCatalog> => makeCatalog([
  ...defaultTestCatalog().models,
  deviceModel('future', { baud: 115200 }),
  deviceModel('rtu', {}),
]);

const operations = { byteSource: false, byteSink: false, discover: false, browse: false, read: true, subscribe: true, write: true, method: false };
const endpoint = {
  id: 'primary', displayName: 'Endpoint A', transport: 'future', direction: 'peer',
  status: { state: 'available', detail: null }, ports: [],
  configuration: { schemaVersion: 3, jsonSchema: { type: 'object' as const, properties: {} }, uiHints: null },
  display: null,
};
const adapter = { adapterId: 'future', displayName: 'Future interface', contractVersion: 1, protocol: 'future', transport: 'future', direction: 'peer', operations, dataDomains: ['points'], endpoints: [endpoint], display: null };

beforeEach(() => {
  __resetForTests();
  resetCapabilityCatalogForTests();
  seedModelCatalogForTests(catalogWithTestDrivers());
  mockPrepareEcho();
  useHistoryStore.getState().clearHistory();
  useAppStore.setState({
    rfNodes: [],
    rfEdges: [],
    controlTabs: [{ id: 'default', name: 'Tab 1' }],
    activeControlTabId: 'default',
    lang: 'en',
    sidebarView: 'category',
    sidebarVisible: true,
    activeCategory: 'math',
  });
});

afterEach(() => {
  cleanup();
  __resetForTests();
  resetModelCatalogForTests();
  vi.restoreAllMocks();
});

const flush = () => act(async () => { await Promise.resolve(); });

describe('CategoryPanel', () => {
  it('连续渲染各分类条目', async () => {
    renderWithI18n(<CategoryPanel />);
    await flush();
    expect(screen.getByRole('button', { name: 'Add' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Square Root' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Waveform' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Knob' })).toBeInTheDocument();
  });

  it('切换 activeCategory 保留连续目录', async () => {
    renderWithI18n(<CategoryPanel />);
    await flush();
    act(() => useAppStore.setState({ activeCategory: 'input' }));
    expect(screen.getByRole('button', { name: 'Knob' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add' })).toBeInTheDocument();
  });

  it('搜索框过滤全部分类的条目', async () => {
    renderWithI18n(<CategoryPanel />);
    await flush();
    fireEvent.change(screen.getByPlaceholderText('Search devices, widgets, categories…'), { target: { value: 'root' } });
    expect(screen.getByRole('button', { name: 'Square Root' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Add' })).not.toBeInTheDocument();
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'waveform' } });
    expect(screen.getByRole('button', { name: 'Waveform' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Square Root' })).not.toBeInTheDocument();
  });

  it('点击文字目录清除搜索并定位分类，支持重复跳转', async () => {
    renderWithI18n(<CategoryPanel />);
    await flush();
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'waveform' } });
    fireEvent.click(screen.getByRole('button', { name: 'Signal processing' }));
    expect(screen.getByRole('textbox')).toHaveValue('');
    expect(screen.getByRole('button', { name: 'Add' })).toBeInTheDocument();
    expect(useAppStore.getState().sidebarVisible).toBe(true);
  });

  it('分类跳转滚动目录到目标标题，而不切掉其他分类', async () => {
    const { container } = renderWithI18n(<CategoryPanel />);
    await flush();
    const list = container.querySelector<HTMLElement>('[data-tour="palette-list"]')!;
    const target = screen.getByRole('region', { name: 'Interactive inputs' });
    vi.spyOn(list, 'getBoundingClientRect').mockImplementation(() => ({ top: 0 } as DOMRect));
    vi.spyOn(target, 'getBoundingClientRect').mockImplementation(() => ({ top: 240 - list.scrollTop } as DOMRect));
    fireEvent.click(screen.getByRole('button', { name: 'Interactive inputs' }));
    await waitFor(() => expect(list.scrollTop).toBe(240));
    expect(screen.getByRole('button', { name: 'Waveform' })).toBeInTheDocument();
    list.scrollTop = 0;
    fireEvent.click(screen.getByRole('button', { name: 'Interactive inputs' }));
    await waitFor(() => expect(list.scrollTop).toBe(240));
  });

  it('滚动同步活动栏与顶部导航，不把滚动位置吸回分类开头', async () => {
    const { container } = renderWithI18n(<><ActivityBar activeView="category" onSelect={() => undefined} /><CategoryPanel /></>);
    await flush();
    const list = container.querySelector<HTMLElement>('[data-tour="palette-list"]')!;
    const regions = screen.getAllByRole('region');
    vi.spyOn(list, 'getBoundingClientRect').mockReturnValue({ top: 0 } as DOMRect);
    regions.forEach((region, index) => {
      vi.spyOn(region, 'getBoundingClientRect').mockReturnValue({ top: (index - 4) * 100 - 20 } as DOMRect);
    });
    list.scrollTop = 420;
    fireEvent.scroll(list);
    expect(useAppStore.getState().activeCategory).toBe('string');
    expect(screen.getByTitle('Text processing')).toHaveAttribute('aria-current', 'location');
    expect(screen.getAllByRole('button', { name: 'Text processing' })).toHaveLength(2);
    for (const button of screen.getAllByRole('button', { name: 'Text processing' })) {
      expect(button).toHaveAttribute('aria-current', 'location');
    }
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 30)); });
    expect(list.scrollTop).toBe(420);
  });

  it('滚动搜索结果时同步分类并保留查询', async () => {
    const { container } = renderWithI18n(<CategoryPanel />);
    await flush();
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'waveform' } });
    const list = container.querySelector<HTMLElement>('[data-tour="palette-list"]')!;
    vi.spyOn(list, 'getBoundingClientRect').mockReturnValue({ top: 0 } as DOMRect);
    const regions = screen.getAllByRole('region');
    regions.forEach((region, index) => {
      vi.spyOn(region, 'getBoundingClientRect').mockReturnValue({ top: (index - 1) * 100 } as DOMRect);
    });
    fireEvent.scroll(list);
    expect(useAppStore.getState().activeCategory).toBe('display');
    expect(screen.getByRole('textbox')).toHaveValue('waveform');
    expect(screen.getByRole('button', { name: 'Waveform' })).toBeInTheDocument();
  });

  it('分类跳转请求平滑滚动', async () => {
    const { container } = renderWithI18n(<CategoryPanel />);
    await flush();
    const list = container.querySelector<HTMLElement>('[data-tour="palette-list"]')!;
    const scrollTo = vi.fn();
    list.scrollTo = scrollTo;
    fireEvent.click(screen.getByRole('button', { name: 'Interactive inputs' }));
    await waitFor(() => expect(scrollTo).toHaveBeenCalledWith(expect.objectContaining({ behavior: 'smooth' })));
    vi.spyOn(window, 'matchMedia').mockReturnValue({ ...window.matchMedia('(prefers-reduced-motion: reduce)'), matches: true });
    fireEvent.click(screen.getByRole('button', { name: 'Display' }));
    await waitFor(() => expect(scrollTo).toHaveBeenCalledWith(expect.objectContaining({ behavior: 'instant' })));
  });

  it('拖拽设备保留发现配置与画布位置，抑制拖拽后的重复点击添加', async () => {
    vi.spyOn(api, 'listAdapterCapabilities').mockResolvedValue([{
      ...adapter, operations: { ...operations, discover: true },
    }]);
    vi.spyOn(api, 'discoverAcquisitionEndpoints').mockResolvedValue([{
      adapterId: 'future', discoveryId: 'COM3', displayName: 'USB sensor',
      configurationPatch: { port: 'COM3' }, metadata: {},
    }] as DiscoveredEndpoint[]);
    renderWithI18n(<CategoryPanel />);
    const device = await screen.findByRole('button', { name: /USB sensor/ });
    const begin = vi.spyOn(dockDrag, 'begin').mockImplementation(() => undefined);
    fireEvent.pointerDown(device, { button: 0 });
    expect(begin).toHaveBeenCalledOnce();
    const spec = begin.mock.calls[0][1];
    expect(spec.kind).toBe('widget');
    if (spec.kind !== 'widget') throw new Error('Expected widget drag');
    expect(addPaletteNode(spec.widget, { x: 410, y: 220 }, 'default')).toBe(true);
    vi.spyOn(dockDrag, 'consumeClick').mockReturnValue(true);
    fireEvent.click(device);
    // 设备创建经目录 prepare (异步) — 节点就绪后断言
    await waitFor(() => expect(useAppStore.getState().rfNodes).toHaveLength(1));
    const nodes = useAppStore.getState().rfNodes;
    expect(nodes).toHaveLength(1);
    expect(nodes[0]).toMatchObject({ position: { x: 410, y: 220 }, data: { node: {
      name: 'USB sensor', driver: 'future', config: { port: 'COM3' },
    } } });
  });

  it('搜索无匹配时显示空态提示', async () => {
    renderWithI18n(<CategoryPanel />);
    await flush();
    fireEvent.change(screen.getByPlaceholderText('Search devices, widgets, categories…'), { target: { value: 'zzz-nothing' } });
    expect(screen.getByText('No matches')).toBeInTheDocument();
  });

  it('transport 分类加载并渲染后端 capability 设备条目', async () => {
    vi.spyOn(api, 'listAdapterCapabilities').mockResolvedValue([adapter]);
    useAppStore.setState({ activeCategory: 'transport' });
    renderWithI18n(<CategoryPanel />);
    fireEvent.click(await screen.findByText('Add a connection manually'));
    expect(await screen.findByRole('button', { name: 'Future interface' })).toBeInTheDocument();
  });

  it('在面板选择设备时合并发现参数并保留默认值', async () => {
    vi.spyOn(api, 'listAdapterCapabilities').mockResolvedValue([{ ...adapter,
      operations: { ...operations, discover: true },
      endpoints: [{ ...endpoint, configuration: { ...endpoint.configuration,
        jsonSchema: { type: 'object', properties: {
          port: { type: 'string' }, baud: { type: 'integer', default: 115200 },
        } },
      } }],
    }]);
    vi.spyOn(api, 'discoverAcquisitionEndpoints').mockResolvedValue([{
      adapterId: 'future', discoveryId: '/dev/usb0', displayName: 'USB sensor',
      configurationPatch: { port: '/dev/usb0' },
      metadata: { vid: 0x1a86, pid: 0x7523, serialNumber: 'ABC' },
    }]);
    useAppStore.setState({ activeCategory: 'transport' });
    renderWithI18n(<CategoryPanel />);
    const device = await screen.findByRole('button', { name: /USB sensor.*VID/ });
    expect(screen.getByText('VID 1A86 · PID 7523')).toBeInTheDocument();
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '1a86' } });
    expect(device).toBeInTheDocument();
    fireEvent.click(device);
    await waitFor(() => expect(useAppStore.getState().rfNodes).toHaveLength(1));
    const nodes = useAppStore.getState().rfNodes;
    expect(nodes).toHaveLength(1);
    expect(nodes[0].data.node).toMatchObject({ name: 'USB sensor',
      driver: 'future', config: { port: '/dev/usb0', baud: 115200 },
    });
    expect(useAppStore.getState().connectionStates[nodes[0].id]).not.toBe('Connected');
  });

  it('显示后端系统名称和蓝牙类型并解释 USB 标识不适用', async () => {
    vi.spyOn(api, 'listAdapterCapabilities').mockResolvedValue([{
      ...adapter, operations: { ...operations, discover: true },
    }]);
    vi.spyOn(api, 'discoverAcquisitionEndpoints').mockResolvedValue([{
      adapterId: 'future', discoveryId: '/dev/cu.Headset', displayName: 'Headset',
      configurationPatch: { port: '/dev/cu.Headset' },
      metadata: { portType: 'Bluetooth', description: 'Headset' },
    }]);
    useAppStore.setState({ activeCategory: 'transport' });
    renderWithI18n(<CategoryPanel />);
    expect(await screen.findByText('Headset')).toBeInTheDocument();
    expect(screen.getByText('/dev/cu.Headset')).toBeInTheDocument();
    expect(screen.getByText('Bluetooth serial')).toBeInTheDocument();
    expect(screen.getByTitle('Not a USB device; no USB VID/PID')).toBeInTheDocument();
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'bluetooth' } });
    expect(screen.getByText('Headset')).toBeInTheDocument();
  });

  it('同一设备只显示一次，切换连接方式使用对应配置补丁', async () => {
    vi.spyOn(api, 'listAdapterCapabilities').mockResolvedValue(['serial', 'rtu'].map((id) => ({
      ...adapter, adapterId: id, displayName: id, operations: { ...operations, discover: true },
    })));
    const patchFor = (id: string): JsonValue =>
      id === 'rtu' ? { portName: 'COM3' } : { port_name: 'COM3' };
    vi.spyOn(api, 'discoverAcquisitionEndpoints').mockImplementation((id): Promise<DiscoveredEndpoint[]> => Promise.resolve([{
      adapterId: id, discoveryId: 'COM3', displayName: 'USB bridge',
      configurationPatch: patchFor(id),
      metadata: { deviceId: 'serial:COM3' },
    }]));
    useAppStore.setState({ activeCategory: 'transport' });
    renderWithI18n(<CategoryPanel />);
    expect(await screen.findAllByText('USB bridge')).toHaveLength(1);
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'rtu:primary' } });
    fireEvent.click(screen.getByRole('button', { name: /USB bridge/ }));
    await waitFor(() => expect(useAppStore.getState().rfNodes).toHaveLength(1));
    expect(useAppStore.getState().rfNodes[0].data.node).toMatchObject({
      driver: 'rtu', config: { portName: 'COM3' },
    });
  });

  it('点击条目添加对应控件 (含 op 变体)', async () => {
    renderWithI18n(<CategoryPanel />);
    await flush();
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    // 目录变体条目经 prepare 创建 (异步), 文档显示名取变体 fallbackLabel
    await waitFor(() => expect(useAppStore.getState().rfNodes).toHaveLength(1));
    const nodes = useAppStore.getState().rfNodes;
    expect(nodes).toHaveLength(1);
    const widget = (nodes[0].data as { widget: { kind: string; params: { op?: string; label?: string } } }).widget;
    expect(widget.kind).toBe('Math');
    expect(widget.params.op).toBe('add');
    expect(widget.params.label).toBe('Math add');
  });
});
