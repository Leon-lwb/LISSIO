//! 快速开始模板 — 模板只声明 modelId / 变体 / 显式场景参数与连线布局;
//! 节点文档由后端 prepare 批量产出 (默认值/归一化的唯一来源)。
//!
//! 应用时:
//!   - 替换: 清空工作区后按分区应用 (不含设置)
//!   - 合并: 作为新控件标签页追加 (见 applyTemplate.ts 的 ID 重映射)
//!
//! 内置模板: 数学 / 滤波器 / 频谱分析 / CAN / 串口 / 综合演示。

import { defaultSimulation } from '../acquisition/simulation';
import type { NodeDocument } from '../nodes/document';
import { prepareNodesFromCatalog, prepareProtocolDocument } from '../models/createFromCatalog';
import { edgeToGraphEdge, rawDataPortId } from '../utils/nodeDef';
import { ALL_BACKUP_SECTIONS, type AppSnapshot } from '../tauri/appExport';
import type { Edge } from '@xyflow/react';
import type { DockNode, DockCard } from '../../store/dockStore';
import type { DataTab, ControlTab, DeviceTreeNodeDecl, ProtocolConfig, ProtocolSchema, SimulationConfig, SlcanConfig, WidgetConfig } from '../../types';

const TAB = 'default';
/// 模板内结构节点 id (应用时由 applySnapshot/mergeTemplate 处理)
const TRANSPORT_ID = 'template-transport';
const PROTOCOL_ID = 'template-protocol';

// ==================== 构建辅助 ====================

/// 模板控件声明 — modelId/变体/参数与画布位置, 文档由 prepare 产出
interface WidgetSpec {
  modelId: string;
  variantId?: string;
  nodeId: string;
  label: string;
  position: { x: number; y: number };
  configPatch?: Record<string, unknown>;
}

async function prepareWidgetSpecs(specs: WidgetSpec[]): Promise<NodeDocument[]> {
  const prepared = await prepareNodesFromCatalog(specs.map((spec) => ({
    modelId: spec.modelId,
    variantId: spec.variantId,
    nodeId: spec.nodeId,
    label: spec.label,
    position: spec.position,
    configPatch: spec.configPatch,
    tabId: TAB,
  })), TAB);
  return prepared.map((entry) => entry.document);
}

function widgetOf(doc: NodeDocument): { kind: WidgetConfig['kind']; id: string; label: string } | null {
  if (doc.kind !== 'widget') return null;
  const params = doc.config.params as { label?: unknown };
  return {
    kind: doc.config.widgetKind,
    id: doc.id,
    label: typeof params.label === 'string' ? params.label : doc.label,
  };
}

type TemplateDevice = Pick<DeviceTreeNodeDecl, 'name' | 'driver' | 'schemaVersion' | 'config'> & { simulation?: SimulationConfig };

function simulatedSerial(channels: number, sampleRate: number): TemplateDevice {
  return {
    name: 'Serial',
    driver: 'serial',
    schemaVersion: 1,
    config: {
      port_name: '', baud_rate: 115200, data_bits: 8, parity: 'none', stop_bits: 'one', flow_control: 'none',
    },
    simulation: { ...defaultSimulation(), channels, sampleRate },
  };
}

/// 设备树文档 — 仿真子节点 + 协议引擎子节点 (schema 由 prepareProtocolDocument 产出)
function deviceNode(device: TemplateDevice, protocol: { protocol: ProtocolConfig; schema: ProtocolSchema }): NodeDocument {
  return {
    id: TRANSPORT_ID,
    tabId: TAB,
    label: device.name,
    kind: 'device',
    layout: { x: 40, y: 40, width: 200, height: null },
    config: {
      node: {
        id: TRANSPORT_ID,
        name: device.name,
        driver: device.driver,
        schemaVersion: device.schemaVersion,
        config: device.config,
        enabled: true,
        capabilityEndpointId: 'device',
        children: [...(device.simulation ? [{
          id: `${TRANSPORT_ID}::simulation`,
          name: 'simulation',
          driver: 'simulation',
          schemaVersion: 1,
          config: device.simulation as unknown as Record<string, unknown>,
          enabled: true,
          children: [],
        }] : []), {
          id: PROTOCOL_ID,
          name: protocol.schema.preset === 'custom' ? 'Custom' : protocol.protocol.kind,
          driver: 'protocol-engine',
          schemaVersion: 1,
          config: { protocol: protocol.protocol, convertTo: null, schema: protocol.schema },
          enabled: true,
          children: [],
        }],
      },
    },
  };
}

