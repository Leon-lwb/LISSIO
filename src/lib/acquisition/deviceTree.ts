import { nanoid } from 'nanoid';
import type { DeviceTreeNodeDecl, ProtocolConfig } from '../../types';
import { useAppStore } from '../../store/appStore';
import { schemaFromProtocolConfig } from '../utils/protocolSchema';
import { updateAcquisitionNode, SIMULATION_DRIVER_ID, type AcquisitionNodeData } from './acquisitionNodes';
import { defaultSimulation } from './simulation';
import { findDeviceTreeNode, removeDeviceTreeNode, updateDeviceTreeNode, uniqueDeviceTreeName,
  validateDeviceTreeName, walkDeviceTree, PROTOCOL_ENGINE_DRIVER_ID } from './deviceTreeModel';

export * from './deviceTreeModel';

export function createProtocolEngineNode(
  parent: DeviceTreeNodeDecl,
  protocol: ProtocolConfig = { kind: 'JustFloat', channels: null },
): DeviceTreeNodeDecl {
  return { id: `protocol-${nanoid(8)}`, name: uniqueDeviceTreeName(parent, protocol.kind),
    driver: PROTOCOL_ENGINE_DRIVER_ID, schemaVersion: 1, enabled: true,
    config: { protocol, convertTo: null, schema: schemaFromProtocolConfig(protocol) }, children: [] };
}

export function createSimulationNode(parent: DeviceTreeNodeDecl): DeviceTreeNodeDecl {
  return { id: `${parent.id}::simulation`, name: uniqueDeviceTreeName(parent, 'simulation'),
    driver: SIMULATION_DRIVER_ID, schemaVersion: 1, enabled: true,
    config: defaultSimulation() as unknown as Record<string, unknown>, children: [] };
}

function getRoot(rootId: string): DeviceTreeNodeDecl | undefined {
  const canvas = useAppStore.getState().rfNodes.find(node => node.id === rootId && node.type === 'acquisition');
  return (canvas?.data as AcquisitionNodeData | undefined)?.node;
}

function validTree(root: DeviceTreeNodeDecl, rootId: string): boolean {
  const nodes = walkDeviceTree(root);
  const otherIds = new Set(useAppStore.getState().rfNodes.filter(node => node.id !== rootId).flatMap(node => node.type === 'acquisition'
    ? walkDeviceTree((node.data as AcquisitionNodeData).node).map(child => child.id) : [node.id]));
  return new Set(nodes.map(node => node.id)).size === nodes.length && nodes.every(node =>
    node.id.trim() && !otherIds.has(node.id) && !validateDeviceTreeName(root, node.id, node.name)
    && node.children.filter(child => child.driver === SIMULATION_DRIVER_ID).length <= 1);
}

export function addDeviceTreeChild(rootId: string, parentId: string, child: DeviceTreeNodeDecl): boolean {
  const root = getRoot(rootId);
  const parent = root && findDeviceTreeNode(root, parentId);
  if (!root || !parent || parent.children.some(node => node.name === child.name)) return false;
  const updated = updateDeviceTreeNode(root, parentId, node => ({ ...node, children: [...node.children, child] }));
  if (!validTree(updated, rootId)) return false;
  updateAcquisitionNode(rootId, updated);
  return true;
}

export function updateDeviceTreeChild(rootId: string, nodeId: string, patch: Partial<DeviceTreeNodeDecl>): boolean {
  const root = getRoot(rootId);
  if (!root || !findDeviceTreeNode(root, nodeId)) return false;
  if (patch.name !== undefined && validateDeviceTreeName(root, nodeId, patch.name)) return false;
  const updated = updateDeviceTreeNode(root, nodeId, node => ({ ...node, ...patch, id: node.id }));
  if (!validTree(updated, rootId)) return false;
  updateAcquisitionNode(rootId, updated);
  return true;
}

export function removeDeviceTreeChild(rootId: string, nodeId: string): boolean {
  const root = getRoot(rootId);
  if (!root || root.id === nodeId) return false;
  const updated = removeDeviceTreeNode(root, nodeId);
  if (!updated || updated === root) return false;
  updateAcquisitionNode(rootId, updated);
  return true;
}
