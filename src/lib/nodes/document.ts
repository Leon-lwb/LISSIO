import type { Node } from '@xyflow/react';
import type { DeviceTreeNodeDecl, ProtocolConfig, ProtocolSchema, WidgetConfig } from '../../types';
import type { AcquisitionNodeData } from '../acquisition/acquisitionNodes';
import type { ProtocolNodeData } from '../../store/appStoreHelpers';
import { customWidgetPortDeclaration } from '../utils/nodeDef';
import { errorText } from '../../types/errors';
import { schemaPortNames } from '../utils/protocolSchema';

type Business =
  | { kind: 'device'; config: { node: DeviceTreeNodeDecl } }
  | { kind: 'protocol'; config: { protocol: ProtocolConfig; convertTo: ProtocolConfig | null; schema: ProtocolSchema } }
  | { kind: 'pointSelector'; config: { points: string[] } }
  | { kind: 'widget'; config: { widgetKind: WidgetConfig['kind']; params: Record<string, unknown>; customPorts: { inputs: string[]; outputs: string[] } | null } };

export type NodeDocument = Business & {
  id: string;
  tabId: string;
  label: string;
  layout: { x: number; y: number; width: number | null; height: number | null };
};

export function nodeDocument(node: Node): NodeDocument {
  let business: Business;
  let label = typeof node.data.label === 'string' ? node.data.label : '';
  switch (node.type) {
    case 'acquisition': {
      const { node: device } = node.data as AcquisitionNodeData;
      business = { kind: 'device', config: { node: device } };
      label = device.name;
      break;
    }
    case 'protocol': {
      const data = node.data as ProtocolNodeData;
      business = { kind: 'protocol', config: { protocol: data.config, convertTo: data.convertTo, schema: data.schema } };
      break;
    }
    case 'point-selector': business = { kind: 'pointSelector', config: { points: node.data.points as string[] } }; break;
    case 'widget': {
      const widget = node.data.widget as WidgetConfig;
      const { id: _id, label: widgetLabel, ...params } = widget.params;
      label = widgetLabel;
      const customPorts = widget.kind === 'Custom' ? customWidgetPortDeclaration(widget) : null;
      business = { kind: 'widget', config: { widgetKind: widget.kind, params, customPorts } };
      break;
    }
    default: throw new Error(`Unknown node kind: ${node.type}`);
  }
  return {
    id: node.id,
    tabId: node.data.tabId as string,
    label,
    layout: { ...node.position, width: node.width ?? null, height: node.height ?? null },
    ...business,
  };
}

/** 单条画布节点无法投影为文档 — 只影响该节点, 不中断同批其他节点。 */
export interface NodeDocumentFailure {
  nodeId: string;
  message: string;
}

export type NodeDocumentOutcome =
  | { document: NodeDocument }
  | { failure: NodeDocumentFailure };

/**
 * 逐节点容错投影。
 *
 * `nodeDocument` 对未知 `node.type` 与缺失的必填字段抛异常, 而描述管线是**批量**
 * 的: 一条抛异常会让整批描述从未发出, 画布上全部 widget 节点失去端口且不自愈
 * (协议/设备节点的端口来自其他来源, 故不受影响 —— 表现为「只有 widget 集体丢端口」)。
 * 把「该节点失败」放进返回值, 使容错成为类型层面的事实, 而不是调用方需要记得
 * 遵守的约定。
 */
export function tryNodeDocument(node: Node): NodeDocumentOutcome {
  try {
    return { document: nodeDocument(node) };
  } catch (error) {
    return {
      failure: {
        nodeId: node.id,
        message: errorText(error),
      },
    };
  }
}

/// 设备节点配置负载 — 当前格式是**扁平驱动参数** (`{ port_name, baud_rate, … }`),
/// 与能力面板消费的 `configSchema` 属性名、驱动 `validate` 收到的 payload 同层。
///
/// v0.7.0 的 prepare 曾把整份 `TransportConfig` 信封 (`{ kind, params }`) 写进
/// `NodeDecl.config`: 属性面板按 schema 属性名读不到任何字段 (整页空值/首选项,
/// 且「选中当前显示值」不触发 change — 必须先选别的再选回来), 驱动 `validate`
/// 也因缺 `port_name`/`baud_rate` 等字段失败 (设备连不上)。
///
/// 这类文档的负载有两处来源: `params` (默认值) 与信封顶层 (发现到的端口补丁、
/// 以及面板按扁平 schema 写回的用户编辑)。这里在唯一的 wire→画布入口合成一次,
/// 顶层键覆盖 `params` — 保留用户已改的值与发现的端口; 首次图同步即把修正后的
/// 负载写回持久化文档 (同一格式内的纠错, 不是旧版本格式迁移)。
function devicePayload(config: unknown): unknown {
  if (typeof config !== 'object' || config === null || Array.isArray(config)) return config;
  const { kind, params, ...topLevel } = config as { kind?: unknown; params?: unknown };
  if (typeof kind !== 'string') return config;
  if (params === null || typeof params !== 'object' || Array.isArray(params)) return config;
  return { ...params as Record<string, unknown>, ...topLevel };
}

export function canvasNode(doc: NodeDocument, previous?: Node): Node {
  const base = {
    id: doc.id,
    position: { x: doc.layout.x, y: doc.layout.y },
    width: doc.layout.width ?? undefined,
    height: doc.layout.height ?? undefined,
    selected: previous?.selected,
    data: { tabId: doc.tabId, label: doc.label },
  };
  switch (doc.kind) {
    case 'device': return {
      ...base,
      type: 'acquisition',
      data: {
        ...base.data,
        node: { ...doc.config.node, id: doc.id, name: doc.label, config: devicePayload(doc.config.node.config) },
        card: previous?.data.card,
        ports: previous?.data.ports,
      },
    };
    case 'protocol': return { ...base, type: 'protocol', data: { ...base.data, config: doc.config.protocol, convertTo: doc.config.convertTo,
      schema: doc.config.schema, channels: schemaPortNames(doc.config.schema?.decode ?? []).length } };
    case 'pointSelector': return { ...base, type: 'point-selector', data: { ...base.data, points: doc.config.points } };
    case 'widget': return { ...base, type: 'widget', data: { ...base.data,
      widget: { kind: doc.config.widgetKind, params: { ...doc.config.params, id: doc.id, label: doc.label } } } };
  }
}