/// 固定波形数据 Tab (始终存在, 不可关闭)
const WAVEFORM_FIXED: DataTab = {
  id: 'waveform-fixed',
  type: 'waveform',
  name: 'Waveform',
  closable: false,
};

/// 节点属性面板 Tab — 默认布局的专属卡承载 (与 dockStore defaultRoot 同形)
const NODE_PROPERTIES_FIXED: DataTab = {
  id: 'node-properties-fixed',
  type: 'node-properties',
  name: 'Properties',
  closable: true,
};

/// 部分控件会派生一个数据 Tab (Waveform/Spectrum/RawData)
function derivedDataTab(widget: { kind: WidgetConfig['kind']; id: string; label: string }): DataTab | null {
  switch (widget.kind) {
    case 'Waveform':
      return { id: widget.id, type: 'waveform-extra', name: 'Waveform', widgetId: widget.id, closable: true };
    case 'Spectrum':
      return { id: widget.id, type: 'spectrum', name: widget.label, widgetId: widget.id, closable: true };
    case 'RawData':
      return { id: widget.id, type: 'raw', name: widget.label, widgetId: widget.id, closable: true };
    default:
      return null;
  }
}

/// 默认 Dock 布局: 上方左侧画布 | 右侧属性面板 (较小), 下方数据面板
/// (与 dockStore defaultRoot 同形 — 两处需保持一致)
function buildDock(
  controlTabIds: string[],
  dataTabIds: string[],
  activeDataTabId: string
): { dockRoot: DockNode; dockCards: Record<string, DockCard> } {
  const cards: Record<string, DockCard> = {
    'control-main': {
      id: 'control-main',
      kind: 'control',
      tabIds: controlTabIds,
      activeTabId: controlTabIds[0] ?? null,
    },
    // data-main 先于 properties-main — reconcile 安置无家可归 tab 时取「第一张
    // 该 kind 卡片」(插入序), 属性专属卡不应收容其他数据 tab
    'data-main': {
      id: 'data-main',
      kind: 'data',
      tabIds: dataTabIds,
      activeTabId: activeDataTabId ?? dataTabIds[0] ?? null,
    },
    'properties-main': {
      id: 'properties-main',
      kind: 'data',
      tabIds: ['node-properties-fixed'],
      activeTabId: 'node-properties-fixed',
    },
  };
  const root: DockNode = {
    id: 'split-root',
    type: 'split',
    dir: 'col',
    children: [
      {
        id: 'split-top',
        type: 'split',
        dir: 'row',
        children: [
          { id: 'node-control', type: 'card', cardId: 'control-main' },
          { id: 'node-props', type: 'card', cardId: 'properties-main' },
        ],
        sizes: [72, 28],
      },
      { id: 'node-data', type: 'card', cardId: 'data-main' },
    ],
    sizes: [55, 45],
  };
  return { dockRoot: root, dockCards: cards };
}

/// 模板默认聚焦的数据 Tab — 应用模板后首先看向「编译结果」,核对连线质量
/// (compile-errors / compile-results 是 appStore 初始 dataTabs 里固定存在的两个 Tab)
const TEMPLATE_DEFAULT_ACTIVE_DATA_TAB = 'compile-results-fixed';

