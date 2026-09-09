import type { Node } from '@xyflow/react';
import { nanoid } from 'nanoid';
import type { DiscoveredEndpoint, EndpointSpec } from '../../types';
import { useAppStore } from '../../store/appStore';
import { withHistoryOp } from '../../store/historyStore';
import { api } from '../tauri/tauri';
import { defaultsFromSchema, mergeSchemaPatch } from './schemaForm';
import type { DeviceCardModel } from './deviceCardModel';

export interface AcquisitionNodeData extends Record<string, unknown> {
  tabId: string;
  label: string;
  spec: EndpointSpec;
  card?: DeviceCardModel;
  ports?: { id: string; direction: string; domain: string }[];
}

export function acquisitionNodeFromSpec(
  spec: EndpointSpec,
  position = { x: 60, y: 60 },
  card?: DeviceCardModel,
  tabId = useAppStore.getState().activeControlTabId,
): Node<AcquisitionNodeData> {
  return { id: spec.id, type: 'acquisition', position, width: 200, data: { tabId, label: spec.label, spec, card, ports: card?.endpoint.ports.map(p => ({ id: p.id, direction: p.direction, domain: p.dataDomain })) } };
}

export function createAcquisitionNode(card: DeviceCardModel, position?: { x: number; y: number }, tabId?: string, discovered?: DiscoveredEndpoint): Node<AcquisitionNodeData> {
  return acquisitionNodeFromSpec({
    id: `acquisition-${nanoid(8)}`,
    label: discovered?.displayName ?? (card.adapter.endpoints.length === 1 ? card.adapter.displayName : card.endpoint.displayName),
    enabled: true,
    capabilityEndpointId: card.endpoint.id,
    driver: {
      driverId: card.adapter.adapterId,
      schemaVersion: card.endpoint.configuration.schemaVersion,
      payload: mergeSchemaPatch(defaultsFromSchema(card.endpoint.configuration.jsonSchema), discovered?.configurationPatch ?? {}) as Record<string, unknown>,
    },
  }, position, card, tabId);
}

export function addAcquisitionNode(card: DeviceCardModel, position?: { x: number; y: number }, tabId?: string, discovered?: DiscoveredEndpoint): void {
  withHistoryOp({ opKey: 'opAddTransportNode', detailText: card.adapter.displayName, target: { kind: 'node', node: { kind: 'transport' } } }, () => {
    const node = createAcquisitionNode(card, position, tabId, discovered);
    useAppStore.setState((s) => ({ rfNodes: [...s.rfNodes, node] }));
    useAppStore.getState().syncAllTabGraphs();
  });
}

export function updateAcquisitionNode(nodeId: string, spec: EndpointSpec): void {
  const current = useAppStore.getState().rfNodes.find(node => node.id === nodeId && node.type === 'acquisition')
    ?.data.spec as EndpointSpec | undefined;
  const structure = (value: EndpointSpec | undefined) => value ? JSON.stringify({
    enabled: value.enabled,
    capabilityEndpointId: value.capabilityEndpointId,
    driver: value.driver,
    simulation: value.simulation ? {
      encoding: value.simulation.encoding,
      channels: value.simulation.channels,
      referenceNodeId: value.simulation.referenceNodeId,
    } : null,
  }) : '';
  const mustClose = structure(current) !== structure(spec);
  if (mustClose) {
    void api.closeAcquisitionEndpoint(nodeId).catch(() => undefined);
    useAppStore.setState(state => ({
      connectionStates: { ...state.connectionStates, [nodeId]: 'Disconnected' },
    }));
  }
  withHistoryOp({ opKey: 'opUpdateTransportConfig', detailText: spec.label, target: { kind: 'node', node: { kind: 'transport' } } }, () => {
    useAppStore.setState((s) => ({
      rfNodes: s.rfNodes.map((node) => node.id === nodeId && node.type === 'acquisition'
        ? { ...node, data: { ...node.data, spec: { ...spec, id: nodeId }, label: spec.label } }
        : node),
    }));
    useAppStore.getState().syncAllTabGraphs();
  }, { coalesceKey: `acquisition.config.${nodeId}` });
}
