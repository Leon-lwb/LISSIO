import { nodeDocument, canvasNode } from '../lib/nodes/document';
import { deviceTreeCanvasNodes, walkDeviceTree } from '../lib/acquisition/deviceTreeModel';
import { type Node, type Edge } from '@xyflow/react';
import type { AcquisitionNodeData } from '../lib/acquisition/acquisitionNodes';
import { loadAdapterCapabilities } from '../lib/acquisition/capabilityCatalog';
import { buildDeviceCards } from '../lib/acquisition/deviceCardModel';
import { useAppStore } from './appStore';
import {
  edgeToGraphEdge,
} from '../lib/utils/nodeDef';
import { api } from '../lib/tauri/tauri';
import type {
  DataTabMetaPayload,
  GraphSourceEventPayload,
  TabMetaPayload,
  WorkspaceSnapshotPayload,
} from '../lib/tauri/tauri';
import { notify } from '../lib/tauri/notifications';
import { nodeError } from '../lib/tauri/errorGuidance';
import { parseNodeError } from '../types/errors';
import { translate } from '../i18n';
import { widgetInputValue } from '../lib/utils/widgetValue';
import type {
  DataTab,
  WidgetConfig,
  ProtocolConfig,
  ProtocolSchema,
} from '../types';

/// 节点错误通知文案 — 统一入口 (settings 开关在 errorGuidance 内读取)

/// 非控件画布节点 data 公共字段
export interface CanvasNodeData {
  tabId: string;
  label: string;
  [key: string]: unknown;
}

export interface ProtocolNodeData extends CanvasNodeData {
  config: ProtocolConfig;
  /// 可选协议转换目标 (null = 无转换)
  convertTo: ProtocolConfig | null;
  /// 数值输出口通道数 (ch0..chN) — 手动配置值或自动检测值 (预设路径用)
  channels: number;
  /// 协议帧 schema (协议 = 帧 schema; 预设为工厂产物, 用户编辑块后 preset='custom')
  schema: ProtocolSchema;
}

export const DEFAULT_PROTOCOL_CONFIG: ProtocolConfig = { kind: 'JustFloat', channels: null };

/// 节点是否为设备、协议或点位选择等结构节点
export function isStructuralNode(n: Node): boolean {
  return n.type === 'protocol' || n.type === 'acquisition' || n.type === 'point-selector';
}

/// widget 配置派生选择器 — rfNodes 是 widget 配置的唯一权威
/// (画布节点 data.widget 持有配置; 平铺数组已删除, 由本选择器按需派生)。
/// 缓存做双重引用稳定: rfNodes 引用不变直接复用; rfNodes 变化 (拖动/连线等)
/// 但全部 widget 配置对象身份未变时也复用旧数组 —
/// 保证 useAppStore((s) => selectWidgets(s)) 只在某个 widget 配置真正变化时重渲染。
let selectWidgetsCache: { source: Node[]; widgets: WidgetConfig[] } | null = null;
export function selectWidgets(state: { rfNodes: Node[] }): WidgetConfig[] {
  const source = state.rfNodes;
  if (selectWidgetsCache?.source === source) return selectWidgetsCache.widgets;
  const widgets: WidgetConfig[] = [];
  for (const n of source) {
    if (n.type === 'widget' && n.data?.widget) {
      widgets.push(n.data.widget as WidgetConfig);
    }
  }
  const prev = selectWidgetsCache?.widgets;
  if (prev?.length === widgets.length && prev.every((w, i) => w === widgets[i])) {
    selectWidgetsCache = { source, widgets: prev };
    return prev;
  }
  selectWidgetsCache = { source, widgets };
  return widgets;
}

/// 同步指定 tab 的节点图到后端
///
/// 连线拓扑的后端权威写入路径之一 (另两条: 拓扑 op connect/disconnect_edge 与
/// MCP update_graph, 三方共用 `apply_tab_graph_parts` 同一编译提交入口)。
/// - 提交载荷附带每节点端口提示 (后端拓扑 op 解析默认 handle / RawData 改写)
/// - 附带 base_version 乐观并发基线: 期间被拓扑 op / MCP 推进版本时收到
///   `GraphVersionConflict` → 拉取权威源图采纳合并后重试一次
/// - 成功响应写回新版本号; 编译失败 toast 提示 (真实原因) 并把文案返回给调用方
///
/// 返回: 用户可读的错误文案; 成功为 undefined
async function doSyncTabGraph(tabId: string, allowConflictRetry = true): Promise<string | undefined> {
  // 采纳护栏: 提交在途期间本 tab 的 graph:source 回声暂缓采纳 (在途提交的
  // 响应/冲突路径已收敛) — 否则回声会把画布刚落、尚未提交的变更覆盖掉
  activeSyncs.add(tabId);
  try {
    return await doSyncTabGraphOnce(tabId, allowConflictRetry);
  } finally {
    activeSyncs.delete(tabId);
  }
}