/// 组装快照 — widget 文档来自 prepare, 设备树为显式场景声明
function buildSnapshot(opts: {
  name: string;
  device: TemplateDevice;
  protocol: { protocol: ProtocolConfig; schema: ProtocolSchema };
  widgetDocs: NodeDocument[];
  edges: Edge[];
  extraDataTabs?: DataTab[];
}): AppSnapshot {
  const widgets = opts.widgetDocs
    .map(widgetOf)
    .filter((widget): widget is NonNullable<typeof widget> => widget !== null);
  const controlTabs: ControlTab[] = [
    { id: TAB, name: opts.name },
  ];
  const derivedTabs: DataTab[] = [];
  for (const widget of widgets) {
    const t = derivedDataTab(widget);
    if (t && !derivedTabs.some((x) => x.id === t.id)) derivedTabs.push(t);
  }
  const extraTabs = opts.extraDataTabs ?? [];
  const dataTabs: DataTab[] = [WAVEFORM_FIXED, NODE_PROPERTIES_FIXED, ...derivedTabs, ...extraTabs];
  const activeDataTabId = TEMPLATE_DEFAULT_ACTIVE_DATA_TAB;
  const { dockRoot, dockCards } = buildDock(
    [TAB],
    // 属性面板 tab 由专属卡 (properties-main) 承载, 不进数据卡
    dataTabs.map((t) => t.id).filter((id) => id !== NODE_PROPERTIES_FIXED.id),
    activeDataTabId
  );

  return {
    version: 4,
    exportedAt: new Date().toISOString(),
    sections: ALL_BACKUP_SECTIONS,
    // 模板不含设置 — 应用时保留用户当前设置
    workspace: {
    tabs: controlTabs.map(({ id, name }) => ({ id, name })),
    dataTabs,
    activeDataTabId,
    activeControlTabId: TAB,
    graphs: [{ tab_id: TAB, documents: [
      deviceNode(opts.device, opts.protocol),
      ...opts.widgetDocs,
    ],
    edges: opts.edges.map(edgeToGraphEdge) }],
    rawDataViewPrefs: {},
    },
    dockRoot,
    dockCards,
    sidebarDock: 'left',
  };
}

// ==================== 模板定义 ====================

export interface QuickStartTemplate {
  id: string;
  nameKey: string;
  descKey: string;
  build: () => Promise<AppSnapshot>;
}

async function mathTemplate(): Promise<AppSnapshot> {
  const [mSin, ndSin, mAdd, ndAdd] = await prepareWidgetSpecs([
    { modelId: 'widget:Math', variantId: 'sin', nodeId: 'm-sin', label: 'sin', position: { x: 300, y: 80 } },
    { modelId: 'widget:NumberDisplay', nodeId: 'nd-sin', label: 'sin(ch0)', position: { x: 560, y: 80 } },
    { modelId: 'widget:Math', variantId: 'add', nodeId: 'm-add', label: 'sum', position: { x: 300, y: 260 } },
    { modelId: 'widget:NumberDisplay', nodeId: 'nd-add', label: 'ch0+ch1', position: { x: 560, y: 260 } },
  ]);
  return buildSnapshot({
    name: 'Math',
    device: simulatedSerial(4, 1000),
    protocol: await prepareProtocolDocument({ kind: 'JustFloat', channels: 4 }, TAB),
    widgetDocs: [mSin, ndSin, mAdd, ndAdd],
    edges: [
      { id: 'e1', source: PROTOCOL_ID, sourceHandle: 'ch0', target: 'm-sin', targetHandle: 'in0' },
      { id: 'e2', source: 'm-sin', sourceHandle: 'result', target: 'nd-sin', targetHandle: 'value' },
      { id: 'e3', source: PROTOCOL_ID, sourceHandle: 'ch0', target: 'm-add', targetHandle: 'in0' },
      { id: 'e4', source: PROTOCOL_ID, sourceHandle: 'ch1', target: 'm-add', targetHandle: 'in1' },
      { id: 'e5', source: 'm-add', sourceHandle: 'result', target: 'nd-add', targetHandle: 'value' },
    ],
  });
}

