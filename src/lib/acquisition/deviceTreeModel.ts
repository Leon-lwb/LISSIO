import type { Edge, Node } from '@xyflow/react';
import type { DeviceTreeNodeDecl, ProtocolConfig, ProtocolSchema, WidgetConfig } from '../../types';
import type { AcquisitionNodeData } from './acquisitionNodes';
import { schemaPortNames } from '../utils/protocolSchema';

export const PROTOCOL_ENGINE_DRIVER_ID = 'protocol-engine';

export interface DeviceTreeItem {
  id: string;
  name: string;
  driver: string;
  enabled: boolean;
  node?: DeviceTreeNodeDecl;
  canvasNodeId: string;
  rootId: string;
  parentId?: string;
  source: 'declaration' | 'canvas';
  children: DeviceTreeItem[];
}

export function walkDeviceTree(root: DeviceTreeNodeDecl): DeviceTreeNodeDecl[] {
  return [root, ...root.children.flatMap(walkDeviceTree)];
}

export function findDeviceTreeNode(root: DeviceTreeNodeDecl, id: string): DeviceTreeNodeDecl | undefined {
  if (root.id === id) return root;
  for (const child of root.children) {
    const found = findDeviceTreeNode(child, id);
    if (found) return found;
  }
  return undefined;
}

export function updateDeviceTreeNode(
  root: DeviceTreeNodeDecl,
  id: string,
  update: (node: DeviceTreeNodeDecl) => DeviceTreeNodeDecl,
): DeviceTreeNodeDecl {
  if (root.id === id) return update(root);
  const children = root.children.map(child => updateDeviceTreeNode(child, id, update));
  return children.every((child, index) => child === root.children[index]) ? root : { ...root, children };
}

/** Removing the root returns null; removing an absent node preserves identity. */
export function removeDeviceTreeNode(root: DeviceTreeNodeDecl, id: string): DeviceTreeNodeDecl | null {
  if (root.id === id) return null;
  const children = root.children.flatMap(child => {
    const remaining = removeDeviceTreeNode(child, id);
    return remaining ? [remaining] : [];
  });
  return children.length === root.children.length && children.every((child, index) => child === root.children[index])
    ? root : { ...root, children };
}

export function validateDeviceTreeName(root: DeviceTreeNodeDecl, id: string, name: string): string | null {
  if (!name.trim() || name.includes('/')) return '节点名称不能为空或包含 /。';
  const parent = walkDeviceTree(root).find(node => node.children.some(child => child.id === id));
  if (parent?.children.some(child => child.id !== id && child.name === name)) return '同一父节点下的名称必须唯一。';
  return null;
}

export function uniqueDeviceTreeName(parent: DeviceTreeNodeDecl, base: string): string {
  const names = new Set(parent.children.map(child => child.name));
  if (!names.has(base)) return base;
  let suffix = 2;
  while (names.has(`${base} ${suffix}`)) suffix += 1;
  return `${base} ${suffix}`;
}

/** Canvas protocol cards are projections only; declarations remain in the root document. */
export function deviceTreeCanvasNodes(nodes: Node[]): Node[] {
  const result: Node[] = [];
  for (const root of nodes.filter(node => node.type === 'acquisition')) {
    const declaration = (root.data as AcquisitionNodeData).node;
    let row = 0;
    const visit = (parent: DeviceTreeNodeDecl, depth: number, ancestorsEnabled: boolean) => {
      for (const child of parent.children) {
        const enabled = ancestorsEnabled && child.enabled;
        if (child.driver === PROTOCOL_ENGINE_DRIVER_ID) {
          const childConfig = child.config as Record<string, unknown>;
          const config = (childConfig.protocol ?? { kind: 'JustFloat', channels: null }) as ProtocolConfig;
          const schema = childConfig.schema as ProtocolSchema;
          result.push({
            id: child.id,
            type: 'protocol',
            position: { x: root.position.x + depth * 240, y: root.position.y + row++ * 120 },
            width: 200,
            draggable: false,
            selectable: false,
            deletable: false,
            connectable: enabled,
            data: { tabId: root.data.tabId, label: child.name, treeRootId: root.id, treeParentId: parent.id,
              enabled, config, convertTo: (childConfig.convertTo) ?? null,
              schema, channels: schema?.preset != null ? schemaPortNames(schema.decode).length : ((config as { channels?: number | null }).channels ?? 0) },
          });
        }
        visit(child, depth + 1, enabled);
      }
    };
    visit(declaration, 1, declaration.enabled);
  }
  return result;
}

export function deviceTreeCanvasEdges(nodes: Node[]): Edge[] {
  const result: Edge[] = [];
  for (const root of nodes.filter(node => node.type === 'acquisition')) {
    const declaration = (root.data as AcquisitionNodeData).node;
    const rootBytesPort = (root.data as AcquisitionNodeData).ports?.find(port =>
      port.domain === 'bytes' && port.direction !== 'input')?.id ?? 'rx';
    const visit = (parent: DeviceTreeNodeDecl, ancestorsEnabled: boolean) => {
      for (const child of parent.children) {
        const enabled = ancestorsEnabled && child.enabled;
        if (enabled && child.driver === PROTOCOL_ENGINE_DRIVER_ID
          && (parent.id === declaration.id || parent.driver === PROTOCOL_ENGINE_DRIVER_ID || parent.driver === 'simulation')) {
          const sourceId = parent.driver === 'simulation' ? declaration.id : parent.id;
          result.push({ id: `device-tree:${sourceId}:${child.id}`, source: sourceId,
            sourceHandle: parent.driver === PROTOCOL_ENGINE_DRIVER_ID ? 'out' : rootBytesPort,
            target: child.id, targetHandle: 'in', deletable: false, selectable: false,
            data: { treeRootId: root.id } });
        }
        visit(child, enabled);
      }
    };
    visit(declaration, declaration.enabled);
  }
  return result;
}