async function doSyncTabGraphOnce(
  tabId: string,
  allowConflictRetry: boolean
): Promise<string | undefined> {
  const state = useAppStore.getState();
  const tabNodes = state.rfNodes.filter(n => n.data.tabId === tabId);
  const ids = new Set([...tabNodes, ...deviceTreeCanvasNodes(tabNodes)].map(n => n.id));
  const documents = tabNodes.map(nodeDocument);
  const edges = state.rfEdges.filter(e => ids.has(e.source) && ids.has(e.target)).map(edgeToGraphEdge);

  try {
    const derived = await api.updateTabGraph(tabId, documents, edges, state.graphVersion);
    // 后端单一权威: 版本号 + 本次图变化涉及的节点派生数据
    if (derived?.version != null) state.setGraphVersion(derived.version);
    if (derived?.nodes) state.setDerived(derived.nodes);
    return undefined;
  } catch (err) {
    // 版本冲突: 期间有其他写入方 (拓扑 op / MCP) — 拉权威源图采纳合并后重试一次
    if (allowConflictRetry && isVersionConflictError(err)) {
      const source = await api.getSourceGraph(tabId).catch(() => null);
      if (source) {
        adoptSourceGraph(source);
        return doSyncTabGraph(tabId, false);
      }
    }
    const lang = useAppStore.getState().lang;
    const message = nodeError(lang, err);
    notify.error(
      translate('notifNodeGraphSyncFailed', lang),
      message,
      { source: 'syncTabGraph' }
    );
    return message;
  }
}

/// 后端 IPC 错误是否为图版本冲突 (GraphVersionConflict)
function isVersionConflictError(err: unknown): boolean {
  const data =
    err !== null && typeof err === 'object'
      ? ((err as Record<string, unknown>).data as { current?: unknown } | null)
      : null;
  if (data?.current != null) return true;
  return parseNodeError(err).message.includes('版本冲突');
}

// ---- graph:source 事件采纳 (画布 = 投影) ----

/// 每 tab 提交链 — 串行化同 tab 连发提交, 防止乱序整图替换互相覆盖
let workspaceWrites: Promise<unknown> = Promise.resolve();

/** All document mutations share the workspace version and one ordered queue. */
export function enqueueWorkspaceWrite<T>(write: () => Promise<T>): Promise<T> {
  const next = workspaceWrites.then(write, write);
  workspaceWrites = next.catch(() => undefined);
  return next;
}

export function removeTabGraphFromBackend(tabId: string): Promise<void> {
  return enqueueWorkspaceWrite(async () => {
    // Undo may have restored this tab before its queued deletion executes.
    if (useAppStore.getState().controlTabs.some(tab => tab.id === tabId)) return;
    const derived = await api.removeTabGraph(tabId);
    if (derived?.version != null) useAppStore.getState().setGraphVersion(derived.version);
    if (derived?.nodes) useAppStore.getState().setDerived(derived.nodes);
  });
}
/// 正在提交的 tab 集合 — graph:source 事件在提交在途时暂缓采纳 (由响应/冲突路径收敛)
const activeSyncs = new Set<string>();

/** 该 tab 是否有图提交在途 */
export function isSyncInFlight(tabId: string): boolean {
  return activeSyncs.has(tabId);
}

/// 同步指定 tab 的节点图到后端 — 同 tab 连发提交串行化
///
/// 返回用户可读错误文案 (成功为 undefined); 内部已 toast, 调用方按需消费返回值
/// (内置 AI 的画布操作工具把文案回传给模型自我修正)。需要严格时序的调用方
/// (删除 tab: 先重同步存活 tab 再移除) 可 await 本函数。
export function syncTabGraphToBackend(tabId: string): Promise<string | undefined> {
  return enqueueWorkspaceWrite(async () => {
    if (!useAppStore.getState().controlTabs.some(tab => tab.id === tabId)) return undefined;
    return doSyncTabGraph(tabId);
  }).catch(() => undefined);
}

/// JSON 值深比较 (键序无关) — 后端 serde_json 反序列化会对对象键排序,
/// 不能用字符串比较判断 widget 参数是否变化
function jsonDeepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    return a.every((x, i) => jsonDeepEqual(x, b[i]));
  }
  const ka = Object.keys(a);
  const kb = Object.keys(b);
  if (ka.length !== kb.length) return false;
  const objB = b as Record<string, unknown>;
  return ka.every((k) => k in objB && jsonDeepEqual((a as Record<string, unknown>)[k], objB[k]));
}

