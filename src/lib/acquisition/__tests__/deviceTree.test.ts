import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Edge, Node } from '@xyflow/react';
import type { DeviceTreeNodeDecl } from '../../../types';
import { useAppStore } from '../../../store/appStore';
import { useHistoryStore } from '../../../store/historyStore';
import { api } from '../../tauri/tauri';
import { simulationConfig, updateAcquisitionNode, withSimulation } from '../acquisitionNodes';
import { acquisitionNodeFromDecl } from '../../../test/acquisitionFixtures';
import { defaultSimulation, resolveSimulation } from '../simulation';
import {
  addDeviceTreeChild, buildDeviceTree, createProtocolEngineNode, createSimulationNode,
  deviceTreeCanvasEdges, deviceTreeCanvasNodes, findDeviceTreeNode, removeDeviceTreeChild,
  removeDeviceTreeNode, updateDeviceTreeChild, updateDeviceTreeNode, validateDeviceTreeName, walkDeviceTree,
} from '../deviceTree';

const decl = (id: string, children: DeviceTreeNodeDecl[] = []): DeviceTreeNodeDecl => ({
  id, name: id, driver: 'serial', schemaVersion: 1, enabled: true, config: {}, children,
});
const protocol = (id: string, children: DeviceTreeNodeDecl[] = []): DeviceTreeNodeDecl => ({
  ...decl(id, children), driver: 'protocol-engine',
  config: { protocol: { kind: 'JustFloat', channels: 2 }, convertTo: null, schema: null },
});
const canvas = (id: string, type = 'protocol', tabId = 'default'): Node => ({
  id, type, position: { x: 0, y: 0 },
  data: { tabId, label: id, config: { kind: 'JustFloat', channels: null } },
});
const edge = (source: string, target: string, sourceHandle = 'rx', targetHandle = 'in'): Edge => ({
  id: `${source}-${target}-${sourceHandle}`, source, target, sourceHandle, targetHandle,
});

describe('device-tree declaration operations', () => {
  it('traverses and edits nested nodes while preserving untouched branches', () => {
    const root = decl('root', [protocol('parser', [protocol('nested')]), decl('other')]);
    const updated = updateDeviceTreeNode(root, 'nested', node => ({ ...node, name: 'Renamed' }));
    expect(walkDeviceTree(updated).map(node => node.id)).toEqual(['root', 'parser', 'nested', 'other']);
    expect(findDeviceTreeNode(updated, 'nested')?.name).toBe('Renamed');
    expect(findDeviceTreeNode(root, 'nested')?.name).toBe('nested');
    expect(updated.children[1]).toBe(root.children[1]);
    expect(updateDeviceTreeNode(root, 'missing', node => ({ ...node, enabled: false }))).toBe(root);
  });

  it('removes the whole selected subtree', () => {
    const root = decl('root', [protocol('parser', [protocol('nested')]), decl('other')]);
    expect(walkDeviceTree(removeDeviceTreeNode(root, 'parser')!).map(node => node.id)).toEqual(['root', 'other']);
    expect(removeDeviceTreeNode(root, 'missing')).toBe(root);
    expect(removeDeviceTreeNode(root, 'root')).toBeNull();
  });

  it('requires valid names unique among siblings and permits reuse across branches', () => {
    const root = decl('root', [protocol('a', [decl('inner')]), protocol('b')]);
    expect(validateDeviceTreeName(root, 'b', 'a')).toBeTruthy();
    expect(validateDeviceTreeName(root, 'b', 'inner')).toBeNull();
    expect(validateDeviceTreeName(root, 'a', 'a')).toBeNull();
    expect(validateDeviceTreeName(root, 'a', '   ')).toBeTruthy();
    expect(validateDeviceTreeName(root, 'a', 'folder/node')).toBeTruthy();
  });

  it('creates protocol and simulation declarations without colliding with sibling names', () => {
    // {protocol, convertTo, schema} 整体传入 — schema 单一来源是目录 prepare
    const config = {
      protocol: { kind: 'JustFloat' as const, channels: null },
      convertTo: null,
      schema: { preset: 'justFloat' as const, presetConfig: { kind: 'JustFloat' as const, channels: null }, decode: [] },
    };
    const first = createProtocolEngineNode(decl('root'), config);
    const parent = decl('root', [first]);
    const second = createProtocolEngineNode(parent, config);
    expect(first.id).not.toBe(second.id);
    expect(second).toMatchObject({ driver: 'protocol-engine', name: 'JustFloat 2', enabled: true,
      config: { protocol: { kind: 'JustFloat' }, convertTo: null, schema: { preset: 'justFloat' } } });
    expect(createSimulationNode(parent)).toMatchObject({ driver: 'simulation', config: { channels: 4, sampleRate: 100 } });
  });
});