function canvasDriver(node: Node): string | null {
  if (node.type === 'protocol') return PROTOCOL_ENGINE_DRIVER_ID;
  if (node.type === 'point-selector') return 'point-selector';
  if ((node.data.widget as WidgetConfig | undefined)?.kind === 'FrameDecoder') return 'frame-decoder';
  return null;
}

function declarationItem(node: DeviceTreeNodeDecl, rootId: string, parentId?: string): DeviceTreeItem {
  return { id: node.id, name: node.name, driver: node.driver, enabled: node.enabled, node,
    canvasNodeId: node.driver === PROTOCOL_ENGINE_DRIVER_ID ? node.id : rootId,
    rootId, parentId, source: 'declaration',
    children: node.children.map(child => declarationItem(child, rootId, node.id)) };
}

/** Only data-plane connections establish tree ownership, never numeric output or feedback. */
function ownershipEdge(source: Node, target: Node, edge: Edge): boolean {
  if (source.id === target.id || source.data.tabId !== target.data.tabId) return false;
  const domain = target.type === 'point-selector' ? 'points' : 'bytes';
  if (edge.targetHandle !== (domain === 'points' ? 'points' : 'in')) return false;
  if (source.type === 'acquisition') {
    const ports = (source.data as AcquisitionNodeData).ports;
    return ports ? ports.some(port => port.id === edge.sourceHandle && port.direction !== 'input' && port.domain === domain)
      : edge.sourceHandle === (domain === 'bytes' ? 'rx' : 'points');
  }
  return domain === 'bytes' && ((source.type === 'protocol' && edge.sourceHandle === 'out')
    || (canvasDriver(source) === 'frame-decoder' && edge.sourceHandle === 'raw'));
}

/** Unambiguous canvas-level graph nodes (not declared inside a device tree) are shown under their source without rewriting saved documents. **/
export function buildDeviceTree(nodes: Node[], edges: Edge[], tabId?: string): DeviceTreeItem[] {
  const scoped = nodes.filter(node => tabId === undefined || node.data.tabId === tabId);
  const projections = deviceTreeCanvasNodes(scoped);
  const canvas = new Map([...scoped, ...projections].map(node => [node.id, node]));
  const items = new Map<string, DeviceTreeItem>();
  const roots: DeviceTreeItem[] = [];
  const index = (item: DeviceTreeItem) => { items.set(item.id, item); item.children.forEach(index); };
  for (const root of scoped.filter(node => node.type === 'acquisition')) {
    const item = declarationItem((root.data as AcquisitionNodeData).node, root.id);
    roots.push(item);
    index(item);
  }
  const canvasItems: DeviceTreeItem[] = [];
  for (const node of scoped) {
    const driver = canvasDriver(node);
    if (!driver || items.has(node.id)) continue;
    const widget = node.data.widget as WidgetConfig | undefined;
    const label = typeof node.data.label === 'string' ? node.data.label : widget?.params.label;
    const item: DeviceTreeItem = { id: node.id, name: typeof label === 'string' ? label : node.id,
      driver, enabled: true, canvasNodeId: node.id, rootId: node.id, source: 'canvas', children: [] };
    canvasItems.push(item);
    items.set(item.id, item);
  }
  const parents = new Map<string, string>();
  for (const item of canvasItems) {
    const target = canvas.get(item.id)!;
    const candidates = new Set(edges.filter(edge => edge.target === item.id).flatMap(edge => {
      const source = canvas.get(edge.source);
      return source && items.has(source.id) && ownershipEdge(source, target, edge) ? [source.id] : [];
    }));
    if (candidates.size === 1) parents.set(item.id, [...candidates][0]);
  }
  // Malformed imported cycles remain visible as independent roots.
  const cyclic = new Set<string>();
  for (const item of canvasItems) {
    const visited = new Set([item.id]);
    let ancestor = parents.get(item.id);
    while (ancestor) {
      if (visited.has(ancestor)) { cyclic.add(item.id); break; }
      visited.add(ancestor);
      ancestor = parents.get(ancestor);
    }
  }
  cyclic.forEach(id => parents.delete(id));
  for (const item of canvasItems) {
    const parentId = parents.get(item.id);
    const parent = parentId && items.get(parentId);
    if (parent) { item.parentId = parent.id; parent.children.push(item); }
    else roots.push(item);
  }
  const assignRoot = (item: DeviceTreeItem, rootId: string) => {
    item.rootId = rootId;
    item.children.forEach(child => assignRoot(child, rootId));
  };
  roots.forEach(root => assignRoot(root, root.id));
  return roots;
}
