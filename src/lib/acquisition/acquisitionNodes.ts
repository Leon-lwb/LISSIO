import type { Node } from '@xyflow/react';
import { nanoid } from 'nanoid';
import type { DeviceTreeNodeDecl, DiscoveredEndpoint, SimulationConfig } from '../../types';
import { useAppStore } from '../../store/appStore';
import { withHistoryOp } from '../../store/historyStore';
import { api } from '../tauri/tauri';
import { defaultsFromSchema, mergeSchemaPatch } from './schemaForm';
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
  return child ? child.config as unknown as SimulationConfig : null;
}

export function withSimulation(node: DeviceTreeNodeDecl, simulation: SimulationConfig | null): DeviceTreeNodeDecl {
  const existing = node.children.find(item => item.driver === SIMULATION_DRIVER_ID);
  if (!simulation) return { ...node, children: node.children.filter(item => item.driver !== SIMULATION_DRIVER_ID) };
  if (existing) return { ...node, children: node.children.map(item => item.id === existing.id
    ? { ...item, config: simulation as unknown as Record<string, unknown> } : item) };
  return { ...node, children: [...node.children, {
      id: `${node.id}::simulation`,
      name: uniqueDeviceTreeName(node, 'simulation'),
      driver: SIMULATION_DRIVER_ID,
      schemaVersion: 1,
      config: simulation as unknown as Record<string, unknown>,
      enabled: true,
      children: [],
    }] };
}

export function acquisitionNodeFromDecl(
  node: DeviceTreeNodeDecl,
  position = { x: 60, y: 60 },
  card?: DeviceCardModel,
  tabId = useAppStore.getState().activeControlTabId,
): Node<AcquisitionNodeData> {
  return {
    id: node.id,
    type: 'acquisition',
    position,
    width: 200,
    data: {
      tabId,
      label: node.name,
      node,
      card,
      ports: card?.endpoint.ports.map((port) => ({ id: port.id, direction: port.direction, domain: port.dataDomain })),
    },
  };
}

export function createAcquisitionNode(card: DeviceCardModel, position?: { x: number; y: number }, tabId?: string, discovered?: DiscoveredEndpoint): Node<AcquisitionNodeData> {
  const id = `acquisition-${nanoid(8)}`;
  return acquisitionNodeFromDecl({
    id,
    name: discovered?.displayName ?? (card.adapter.endpoints.length === 1 ? card.adapter.displayName : card.endpoint.displayName),
    driver: card.adapter.adapterId,
    schemaVersion: card.endpoint.configuration.schemaVersion,
    config: mergeSchemaPatch(defaultsFromSchema(card.endpoint.configuration.jsonSchema), discovered?.configurationPatch ?? {}) as Record<string, unknown>,
    enabled: true,
    capabilityEndpointId: card.endpoint.id,
    children: [],
  }, position, card, tabId);
}

export function addAcquisitionNode(card: DeviceCardModel, position?: { x: number; y: number }, tabId?: string, discovered?: DiscoveredEndpoint): void {
  withHistoryOp({ opKey: 'opAddTransportNode', detailText: card.adapter.displayName, target: { kind: 'node', node: { kind: 'transport' } } }, () => {
    const node = createAcquisitionNode(card, position, tabId, discovered);
    useAppStore.setState((s) => ({ rfNodes: [...s.rfNodes, node] }));
    useAppStore.getState().syncAllTabGraphs();
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
      encoding: value.config.encoding,
      channels: value.config.channels,
      referenceNodeId: value.config.referenceNodeId,
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