describe('device-tree view and canvas projection', () => {
  it('keeps every declaration including disabled nodes under its owning device', () => {
    const root = decl('root', [{ ...decl('disabled', [decl('grandchild')]), enabled: false }]);
    const tree = buildDeviceTree([acquisitionNodeFromDecl(root)], []);
    expect(tree[0]).toMatchObject({ id: 'root', source: 'declaration', rootId: 'root' });
    expect(tree[0].children[0]).toMatchObject({ id: 'disabled', enabled: false, parentId: 'root' });
    expect(tree[0].children[0].children[0]).toMatchObject({ id: 'grandchild', rootId: 'root', canvasNodeId: 'root' });
  });

  it('attaches legacy protocol chains and frame decoders by legal byte edges only', () => {
    const source = acquisitionNodeFromDecl(decl('root'));
    const parser = canvas('parser');
    const decoder = { ...canvas('decoder', 'widget'), data: { tabId: 'default', widget: { kind: 'FrameDecoder', params: { label: 'Frame decoder' } } } };
    const invalid = canvas('invalid');
    const tree = buildDeviceTree([source, parser, decoder, invalid], [
      edge('root', 'parser'), edge('parser', 'decoder', 'out'), edge('parser', 'invalid', 'ch0'),
    ]);
    expect(tree.map(node => node.id)).toEqual(['root', 'invalid']);
    expect(tree[0].children[0]).toMatchObject({ id: 'parser', source: 'canvas', rootId: 'root' });
    expect(tree[0].children[0].children[0]).toMatchObject({ id: 'decoder', rootId: 'root', name: 'Frame decoder' });
  });

  it('attaches point selectors only to the points output', () => {
    const source = acquisitionNodeFromDecl(decl('root'));
    source.data.ports = [{ id: 'points', direction: 'output', domain: 'points' }];
    const selector = canvas('selector', 'point-selector');
    expect(buildDeviceTree([source, selector], [edge('root', 'selector', 'points', 'points')])[0].children[0].id).toBe('selector');
    expect(buildDeviceTree([source, selector], [edge('root', 'selector', 'rx', 'points')])).toHaveLength(2);
  });

  it('keeps shared, disconnected, cyclic, and cross-tab legacy nodes visible without guessing ownership', () => {
    const root = acquisitionNodeFromDecl(decl('root'));
    const other = acquisitionNodeFromDecl(decl('other'));
    const shared = canvas('shared');
    const isolated = canvas('isolated');
    const remote = canvas('remote', 'protocol', 'other-tab');
    const nodes = [root, other, shared, isolated, remote];
    const edges = [edge('root', 'shared'), edge('other', 'shared'), edge('root', 'remote')];
    expect(buildDeviceTree(nodes, edges, 'default').map(node => node.id)).toEqual(['root', 'other', 'shared', 'isolated']);
    expect(buildDeviceTree(nodes, edges).find(node => node.id === 'remote')?.parentId).toBeUndefined();
    const cycle = buildDeviceTree([canvas('a'), canvas('b')], [edge('a', 'b', 'out'), edge('b', 'a', 'out')]);
    const ids = cycle.flatMap(node => [node.id, ...node.children.map(child => child.id)]);
    expect(ids.sort()).toEqual(['a', 'b']);
  });

  it('projects nested protocol engines and implicit byte edges without persisting duplicate nodes', () => {
    const root = acquisitionNodeFromDecl(decl('root', [protocol('parser', [protocol('nested')]), createSimulationNode(decl('root'))]), { x: 10, y: 20 });
    const projected = deviceTreeCanvasNodes([root]);
    expect(projected.map(node => node.id)).toEqual(['parser', 'nested']);
    expect(projected[0]).toMatchObject({ draggable: false, selectable: false, deletable: false,
      position: { x: 250, y: 20 }, data: { treeRootId: 'root', treeParentId: 'root', tabId: 'default', label: 'parser', channels: 2 } });
    expect(projected[1].position).toEqual({ x: 490, y: 140 });
    expect(deviceTreeCanvasEdges([root])).toMatchObject([
      { source: 'root', sourceHandle: 'rx', target: 'parser', targetHandle: 'in', deletable: false },
      { source: 'parser', sourceHandle: 'out', target: 'nested', targetHandle: 'in', deletable: false },
    ]);
    expect(buildDeviceTree([root, canvas('legacy')], [edge('nested', 'legacy', 'out')])[0].children[0].children[0].children[0].id).toBe('legacy');
  });

  it('shows disabled protocol branches without exposing them as active data connections', () => {
    const root = acquisitionNodeFromDecl(decl('root', [{ ...protocol('parser', [protocol('nested')]), enabled: false }]));
    expect(deviceTreeCanvasNodes([root]).map(node => [node.data.enabled, node.connectable])).toEqual([[false, false], [false, false]]);
    expect(deviceTreeCanvasEdges([root])).toEqual([]);
  });

  it('routes a protocol below simulation from the parent byte source', () => {
    const simulated = { ...createSimulationNode(decl('root')), children: [protocol('sim-parser')] };
    const root = acquisitionNodeFromDecl(decl('root', [simulated]));
    expect(deviceTreeCanvasEdges([root])).toMatchObject([
      { id: 'device-tree:root:sim-parser', source: 'root', sourceHandle: 'rx', target: 'sim-parser' },
    ]);
  });

  it('resolves test data format from a protocol child without standalone canvas nodes', () => {
    const root = acquisitionNodeFromDecl(withSimulation(decl('root', [protocol('parser')]), defaultSimulation()));
    expect(resolveSimulation(root, [root], [])).toMatchObject({ encoding: { protocol: { kind: 'JustFloat', channels: 2 } } });
  });
});