export function adoptSourceGraph(event: GraphSourceEventPayload): void {
  const state = useAppStore.getState();
  state.setGraphVersion(event.version);
  const oldIds = new Set(state.rfNodes.filter(n => n.data.tabId === event.tab_id).flatMap(n => n.type === 'acquisition'
    ? walkDeviceTree((n.data as AcquisitionNodeData).node).map(child => child.id) : [n.id]));
  const adoptedNodes = event.documents.map(doc => {
    const previous = state.rfNodes.find(n => n.id === doc.id);
    return previous && jsonDeepEqual(nodeDocument(previous), doc) ? previous : canvasNode(doc, previous);
  });
  const rfNodes = [...state.rfNodes.filter(n => !(n.data.tabId === event.tab_id)), ...adoptedNodes];
  const adoptedEdges: Edge[] = event.edges.map(e => ({ id: e.id, source: e.source, sourceHandle: e.source_handle, target: e.target, targetHandle: e.target_handle }));
  const rfEdges = [...state.rfEdges.filter(e => !oldIds.has(e.source) && !oldIds.has(e.target)), ...adoptedEdges];
  if (jsonDeepEqual(state.rfNodes, rfNodes) && jsonDeepEqual(state.rfEdges, rfEdges)) return;
  const widgets = selectWidgets({ rfNodes });
  const dataTabs = state.dataTabs.map(tab => {
    const owner = widgets.find(w => w.params.id === tab.widgetId);
    return owner ? { ...tab, name: owner.params.label } : tab;
  });
  useAppStore.setState({ rfNodes, rfEdges, dataTabs });
  for (const widget of widgets) {
    const value = widgetInputValue(widget);
    if (value !== null) state.setInputValue(widget.params.id, value);
  }
}

/// 从某节点沿数值边向上溯源, 找到第一个全局 Protocol 节点 id (波形等 Sink 的数据源)
/// 无连接或溯源不到时返回 null
export function traceProtocolSource(nodeId: string, edges: Edge[], nodes: Node[]): string | null {
  const globalProtocolIds = new Set(
    nodes.filter((n) => isStructuralNode(n) && n.type === 'protocol').map((n) => n.id)
  );
  const visited = new Set<string>();
  const stack = [nodeId];
  while (stack.length > 0) {
    const cur = stack.pop()!;
    if (visited.has(cur)) continue;
    visited.add(cur);
    if (cur !== nodeId && globalProtocolIds.has(cur)) return cur;
    for (const e of edges) {
      if (e.target !== cur) continue;
      // 字节边不参与数值溯源
      const sh = e.sourceHandle ?? '';
      if (sh === 'loopbackOut' || sh === 'rx' || sh === 'out') continue;
      stack.push(e.source);
    }
  }
  return null;
}

/// 找到某设备节点沿字节边下游的第一个 Protocol 节点 id
export function downstreamProtocolOf(transportNodeId: string, edges: Edge[], nodes: Node[]): string | null {
  const protocolIds = new Set(
    nodes.filter((n) => isStructuralNode(n) && n.type === 'protocol').map((n) => n.id)
  );
  const visited = new Set<string>();
  const stack = [transportNodeId];
  while (stack.length > 0) {
    const cur = stack.pop()!;
    if (visited.has(cur)) continue;
    visited.add(cur);
    if (cur !== transportNodeId && protocolIds.has(cur)) return cur;
    for (const e of edges) {
      if (e.source === cur) stack.push(e.target);
    }
  }
  return null;
}

/// 从某节点沿字节边向上溯源，找到第一个字节设备节点 id
/// (RawData 单通道模式的发送目标 = 通道连线对应的串口; 找不到返回 null)
export function traceTransportSource(nodeId: string, edges: Edge[], nodes: Node[]): string | null {
  const transportIds = new Set(
    nodes.filter((n) => n.type === 'acquisition').map((n) => n.id)
  );
  // 起点本身就是 Transport (通道 = 某串口的 rx 口) — 直接返回
  if (transportIds.has(nodeId)) return nodeId;
  // 字节平面源端口: Transport.rx / Protocol.out / CommandSender.loopbackOut / FrameDecoder.raw
  const BYTE_SOURCE_HANDLES = new Set(['rx', 'out', 'loopbackOut', 'raw']);
  const visited = new Set<string>();
  const stack = [nodeId];
  while (stack.length > 0) {
    const cur = stack.pop()!;
    if (visited.has(cur)) continue;
    visited.add(cur);
    if (transportIds.has(cur)) return cur;
    for (const e of edges) {
      if (e.target !== cur) continue;
      // 只沿字节边上溯 (数值口/控件输出不参与)
      if (!BYTE_SOURCE_HANDLES.has(e.sourceHandle ?? '')) continue;
      stack.push(e.source);
    }
  }
  return null;
}

