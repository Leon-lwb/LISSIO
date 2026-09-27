//! AI 前端托管工具宿主 — 内置 AI 节点编辑 / UI 操作的前端执行端。
//!
//! 后端 `NativeToolExecutor` 对前端托管工具发出 `ai_tool_invoke` 事件,本模块
//! 分发到对应 handler (全部走 `useAppStore` 现有 action:画布实时刷新、撤销
//! 历史可用、tab 图自动同步后端),执行后 `ai_tool_resolve` 回执;未回执时
//! 后端 15s 超时报错兜底。
//!
//! 连线拓扑 (connect_edge / disconnect_edge) 已下沉后端权威
//! (`cmd_graph::source_graph`),由内置 AI 后端直连执行,不走本模块 —
//! 编译失败 (端口域不匹配/成环) 直接报错且不建边,画布经 `graph:source`
//! 事件收敛 (见 appStoreHelpers.adoptSourceGraph)。

import { transport } from '../rpc';
import { useAppStore } from '../../store/appStore';
import { useModelCatalogStore } from '../../store/modelCatalogStore';
import type { Node } from '@xyflow/react';
import {
  isStructuralNode,
  type ProtocolNodeData,
} from '../../store/appStoreHelpers';
import { addAcquisitionNode, updateAcquisitionNode, type AcquisitionNodeData } from '../acquisition/acquisitionNodes';
import { loadAdapterCapabilities } from '../acquisition/capabilityCatalog';
import { buildDeviceCards } from '../acquisition/deviceCardModel';
import { nodeDocument } from '../nodes/document';
import { createNodeFromCatalog } from '../models/createFromCatalog';
import { QUICK_START_TEMPLATES, getTemplate } from '../quickstart/templates';
import { applyTemplate, type TemplateApplyMode } from '../quickstart/applyTemplate';
import { t } from '../../i18n';
import type { ProtocolConfig, WidgetConfig } from '../../types';

/// 后端调用载荷 (`cmd_ai::native_executor` 同构)。
interface AiToolInvoke {
  call_id: string;
  name: string;
  arguments: Record<string, unknown>;
}

/** 工具 handler — 返回值作为工具结果回传 (JSON 序列化);抛错即工具失败。 */
type ToolHandler = (args: Record<string, unknown>) => unknown;

// ============ 参数辅助 ============

function str(args: Record<string, unknown>, key: string): string {
  const v = args[key];
  if (typeof v !== 'string' || v === '') throw new Error(`缺少字符串参数 ${key}`);
  return v;
}

function optStr(args: Record<string, unknown>, key: string): string | undefined {
  const v = args[key];
  return typeof v === 'string' && v !== '' ? v : undefined;
}

function obj(args: Record<string, unknown>, key: string): Record<string, unknown> {
  const v = args[key];
  return v !== null && typeof v === 'object' && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : {};
}

function positionOf(args: Record<string, unknown>): { x: number; y: number } | undefined {
  const p = args.position;
  if (p === null || typeof p !== 'object') return undefined;
  const { x, y } = p as Record<string, unknown>;
  if (typeof x !== 'number' || typeof y !== 'number') return undefined;
  return { x, y };
}

/** 深合并 patch 到 base (对象递归合并, 数组/标量整体替换)。 */
function deepMerge<T>(base: T, patch: unknown): T {
  if (
    patch === null || typeof patch !== 'object' || Array.isArray(patch) ||
    base === null || typeof base !== 'object' || Array.isArray(base)
  ) {
    return patch as T;
  }
  const out: Record<string, unknown> = { ...(base as Record<string, unknown>) };
  for (const [k, v] of Object.entries(patch as Record<string, unknown>)) {
    out[k] = k in out ? deepMerge(out[k], v) : v;
  }
  return out as T;
}

/** 按 id 找节点, 不存在抛错。 */
function nodeOrThrow(nodeId: string): Node {
  const node = useAppStore.getState().rfNodes.find((n) => n.id === nodeId);
  if (!node) throw new Error(`节点不存在: ${nodeId} (先 get_workspace 查询有效 id)`);
  return node;
}

/** 目录中可创建的模型清单 — kind 白名单的唯一权威是模型目录。 */
function catalogModelOrThrow(modelId: string): void {
  const catalog = useModelCatalogStore.getState();
  if (catalog.status !== 'ready') {
    throw new Error('模型目录尚未就绪 (稍后重试)');
  }
  const model = catalog.byId[modelId];
  if (!model || !(model.actions ?? []).includes('createNode')) {
    const creatable = catalog.models
      .filter((m) => (m.actions ?? []).includes('createNode') && m.id.startsWith(modelId.split(':')[0]))
      .map((m) => m.id.split(':')[1] ?? m.id);
    throw new Error(`未知模型 ${modelId} (可选: ${creatable.join('/') || '无'})`);
  }
}

// ============ Handlers ============