async function filterTemplate(): Promise<AppSnapshot> {
  const [fLp, ndLp, wf] = await prepareWidgetSpecs([
    { modelId: 'widget:Filter', variantId: 'Lowpass', nodeId: 'f-lp', label: 'Lowpass',
      position: { x: 300, y: 80 }, configPatch: { cutoff: 100, sampleRate: 1000 } },
    { modelId: 'widget:NumberDisplay', nodeId: 'nd-lp', label: 'filtered', position: { x: 560, y: 80 } },
    { modelId: 'widget:Waveform', nodeId: 'wf-filter', label: 'Filtered', position: { x: 300, y: 260 },
      configPatch: { channels: 4, dynamicSeries: true } },
  ]);
  return buildSnapshot({
    name: 'Filter',
    device: simulatedSerial(4, 1000),
    protocol: await prepareProtocolDocument({ kind: 'JustFloat', channels: 4 }, TAB),
    widgetDocs: [fLp, ndLp, wf],
    edges: [
      { id: 'e1', source: PROTOCOL_ID, sourceHandle: 'ch0', target: 'f-lp', targetHandle: 'in0' },
      { id: 'e2', source: 'f-lp', sourceHandle: 'result', target: 'nd-lp', targetHandle: 'value' },
      { id: 'e3', source: PROTOCOL_ID, sourceHandle: 'ch0', target: 'wf-filter', targetHandle: 'CH0' },
      { id: 'e4', source: 'f-lp', sourceHandle: 'result', target: 'wf-filter', targetHandle: 'CH1' },
    ],
  });
}

async function canTemplate(): Promise<AppSnapshot> {
  return buildSnapshot({
    name: 'CAN',
    device: { name: 'Slcan', driver: 'slcan', schemaVersion: 1,
      config: { port_name: '', baud_rate: 115200, can_bitrate: 'Bps500k' } satisfies SlcanConfig },
    protocol: await prepareProtocolDocument({ kind: 'Slcan' }, TAB),
    widgetDocs: [],
    edges: [],
    extraDataTabs: [{ id: 'can-main', type: 'can', name: 'CAN', closable: true }],
  });
}

async function serialTemplate(): Promise<AppSnapshot> {
  const [g0, g1, n2, n3] = await prepareWidgetSpecs([
    { modelId: 'widget:Gauge', nodeId: 'g-ch0', label: 'CH0', position: { x: 300, y: 60 } },
    { modelId: 'widget:Gauge', nodeId: 'g-ch1', label: 'CH1', position: { x: 560, y: 60 } },
    { modelId: 'widget:NumberDisplay', nodeId: 'nd-ch2', label: 'CH2', position: { x: 300, y: 260 } },
    { modelId: 'widget:NumberDisplay', nodeId: 'nd-ch3', label: 'CH3', position: { x: 560, y: 260 } },
  ]);
  return buildSnapshot({
    name: 'Serial',
    device: simulatedSerial(4, 100),
    protocol: await prepareProtocolDocument({ kind: 'JustFloat', channels: null }, TAB),
    widgetDocs: [g0, g1, n2, n3],
    edges: [
      { id: 'e1', source: PROTOCOL_ID, sourceHandle: 'ch0', target: 'g-ch0', targetHandle: 'value' },
      { id: 'e2', source: PROTOCOL_ID, sourceHandle: 'ch1', target: 'g-ch1', targetHandle: 'value' },
      { id: 'e3', source: PROTOCOL_ID, sourceHandle: 'ch2', target: 'nd-ch2', targetHandle: 'value' },
      { id: 'e4', source: PROTOCOL_ID, sourceHandle: 'ch3', target: 'nd-ch3', targetHandle: 'value' },
    ],
  });
}

