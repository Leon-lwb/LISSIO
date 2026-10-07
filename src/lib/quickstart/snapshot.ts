//! 快速开始快照装配 — 模板共用的设备/协议子节点、控件 prepare、Dock 与快照组装。
//!
//! 模板本身 (每个模板的 modelId/变体/连线布局) 见 templates.ts; 本模块只负责
//! "怎么把声明拼成一份可应用的 AppSnapshot", 即默认值与归一化的落点。

import { defaultSimulation } from '../acquisition/simulation';
import type { NodeDocument } from '../nodes/document';
import { prepareNodesFromCatalog } from '../models/createFromCatalog';
import { edgeToGraphEdge } from '../utils/nodeDef';
import { ALL_BACKUP_SECTIONS, type AppSnapshot } from '../tauri/appExport';
import type { Edge } from '@xyflow/react';
import type { DockNode, DockCard } from '../../store/dockStore';
import { NODE_PROPERTIES_TAB_ID, type DataTab, type ControlTab, type DeviceTreeNodeDecl, type ProtocolConfig, type ProtocolSchema, type SimulationConfig, type WidgetConfig } from '../../types';

export const TAB = 'default';
/// 模板内结构节点 id (应用时由 applySnapshot/mergeTemplate 处理)
export const TRANSPORT_ID = 'template-transport';
export const PROTOCOL_ID = 'template-protocol';

/// 设备根节点画布位置
const DEVICE_X = 40;
const DEVICE_Y = 40;

/// 协议引擎卡片是设备树子节点在画布上的**投影** (见
/// `deviceTreeModel.deviceTreeCanvasNodes`): 位置固定为 `设备 x + 深度×240`、宽 200。
/// 模板控件必须整列排在它右侧 —— 否则第一个控件会盖在协议引擎卡片上, 看起来像
/// 「快速开始没有生成协议引擎」(codeberg 快速开始协议引擎反馈)。
export const WIDGET_COL1_X = DEVICE_X + 240 + 200 + 60;  // 协议投影 200 宽 + 60 间距
export const WIDGET_COL2_X = WIDGET_COL1_X + 260;
export const WIDGET_COL3_X = WIDGET_COL2_X + 260;

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

export async function prepareWidgetSpecs(specs: WidgetSpec[]): Promise<NodeDocument[]> {
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

export type TemplateDevice = Pick<DeviceTreeNodeDecl, 'name' | 'driver' | 'schemaVersion' | 'config'> & { simulation?: SimulationConfig };

export function simulatedSerial(channels: number, sampleRate: number): TemplateDevice {
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
/// `convertTo` = 协议引擎的「协议转换」目标: null = 不转换 (原始字节沿 out 透传);
/// 文本协议 (FireWater) → JustFloat 即"str → 数值"的转换链。
function deviceNode(
  device: TemplateDevice,
  protocol: { protocol: ProtocolConfig; schema: ProtocolSchema },
  convertTo: ProtocolConfig | null = null,
): NodeDocument {
  return {
    id: TRANSPORT_ID,
    tabId: TAB,
    label: device.name,
    kind: 'device',
    layout: { x: DEVICE_X, y: DEVICE_Y, width: 200, height: null },
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
          config: { protocol: protocol.protocol, convertTo, schema: protocol.schema },
          enabled: true,
          children: [],
        }],
      },
    },
  };
}

/// 恒定存在的应用外壳数据 Tab — id 与 appStore 初始 dataTabs (`createDataTabSlice`)
/// 及 dockStore `defaultCards['data-main']` 同源。
///
/// 工作区快照是**整体替换** `dataTabs` (见 appExport.applySnapshot): 模板不自带这三个
/// Tab 时, 应用后编译窗口会消失, 且 `activeDataTabId` (compile-results-fixed) 悬空。
/// 反向同理 —— 模板不得携带当前版本已不存在的 Tab 类型 (旧版常驻的 `waveform-fixed`
/// 会让快速开始凭空生成一个无数据源的 Waveform 窗口, codeberg #4)。
function fixedShellTabs(): DataTab[] {
  return [
    { id: 'compile-errors-fixed', type: 'compile-errors', name: 'Compile Errors', closable: false },
    { id: 'compile-results-fixed', type: 'compile-results', name: 'Compile Results', closable: false },
    // 节点属性面板 — 默认布局专属卡 (properties-main) 承载
    { id: NODE_PROPERTIES_TAB_ID, type: 'node-properties', name: 'Properties', closable: true },
  ];
}

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
/// (`fixedShellTabs` 保证该 Tab 一定随快照落地)
const TEMPLATE_DEFAULT_ACTIVE_DATA_TAB = 'compile-results-fixed';

/// 组装快照 — widget 文档来自 prepare, 设备树为显式场景声明
export function buildSnapshot(opts: {
  name: string;
  device: TemplateDevice;
  protocol: { protocol: ProtocolConfig; schema: ProtocolSchema };
  /// 协议转换目标 — 缺省不转换 (见 deviceNode)
  convertTo?: ProtocolConfig | null;
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
  const dataTabs: DataTab[] = [...fixedShellTabs(), ...derivedTabs, ...extraTabs];
  const activeDataTabId = TEMPLATE_DEFAULT_ACTIVE_DATA_TAB;
  const { dockRoot, dockCards } = buildDock(
    [TAB],
    // 属性面板 tab 由专属卡 (properties-main) 承载, 不进数据卡
    dataTabs.map((t) => t.id).filter((id) => id !== NODE_PROPERTIES_TAB_ID),
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
      deviceNode(opts.device, opts.protocol, opts.convertTo ?? null),
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