/** 读取画布全量状态 — AI 了解当前工作区的唯一权威来源。 */
function getWorkspace(): unknown {
  const s = useAppStore.getState();
  return {
    active_tab_id: s.activeControlTabId,
    tabs: s.controlTabs.map((tab) => ({
      id: tab.id,
      name: tab.name,
      documents: s.rfNodes.filter(node => node.data.tabId === tab.id).map(nodeDocument),
      edges: s.rfEdges.filter(edge => {
        const source = s.rfNodes.find(node => node.id === edge.source);
        const target = s.rfNodes.find(node => node.id === edge.target);
        return source?.data.tabId === tab.id && target?.data.tabId === tab.id;
      }).map(edge => ({
        id: edge.id,
        source: edge.source,
        source_handle: edge.sourceHandle,
        target: edge.target,
        target_handle: edge.targetHandle,
      })),
    })),
    derived_ports: s.derivedPorts,
  };
}

/** 添加节点 (transport / protocol / widget) — 全部走目录创建服务。 */
async function addNode(args: Record<string, unknown>): Promise<unknown> {
  const type = str(args, 'type');
  const kind = str(args, 'kind');
  const position = positionOf(args) ?? { x: 300, y: 60 };
  const tabId = optStr(args, 'tab_id') ?? useAppStore.getState().activeControlTabId;
  if (!useAppStore.getState().controlTabs.some(tab => tab.id === tabId)) {
    throw new Error(`tab 不存在: ${tabId}`);
  }
  const patch = obj(args, 'config');

  if (type === 'device') {
    const cards = buildDeviceCards(await loadAdapterCapabilities());
    const endpointId = optStr(args, 'endpoint_id');
    const card = cards.find(candidate => candidate.adapter.adapterId === kind &&
      (!endpointId || candidate.endpoint.id === endpointId));
    if (!card) throw new Error(`设备能力不存在: ${kind}`);
    const created = await addAcquisitionNode(card, position, tabId);
    if (Object.keys(patch).length > 0) {
      const { node } = created.data as AcquisitionNodeData;
      updateAcquisitionNode(created.id, { ...node, config: deepMerge(node.config, patch) });
    }
    return { node_id: created.id };
  }

  if (type === 'protocol') {
    catalogModelOrThrow(`protocol:${kind}`);
    const config = patch.kind === undefined
      ? ({ kind, ...patch } as unknown as ProtocolConfig)
      : (patch as unknown as ProtocolConfig);
    const created = await createNodeFromCatalog({
      modelId: `protocol:${kind}`,
      position,
      tabId,
      configPatch: { protocol: config },
    });
    return { node_id: created.id };
  }

  if (type === 'point-selector') {
    const created = await createNodeFromCatalog({
      modelId: 'pointSelector',
      position,
      tabId,
      label: '点位选择',
    });
    return { node_id: created.id };
  }

  if (type === 'widget') {
    catalogModelOrThrow(`widget:${kind}`);
    const created = await createNodeFromCatalog({
      modelId: `widget:${kind}`,
      position,
      tabId,
      configPatch: Object.keys(patch).length > 0 ? patch : undefined,
    });
    return { node_id: created.id };
  }

  throw new Error(`未知节点类别 ${type} (可选: device/protocol/point-selector/widget)`);
}

/** 更新节点配置 (widget 深合并 params; transport/protocol 更新 config)。 */
async function updateNodeConfig(args: Record<string, unknown>): Promise<unknown> {
  const nodeId = str(args, 'node_id');
  const patch = obj(args, 'config');
  if (Object.keys(patch).length === 0) throw new Error('缺少 config');
  const target = nodeOrThrow(nodeId);

  if (target.type === 'widget') {
    const widget = target.data.widget as WidgetConfig;
    const next = { ...widget, params: deepMerge(widget.params, patch) } as WidgetConfig;
    useAppStore.getState().updateWidget(nodeId, next);
    return { ok: true };
  }
  if (target.type === 'acquisition') {
    const { node } = target.data as AcquisitionNodeData;
    updateAcquisitionNode(nodeId, { ...node, config: deepMerge(node.config, patch) });
    return { ok: true };
  }
  if (target.type === 'protocol') {
    const data = target.data as unknown as ProtocolNodeData;
    const cur = data.config;
    const nextKind = typeof patch.kind === 'string' ? patch.kind : cur.kind;
    const merged = { ...(cur as Record<string, unknown>), ...patch };
    const config = nextKind !== cur.kind
      ? (merged as unknown as ProtocolConfig)
      : ({ kind: cur.kind, ...merged } as unknown as ProtocolConfig);
    await useAppStore.getState().setProtocolNodeConfig(nodeId, config);
    if ('convertTo' in patch || 'convert_to' in patch) {
      const cv = (patch.convertTo ?? patch.convert_to) as Record<string, unknown> | null;
      const cvConfig = cv
        ? ({ kind: str(cv, 'kind'), ...cv } as unknown as ProtocolConfig)
        : null;
      useAppStore.getState().setProtocolNodeConvertTo(nodeId, cvConfig);
    }
    return { ok: true };
  }
  throw new Error(`节点 ${nodeId} 类型不支持配置更新`);
}