async function demoTemplate(): Promise<AppSnapshot> {
  const [fLp, ndLp, mSin, gSin, wf] = await prepareWidgetSpecs([
    { modelId: 'widget:Filter', variantId: 'Lowpass', nodeId: 'f-lp', label: 'Lowpass',
      position: { x: 300, y: 60 }, configPatch: { cutoff: 50, sampleRate: 1000 } },
    { modelId: 'widget:NumberDisplay', nodeId: 'nd-lp', label: 'filtered', position: { x: 560, y: 60 } },
    { modelId: 'widget:Math', variantId: 'sin', nodeId: 'm-sin', label: 'sin', position: { x: 300, y: 220 } },
    { modelId: 'widget:Gauge', nodeId: 'g-sin', label: 'sin(ch1)', position: { x: 560, y: 220 } },
    { modelId: 'widget:Waveform', nodeId: 'wf', label: 'Filtered', position: { x: 300, y: 400 },
      configPatch: { channels: 4, dynamicSeries: true } },
  ]);
  return buildSnapshot({
    name: 'Demo',
    device: simulatedSerial(4, 1000),
    protocol: await prepareProtocolDocument({ kind: 'JustFloat', channels: 4 }, TAB),
    widgetDocs: [fLp, ndLp, mSin, gSin, wf],
    edges: [
      { id: 'e1', source: PROTOCOL_ID, sourceHandle: 'ch0', target: 'f-lp', targetHandle: 'in0' },
      { id: 'e2', source: 'f-lp', sourceHandle: 'result', target: 'nd-lp', targetHandle: 'value' },
      { id: 'e3', source: 'f-lp', sourceHandle: 'result', target: 'wf', targetHandle: 'CH0' },
      { id: 'e4', source: PROTOCOL_ID, sourceHandle: 'ch1', target: 'm-sin', targetHandle: 'in0' },
      { id: 'e5', source: 'm-sin', sourceHandle: 'result', target: 'g-sin', targetHandle: 'value' },
    ],
  });
}

async function fftTemplate(): Promise<AppSnapshot> {
  // 频域流水线: ch0 → FFT 求解器 → 频谱仪 (连线即数据源) → IFFT 重建回时域 → 波形对比
  const [fft, spec, ifft, wf] = await prepareWidgetSpecs([
    { modelId: 'widget:FFT', nodeId: 'fft-main', label: 'FFT', position: { x: 300, y: 60 },
      configPatch: { windowSize: 512, windowType: 'Hann', output: 'Magnitude', sampleRate: 1000 } },
    { modelId: 'widget:Spectrum', nodeId: 'spec-main', label: 'Spectrum', position: { x: 600, y: 60 } },
    { modelId: 'widget:IFFT', nodeId: 'ifft-main', label: 'IFFT', position: { x: 600, y: 280 } },
    { modelId: 'widget:Waveform', nodeId: 'wf-ifft', label: 'Original vs IFFT', position: { x: 300, y: 280 },
      configPatch: { channels: 4, dynamicSeries: true } },
  ]);
  return buildSnapshot({
    name: 'FFT',
    device: simulatedSerial(4, 1000),
    protocol: await prepareProtocolDocument({ kind: 'JustFloat', channels: 4 }, TAB),
    widgetDocs: [fft, spec, ifft, wf],
    edges: [
      { id: 'e1', source: PROTOCOL_ID, sourceHandle: 'ch0', target: 'fft-main', targetHandle: 'in0' },
      { id: 'e2', source: 'fft-main', sourceHandle: 'spectrum', target: 'spec-main', targetHandle: 'spectrum' },
      { id: 'e3', source: 'fft-main', sourceHandle: 'spectrum', target: 'ifft-main', targetHandle: 'spectrum' },
      { id: 'e4', source: PROTOCOL_ID, sourceHandle: 'ch0', target: 'wf-ifft', targetHandle: 'CH0' },
      { id: 'e5', source: 'ifft-main', sourceHandle: 'out0', target: 'wf-ifft', targetHandle: 'CH1' },
    ],
  });
}