// ---- 启动水合 (workspace_get) + tab 元数据同步 ----

/// 从后端水合工作区快照 — 启动时调用一次
///
/// 返回是否水合了持久化工作区: false = 无持久化 (全新安装 / 后端不可达),
/// 前端保持默认状态并走初始同步 + 种子流程; true = 本地已被后端权威快照
/// 覆盖 (控件 tab / 数据面板 / widget 配置 / 画布 / 边 / 版本基线),
/// 后端启动时已完成逐 tab 重编译, 不再初始同步。
export async function hydrateWorkspaceFromBackend(): Promise<boolean> {
  let snap: WorkspaceSnapshotPayload | null;
  try {
    snap = await api.workspaceGet();
  } catch {
    return false;
  }
  if (!snap) return false;

  const rfNodes = snap.graphs.flatMap(g => g.documents.map(doc => canvasNode(doc)));
  const cards = await loadAdapterCapabilities().then(buildDeviceCards).catch((error: unknown) => {
    console.error('[workspace] 设备能力目录加载失败, 设备节点端口将不可用:', error);
    return [];
  });
  for (const node of rfNodes) {
    if (node.type !== 'acquisition') continue;
    const data = node.data as AcquisitionNodeData;
    const card = cards.find(c => c.adapter.adapterId === data.node.driver && c.endpoint.id === data.node.capabilityEndpointId);
    if (card) {
      data.card = card;
      data.ports = card.endpoint.ports.map(p => ({ id: p.id, direction: p.direction, domain: p.dataDomain }));
    }
  }
  const edges: Edge[] = snap.graphs.flatMap(g => g.edges.map(e => ({
    id: e.id, source: e.source, sourceHandle: e.source_handle, target: e.target, targetHandle: e.target_handle,
  })));

  // 2. tab 元数据 (控件 tab 至少保留一个; 数据面板兜底注入 fixed 两页 —
  //    与备份快照应用同规则)
  const controlTabs = (snap.tabs.length
    ? snap.tabs
    : [{ id: 'default', name: 'Tab 1' }]
  ).map((t) => ({ id: t.id, name: t.name }));
  const dataTabs: DataTab[] = snap.data_tabs.filter((tab) => tab.type !== 'acquisition-endpoint').map((t) => ({
    id: t.id,
    type: t.type as DataTab['type'],
    name: t.name,
    closable: t.closable,
    ...(t.widget_id != null ? { widgetId: t.widget_id } : {}),
  }));
  for (const ft of [
    { id: 'compile-errors-fixed', type: 'compile-errors', name: 'Compile Errors', closable: false },
    { id: 'compile-results-fixed', type: 'compile-results', name: 'Compile Results', closable: false },
    // 旧工作区快照无属性面板 tab — 兜底补入 (默认布局卡片按 id 承载它)
    { id: 'node-properties-fixed', type: 'node-properties', name: 'Properties', closable: true },
  ] as DataTab[]) {
    if (!dataTabs.some((t) => t.id === ft.id)) dataTabs.push(ft);
  }
  const widgets = selectWidgets({ rfNodes });
  for (const tab of dataTabs) {
    if (!tab.widgetId) continue;
    const owner = widgets.find((widget) => widget.params.id === tab.widgetId);
    if (owner) tab.name = owner.params.label;
  }

  useAppStore.setState({
    controlTabs,
    activeControlTabId: controlTabs[0].id,
    dataTabs,
    activeDataTabId: dataTabs[0]?.id ?? 'compile-results-fixed',
    rfNodes,
    rfEdges: edges,
    graphVersion: snap.version ?? null,
  });
  for (const widget of widgets) {
    const value = widgetInputValue(widget);
    if (value !== null) useAppStore.getState().setInputValue(widget.params.id, value);
  }
  return true;
}

/// tab 元数据整表覆盖到后端工作区 (控件 tab / 数据面板增删改名后由订阅触发)
export function syncWorkspaceMeta(): void {
  const state = useAppStore.getState();
  const tabs: TabMetaPayload[] = state.controlTabs.map((t) => ({
    id: t.id,
    name: t.name,
  }));
  const dataTabs: DataTabMetaPayload[] = state.dataTabs.map((t) => ({
    id: t.id,
    name: t.name,
    type: t.type,
    closable: t.closable,
    ...(t.widgetId != null ? { widget_id: t.widgetId } : {}),
  }));
  void api.workspaceSetTabs(tabs, dataTabs).catch(() => { return undefined; });
}