/** 删除任意画布节点。 */
function removeNode(args: Record<string, unknown>): unknown {
  const nodeId = str(args, 'node_id');
  const node = nodeOrThrow(nodeId);
  if (!isStructuralNode(node) && node.type !== 'widget') {
    throw new Error(`节点 ${nodeId} 类型不支持删除`);
  }
  useAppStore.getState().removeNode(nodeId);
  return { ok: true };
}

/** 连线 / 删线说明 — 拓扑工具已下沉后端权威 (cmd_graph::source_graph):
 *  connect_edge / disconnect_edge 由内置 AI 后端直连执行, 编译失败
 *  (端口域不匹配/成环) 直接报错且不建边; 画布经 graph:source 事件收敛。
 *  此处不再注册前端 handler。 */

/** 移动节点。 */
function moveNode(args: Record<string, unknown>): unknown {
  const nodeId = str(args, 'node_id');
  const px = args.x;
  const py = args.y;
  if (typeof px !== 'number' || typeof py !== 'number') throw new Error('缺少 x/y 数值');
  nodeOrThrow(nodeId);
  useAppStore.getState().onNodesChange([
    { id: nodeId, type: 'position', position: { x: px, y: py }, dragging: false },
  ]);
  return { ok: true };
}

/** 新建控制页 (action 会把新页设为活跃)。 */
function createTab(args: Record<string, unknown>): unknown {
  const name = optStr(args, 'name');
  useAppStore.getState().addControlTab(name);
  return { tab_id: useAppStore.getState().activeControlTabId };
}

/** 连接 / 断开传输。 */
async function connectDevice(args: Record<string, unknown>): Promise<unknown> {
  const nodeId = str(args, 'node_id');
  nodeOrThrow(nodeId);
  await useAppStore.getState().connectNode(nodeId);
  return { node_id: nodeId, state: useAppStore.getState().connectionStates[nodeId] ?? 'Disconnected' };
}

async function disconnectDevice(args: Record<string, unknown>): Promise<unknown> {
  const nodeId = str(args, 'node_id');
  nodeOrThrow(nodeId);
  await useAppStore.getState().disconnectNode(nodeId);
  return { ok: true };
}

/** 模板清单 (含本地化名称)。 */
function listTemplates(): unknown {
  const lang = useAppStore.getState().lang;
  return {
    templates: QUICK_START_TEMPLATES.map((tpl) => ({
      id: tpl.id,
      name: t(lang, tpl.nameKey as never),
      description: t(lang, tpl.descKey as never),
    })),
  };
}

/** 应用模板 — AI 默认 merge (追加新页, 不破坏用户现有工作区)。 */
async function applyTemplateTool(args: Record<string, unknown>): Promise<unknown> {
  const templateId = str(args, 'template_id');
  const tpl = getTemplate(templateId);
  if (!tpl) {
    throw new Error(`模板不存在: ${templateId} (先 list_templates 查询)`);
  }
  const mode: TemplateApplyMode = args.mode === 'replace' ? 'replace' : 'merge';
  await applyTemplate(await tpl.build(), mode);
  return { ok: true, mode };
}

// ============ 注册与分发 ============

const HANDLERS: Record<string, ToolHandler> = {
  get_workspace: () => getWorkspace(),
  add_node: (args) => addNode(args),
  update_node_config: (args) => updateNodeConfig(args),
  remove_node: (args) => removeNode(args),
  move_node: (args) => moveNode(args),
  create_tab: (args) => createTab(args),
  set_active_tab: (args) => {
    const tabId = str(args, 'tab_id');
    if (!useAppStore.getState().controlTabs.some((tab) => tab.id === tabId)) {
      throw new Error(`tab 不存在: ${tabId}`);
    }
    useAppStore.getState().setActiveControlTab(tabId);
    return { ok: true };
  },
  connect_device: (args) => connectDevice(args),
  disconnect_device: (args) => disconnectDevice(args),
  list_templates: () => listTemplates(),
  apply_template: (args) => applyTemplateTool(args),
};

let started = false;

/** 初始化工具宿主 — App 挂载时调用一次 (重复调用幂等)。 */
export function initAiToolHost(): void {
  if (started) return;
  started = true;
  void transport.listen<AiToolInvoke>('ai_tool_invoke', ({ call_id, name, arguments: args }) => {
    void (async () => {
      const handler = HANDLERS[name];
      try {
        if (!handler) throw new Error(`前端未实现工具: ${name}`);
        const result = await handler(args ?? {});
        await transport.call('ai_tool_resolve', {
          callId: call_id,
          ok: true,
          result: result ?? { ok: true },
        });
      } catch (e) {
        await transport.call('ai_tool_resolve', {
          callId: call_id,
          ok: false,
          result: e instanceof Error ? e.message : String(e),
        });
      }
    })();
  });
}
