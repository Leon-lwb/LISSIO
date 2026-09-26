import type { Node } from '@xyflow/react';
import type { DeviceTreeNodeDecl, DiscoveredEndpoint, SimulationConfig } from '../../types';
import { useAppStore } from '../../store/appStore';
import { withHistoryOp } from '../../store/historyStore';
import { api } from '../tauri/tauri';
import { createNodeFromCatalog, prepareNodesFromCatalog } from '../models/createFromCatalog';
import type { DeviceCardModel } from './deviceCardModel';
import { uniqueDeviceTreeName, walkDeviceTree } from './deviceTreeModel';

export const SIMULATION_DRIVER_ID = 'simulation';

export interface AcquisitionNodeData extends Record<string, unknown> {
  tabId: string;
  label: string;
  node: DeviceTreeNodeDecl;
  card?: DeviceCardModel;
  ports?: { id: string; direction: string; domain: string }[];
}

export function simulationConfig(node: DeviceTreeNodeDecl): SimulationConfig | null {
  const child = node.children.find((item) => item.enabled && item.driver === SIMULATION_DRIVER_ID);
  return child ? child.config as SimulationConfig : null;
}

export function withSimulation(node: DeviceTreeNodeDecl, simulation: SimulationConfig | null): DeviceTreeNodeDecl {
  const existing = node.children.find(item => item.driver === SIMULATION_DRIVER_ID);
  if (!simulation) return { ...node, children: node.children.filter(item => item.driver !== SIMULATION_DRIVER_ID) };
  if (existing) return { ...node, children: node.children.map(item => item.id === existing.id
    ? { ...item, config: simulation } : item) };
  return { ...node, children: [...node.children, {
      id: `${node.id}::simulation`,
      name: uniqueDeviceTreeName(node, 'simulation'),
      driver: SIMULATION_DRIVER_ID,
      schemaVersion: 1,
      config: simulation,
      enabled: true,
      children: [],
    }] };
}

/// 设备画布视图的能力数据装配 — 与工作区水合同一来源 (能力端点投影),
/// 不进入 NodeDocument (端口是运行时投影, 不是静态文档字段)。
export function decorateAcquisitionNode(node: Node, card: DeviceCardModel): void {
  const data = node.data as AcquisitionNodeData;
  data.card = card;
  data.ports = card.endpoint.ports.map((port) => ({ id: port.id, direction: port.direction, domain: port.dataDomain }));
}

/** 只准备不插入 — 种子/模板装配设备树用 (子节点随根文档一次写入)。 */
export async function prepareAcquisitionNode(
  card: DeviceCardModel,
  position: { x: number; y: number } = { x: 60, y: 60 },
  tabId?: string,
  discovered?: DiscoveredEndpoint,
): Promise<Node> {
  const [prepared] = await prepareNodesFromCatalog([{
    modelId: `driver:${card.adapter.adapterId}`,
    position,
    tabId,
    label: discovered?.displayName ?? (card.adapter.endpoints.length === 1 ? card.adapter.displayName : card.endpoint.displayName),
    configPatch: {
      capabilityEndpointId: card.endpoint.id,
      ...(discovered?.configurationPatch ? { config: discovered.configurationPatch } : {}),
    },
    decorate: (node) => decorateAcquisitionNode(node, card),
  }]);
  return prepared.node;
}

/**
 * 设备条目创建 — 目录 `driver:*` (后端 default_config 为配置默认值的单一来源)
 * + 能力端点绑定 (capabilityEndpointId 经 configPatch 传入 prepare)。
 */
export async function addAcquisitionNode(
  card: DeviceCardModel,
  position?: { x: number; y: number },
  tabId?: string,
  discovered?: DiscoveredEndpoint,
): Promise<Node> {
  return createNodeFromCatalog({
    modelId: `driver:${card.adapter.adapterId}`,
    position: position ?? { x: 60, y: 60 },
    tabId,
    label: discovered?.displayName ?? (card.adapter.endpoints.length === 1 ? card.adapter.displayName : card.endpoint.displayName),
    configPatch: {
      capabilityEndpointId: card.endpoint.id,
      ...(discovered?.configurationPatch ? { config: discovered.configurationPatch } : {}),
    },
    decorate: (node) => decorateAcquisitionNode(node, card),
  });
}

export function updateAcquisitionNode(nodeId: string, node: DeviceTreeNodeDecl): void {
  const current = useAppStore.getState().rfNodes.find((item) => item.id === nodeId && item.type === 'acquisition')
    ?.data.node as DeviceTreeNodeDecl | undefined;
  if (!current) return;
  const structure = (value: DeviceTreeNodeDecl): unknown => ({
    id: value.id,
    name: value.name,
    enabled: value.enabled,
    capabilityEndpointId: value.capabilityEndpointId,
    driver: value.driver,
    schemaVersion: value.schemaVersion,
    // Signal parameters may be updated live; source format changes require reopening.
    config: value.driver === SIMULATION_DRIVER_ID ? {
      encoding: (value.config as Partial<SimulationConfig>).encoding,
      channels: (value.config as Partial<SimulationConfig>).channels,
      referenceNodeId: (value.config as Partial<SimulationConfig>).referenceNodeId,
    } : value.config,
    children: value.children.map(structure),
  });
  const stableJson = (value: unknown): string => JSON.stringify(value, (_key, item: unknown) => {
    if (item && typeof item === 'object' && !Array.isArray(item)) {
      return Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b)));
    }
    return item;
  });
  const next = { ...node, id: nodeId };
  if (stableJson(current) === stableJson(next)) return;
  const mustClose = stableJson(structure(current)) !== stableJson(structure(next));
  const remainingIds = new Set(walkDeviceTree(next).map(child => child.id));
  const removedIds = new Set(walkDeviceTree(current).map(child => child.id).filter(id => !remainingIds.has(id)));
  const childIdsChanged = walkDeviceTree(current).map(child => child.id).join('\0') !== walkDeviceTree(next).map(child => child.id).join('\0');
  if (mustClose) {
    void api.closeAcquisitionNode(nodeId).catch(() => undefined);
    useAppStore.setState((state) => ({
      connectionStates: { ...state.connectionStates, [nodeId]: 'Disconnected' },
    }));
  }
  withHistoryOp({ opKey: 'opUpdateTransportConfig', detailText: node.name, target: { kind: 'node', node: { kind: 'transport' } } }, () => {
    useAppStore.setState((s) => ({
      rfNodes: s.rfNodes.map((item) => item.id === nodeId && item.type === 'acquisition'
        ? { ...item, data: { ...item.data, node: next, label: node.name } }
        : item),
      rfEdges: removedIds.size ? s.rfEdges.filter(edge => !removedIds.has(edge.source) && !removedIds.has(edge.target)) : s.rfEdges,
    }));
    if (removedIds.size) useAppStore.getState().removeDerived([...removedIds]);
    useAppStore.getState().syncAllTabGraphs();
  }, childIdsChanged ? undefined : { coalesceKey: `acquisition.config.${nodeId}` });
}