describe('device-tree store changes', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    useAppStore.setState({ rfNodes: [], rfEdges: [], controlTabs: [{ id: 'default', name: 'Tab 1' }],
      activeControlTabId: 'default', connectionStates: {}, dataTabs: [], activeDataTabId: '' });
    useHistoryStore.getState().clearHistory();
  });

  it('closes the root session for nested changes and records undoable history', () => {
    const source = acquisitionNodeFromDecl(decl('root', [protocol('parser')]));
    useAppStore.setState({ rfNodes: [source] });
    useHistoryStore.getState().clearHistory();
    const close = vi.spyOn(api, 'closeAcquisitionNode').mockResolvedValue(undefined);
    const sync = vi.spyOn(useAppStore.getState(), 'syncAllTabGraphs');
    expect(updateDeviceTreeChild('root', 'parser', { config: { protocol: { kind: 'RawData' }, schema: null, convertTo: null } })).toBe(true);
    expect(close).toHaveBeenCalledWith('root');
    expect(sync).toHaveBeenCalled();
    expect(useAppStore.getState().connectionStates.root).toBe('Disconnected');
    useHistoryStore.getState().undo();
    expect(((useAppStore.getState().rfNodes[0].data.node as DeviceTreeNodeDecl).children[0].config as { protocol: unknown }).protocol).toEqual({ kind: 'JustFloat', channels: 2 });
  });

  it('removes subtree edges atomically and restores them on undo', () => {
    const source = acquisitionNodeFromDecl(decl('root', [protocol('parser', [protocol('nested')])]));
    const outgoing = edge('nested', 'display', 'ch0', 'value');
    useAppStore.setState({ rfNodes: [source, canvas('display', 'widget')], rfEdges: [outgoing] });
    useHistoryStore.getState().clearHistory();
    vi.spyOn(api, 'closeAcquisitionNode').mockResolvedValue(undefined);
    expect(removeDeviceTreeChild('root', 'parser')).toBe(true);
    expect(useAppStore.getState().rfEdges).toEqual([]);
    expect((useAppStore.getState().rfNodes[0].data.node as DeviceTreeNodeDecl).children).toEqual([]);
    useHistoryStore.getState().undo();
    expect(useAppStore.getState().rfEdges).toEqual([outgoing]);
  });

  it('rejects duplicate IDs and sibling names before altering the document', () => {
    const source = acquisitionNodeFromDecl(decl('root', [protocol('parser'), protocol('second')]));
    useAppStore.setState({ rfNodes: [source] });
    expect(addDeviceTreeChild('root', 'root', protocol('parser'))).toBe(false);
    expect(addDeviceTreeChild('root', 'root', { ...protocol('third'), name: 'parser' })).toBe(false);
    expect(updateDeviceTreeChild('root', 'second', { name: 'parser' })).toBe(false);
    expect(removeDeviceTreeChild('root', 'root')).toBe(false);
    expect(useAppStore.getState().rfNodes[0]).toBe(source);
  });

  it('preserves simulation identity and enabled state when changing its signal settings', () => {
    const simulation = { ...createSimulationNode(decl('root')), id: 'custom-sim', name: 'Test signal', enabled: false };
    const source = decl('root', [simulation, protocol('parser')]);
    const changed = withSimulation(source, { ...defaultSimulation(), sampleRate: 250 });
    expect(changed.children.map(node => node.id)).toEqual(['custom-sim', 'parser']);
    expect(changed.children[0]).toMatchObject({ id: 'custom-sim', name: 'Test signal', enabled: false });
    expect(simulationConfig(changed)).toBeNull();
  });

  it('does not close sessions for equivalent configs or live simulation signal changes', () => {
    const source = acquisitionNodeFromDecl(withSimulation(decl('root'), defaultSimulation()));
    source.data.node.config = { baud: 115200, parity: 'none' };
    useAppStore.setState({ rfNodes: [source] });
    const close = vi.spyOn(api, 'closeAcquisitionNode').mockResolvedValue(undefined);
    updateAcquisitionNode('root', { ...source.data.node, config: { parity: 'none', baud: 115200 } });
    expect(useAppStore.getState().rfNodes[0]).toBe(source);
    updateAcquisitionNode('root', withSimulation(source.data.node, { ...defaultSimulation(), sampleRate: 200 }));
    expect(close).not.toHaveBeenCalled();
    expect(simulationConfig(useAppStore.getState().rfNodes[0].data.node as DeviceTreeNodeDecl)?.sampleRate).toBe(200);
  });
});
