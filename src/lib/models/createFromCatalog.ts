// ============ 目录创建服务 ============
//
// createFromCatalog — 前端唯一的业务节点创建入口 (palette 点击/拖放、
// 控制页种子、模板、AI 工具共用)。默认值与归一化全部由后端 prepare
// 产出; 成功后才写入本地编辑状态, 失败给出结构化提示且不产生半成品节点。
// 本地写入 (数据窗口派生/撤销历史/图同步) 委托 store 的 addCanvasNodes。

import { nanoid } from 'nanoid';
import type { Node } from '@xyflow/react';
import { useAppStore } from '../../store/appStore';
import { useModelCatalogStore } from '../../store/modelCatalogStore';
import { api } from '../tauri/tauri';
import { canvasNode } from '../nodes/document';
import type { NodeDocument } from '../nodes/document';
import type { ProtocolConfig, ProtocolSchema } from '../../types';
import { WIDGET_DEFAULT_WIDTH } from '../utils/widgetSize';

/** prepare 响应的单项结果 (wire 见 rpc-api::models::PrepareOutcome)。 */
export type PrepareOutcome =
  | { status: 'ok'; document: NodeDocument; issues: CatalogIssue[] }
  | { status: 'failed'; code: string; message: string };

export interface CatalogIssue {
  code: string;
  path?: string | null;
  message: string;
  severity: 'info' | 'warning' | 'error';
}

export interface CreateOptions {
  modelId: string;
  variantId?: string;
  /** 显式节点 id (模板等需要稳定 id 的调用方); 缺省由服务生成。 */
  nodeId?: string;
  /** 画布坐标 (tab 内)。 */
  position: { x: number; y: number };
  tabId?: string;
  /** 额外配置补丁 (调用方语义, 例如 Custom 编辑器的模板代码)。 */
  configPatch?: Record<string, unknown>;
  /** 显式覆盖节点显示名 (缺省由后端模型显示名决定)。 */
  label?: string;
  /** 画布视图数据装配 (例如设备条目的能力卡片) — 不进入文档, 只装饰节点。 */
  decorate?: (node: Node) => void;
}

export class CatalogError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

interface PreparedNode {
  node: Node;
  document: NodeDocument;
  issues: CatalogIssue[];
}

async function requestPrepare(
  specs: CreateOptions[],
  tabId: string,
): Promise<PrepareOutcome[]> {
  const catalog = useModelCatalogStore.getState();
  if (catalog.status !== 'ready') {
    throw new CatalogError('catalog/not-ready', '模型目录尚未就绪，无法创建节点');
  }
  const { results } = await api.prepareNodeDocuments({
    catalogRevision: catalog.revision,
    operations: specs.map((spec) => ({
      op: 'create',
      modelId: spec.modelId,
      variantId: spec.variantId ?? null,
      nodeId: spec.nodeId ?? `node-${nanoid(8)}`,
      tabId,
      layout: {
        x: spec.position.x,
        y: spec.position.y,
        width: WIDGET_DEFAULT_WIDTH,
        height: null,
      },
      label: spec.label ?? null,
      configPatch: spec.configPatch ?? {},
    })),
  }) as { results: PrepareOutcome[]; catalogRevision: string };
  for (const outcome of results) {
    if (outcome.status === 'failed') throw new CatalogError(outcome.code, outcome.message);
  }
  return results;
}

/** 只准备不插入 — 返回画布节点视图与 wire 文档 (种子/模板自行装配后写入)。 */
export async function prepareNodesFromCatalog(
  specs: CreateOptions[],
  tabId = specs[0]?.tabId ?? useAppStore.getState().activeControlTabId,
): Promise<PreparedNode[]> {
  if (!tabId) throw new CatalogError('tab/missing', '没有可用的控制页');
  const results = await requestPrepare(specs, tabId);
  return results.map((outcome, index) => {
    if (outcome.status === 'failed') throw new CatalogError(outcome.code, outcome.message);
    // wire document (JsonValue params) → 画布节点视图
    const document = outcome.document;
    const node = canvasNode(document);
    node.position = { x: specs[index]?.position.x ?? 0, y: specs[index]?.position.y ?? 0 };
    node.data = { ...node.data, tabId };
    specs[index]?.decorate?.(node);
    return { node, document, issues: outcome.issues };
  });
}

/** 单节点创建 — prepare 成功后写入 store 并同步图。 */
export async function createNodeFromCatalog(options: CreateOptions): Promise<Node> {
  const [prepared] = await prepareNodesFromCatalog([options]);
  useAppStore.getState().addCanvasNodes([prepared.node]);
  return prepared.node;
}

export interface CreatedEntry {
  node: Node;
  issues: CatalogIssue[];
}

/** 批量创建 — 模板/快速开始的共用路径; 一次提交一条撤销记录。 */
export async function batchCreateFromCatalog(
  specs: CreateOptions[],
): Promise<CreatedEntry[]> {
  const prepared = await prepareNodesFromCatalog(specs);
  if (prepared.length > 0) {
    useAppStore.getState().addCanvasNodes(prepared.map((entry) => entry.node));
  }
  return prepared;
}

/**
 * 协议预设文档准备 — 协议 kind/通道变化后的 schema 单一来源
 * (替代前端预设工厂): 后端按目录模型产出 {protocol, schema}。
 * 返回 document 的协议配置 (与请求 config 可能存在字段补全差异, 调用方以返回值为准)。
 */
export async function prepareProtocolDocument(
  config: ProtocolConfig,
  tabId?: string,
): Promise<{ protocol: ProtocolConfig; schema: ProtocolSchema }> {
  const catalog = useModelCatalogStore.getState();
  if (catalog.status !== 'ready') {
    throw new CatalogError('catalog/not-ready', '模型目录尚未就绪，无法创建节点');
  }
  const resolvedTab = tabId ?? useAppStore.getState().activeControlTabId;
  if (!resolvedTab) throw new CatalogError('tab/missing', '没有可用的控制页');
  const { results } = await api.prepareNodeDocuments({
    catalogRevision: catalog.revision,
    operations: [{
      op: 'create',
      modelId: `protocol:${config.kind}`,
      variantId: null,
      nodeId: `node-${nanoid(8)}`,
      tabId: resolvedTab,
      layout: { x: 0, y: 0, width: null, height: null },
      label: null,
      configPatch: { protocol: config },
    }],
  }) as { results: PrepareOutcome[]; catalogRevision: string };
  const outcome = results[0];
  if (!outcome || outcome.status === 'failed') {
    throw new CatalogError(outcome?.code ?? 'prepare/empty', outcome?.message ?? '协议模型准备失败');
  }
  const document = outcome.document as unknown as NodeDocument & { kind: 'protocol' };
  if (document.kind !== 'protocol') {
    throw new CatalogError('prepare/invalid', '协议模型准备结果不是协议文档');
  }
  return { protocol: document.config.protocol, schema: document.config.schema };
}