/// 自定义协议演示: custom 块协议 (命名端口) + 多帧 CommandSender
/// 帧布局与测试属性生成的 JustFloat 线缆格式一致 (2×float32LE + 帧尾)。
async function customProtocolTemplate(): Promise<AppSnapshot> {
  const customSchema: ProtocolSchema = {
    preset: 'custom',
    decode: [
      { id: 'cp-f0', type: 'field', fieldType: 'float32LE', portName: 'speed' },
      { id: 'cp-f1', type: 'field', fieldType: 'float32LE', portName: 'temp' },
      { id: 'cp-tail', type: 'tail', hex: '00 00 80 7F' },
    ],
    encode: [
      { type: 'varRef', params: { portName: 'speed', fieldType: 'float32LE' } },
      { type: 'varRef', params: { portName: 'temp', fieldType: 'float32LE' } },
      { type: 'constHex', params: { hex: '00 00 80 7F' } },
    ],
  };
  const [cmd, wf, gTemp, raw] = await prepareWidgetSpecs([
    { modelId: 'widget:Command', nodeId: 'cmd-main', label: 'Command', position: { x: 260, y: 260 },
      configPatch: {
        frames: [
          {
            id: 'cmd-main-frame-1',
            label: 'Ping',
            blocks: [
              { id: 'b1', type: 'const_hex', hex: 'AA 01' },
              { id: 'b2', type: 'checksum', checksum: 'sum8' },
            ],
            appendNewline: false,
            sendMode: 'manual',
            timerMs: 1000,
          },
          {
            id: 'cmd-main-frame-2',
            label: 'Set Speed',
            blocks: [
              { id: 'b3', type: 'const_hex', hex: 'BB' },
              { id: 'b4', type: 'var_ref', portName: 'speed', fieldType: 'float32LE' },
            ],
            appendNewline: false,
            sendMode: 'manual',
            timerMs: 1000,
          },
        ],
      } },
    { modelId: 'widget:Waveform', nodeId: 'wf-custom', label: 'Speed', position: { x: 560, y: 60 },
      configPatch: { channels: 4, dynamicSeries: true } },
    { modelId: 'widget:Gauge', nodeId: 'g-temp', label: 'Temp', position: { x: 560, y: 260 } },
    { modelId: 'widget:RawData', nodeId: 'raw-custom', label: 'RawData', position: { x: 820, y: 160 } },
  ]);
  return buildSnapshot({
    name: 'Custom Protocol',
    // 测试属性按自定义 schema 的编码块生成字节流，custom decode 负责解析。
    device: simulatedSerial(2, 1000),
    protocol: { protocol: { kind: 'JustFloat', channels: 2 }, schema: customSchema },
    widgetDocs: [cmd, wf, gTemp, raw],
    edges: [
      // 命名端口 → 波形/仪表 (schema 派生端口 speed/temp)
      { id: 'e1', source: PROTOCOL_ID, sourceHandle: 'speed', target: 'wf-custom', targetHandle: 'CH0' },
      { id: 'e2', source: PROTOCOL_ID, sourceHandle: 'temp', target: 'g-temp', targetHandle: 'value' },
      // 协议字节出口 → RawData (动态端口 src:<id>:out)
      { id: 'e3', source: PROTOCOL_ID, sourceHandle: 'out', target: 'raw-custom', targetHandle: rawDataPortId(PROTOCOL_ID, 'out') },
      // 多帧发送器 → 设备写入口
      { id: 'e4', source: 'cmd-main', sourceHandle: 'loopbackOut', target: TRANSPORT_ID, targetHandle: 'tx' },
    ],
  });
}

export const QUICK_START_TEMPLATES: QuickStartTemplate[] = [
  { id: 'math', nameKey: 'templateMath', descKey: 'templateMathDesc', build: mathTemplate },
  { id: 'filter', nameKey: 'templateFilter', descKey: 'templateFilterDesc', build: filterTemplate },
  { id: 'fft', nameKey: 'templateFft', descKey: 'templateFftDesc', build: fftTemplate },
  { id: 'can', nameKey: 'templateCan', descKey: 'templateCanDesc', build: canTemplate },
  { id: 'serial', nameKey: 'templateSerial', descKey: 'templateSerialDesc', build: serialTemplate },
  { id: 'custom-protocol', nameKey: 'templateCustomProtocol', descKey: 'templateCustomProtocolDesc', build: customProtocolTemplate },
  { id: 'demo', nameKey: 'templateDemo', descKey: 'templateDemoDesc', build: demoTemplate },
];

export function getTemplate(id: string): QuickStartTemplate | undefined {
  return QUICK_START_TEMPLATES.find((t) => t.id === id);
}
