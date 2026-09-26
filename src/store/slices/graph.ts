import {
  applyNodeChanges,
  applyEdgeChanges,
  addEdge,
  type Node,
  type Edge,
  type NodeChange,
  type EdgeChange,
  type Connection,
} from '@xyflow/react';
import { nanoid } from 'nanoid';
import { api } from '../../lib/tauri/tauri';
import { setInputValue as apiSetInputValue, submitCustomOutput as apiSubmitCustomOutput } from '../../lib/buffers/graphSubscription';
import {
  isStructuralNode,
  syncTabGraphToBackend,
  removeTabGraphFromBackend,
  enqueueWorkspaceWrite,
  DEFAULT_PROTOCOL_CONFIG,
} from '../appStoreHelpers';
import { loadAdapterCapabilities } from '../../lib/acquisition/capabilityCatalog';
import { buildDeviceCards } from '../../lib/acquisition/deviceCardModel';
import { prepareAcquisitionNode, type AcquisitionNodeData } from '../../lib/acquisition/acquisitionNodes';
import { prepareProtocolDocument } from '../../lib/models/createFromCatalog';
import { deviceTreeCanvasNodes, walkDeviceTree } from '../../lib/acquisition/deviceTreeModel';
import { createProtocolEngineNode } from '../../lib/acquisition/deviceTree';
import { useDockStore } from '../dockStore';
import { NODE_PROPERTIES_TAB_ID } from '../../types';
import { rawDataPortId } from '../../lib/utils/nodeDef';
import { withHistoryOp } from '../historyStore';
import type { HistoryTarget, NodeOpRef } from '../historyStore';
import { nodeLabelOf, nodeRefOf } from '../../lib/utils/nodeKindVisuals';
import type { DeviceTreeNodeDecl, WidgetConfig } from '../../types';
import type { AppSlice } from './types';

export interface GraphSlice {
  renameNode: (nodeId: string, label: string) => void;
  rfNodes: Node[];
  rfEdges: Edge[];
  /// 后端全局图版本号 (null = 尚未同步过; 作为下次提交的 base_version 冲突基线)
  graphVersion: number | null;
  /// 启动水合已完成 (workspace_get 已裁决: 水合或默认启动)
  workspaceReady: boolean;
  /// 是否水合了后端持久化工作区 (true = 不走初始同步与种子流程)
  workspaceRestored: boolean;
  setGraphVersion: (v: number) => void;
  onNodesChange: (changes: NodeChange[]) => void;
  onEdgesChange: (changes: EdgeChange[]) => void;
  onConnect: (connection: Connection) => void;
  getTabNodes: (tabId: string) => Node[];
  getTabEdges: (tabId: string) => Edge[];
  /// 同步指定 tab 图到后端 (同 tab 串行化); 返回错误文案, 成功 undefined
  syncTabGraph: (tabId: string) => Promise<string | undefined>;
  syncAllTabGraphs: () => void;
  removeTabGraph: (tabId: string) => void;
  setInputValue: (widgetId: string, value: number) => void;
  submitCustomOutput: (widgetId: string, outputs: Record<string, number>) => void;
  removeNode: (nodeId: string) => void;
  /// 设置节点显式尺寸 (属性面板数字输入; undefined = 恢复内容自适应)
  setNodeSize: (nodeId: string, size: { width?: number; height?: number }) => void;
  /// 初始图种子: Serial → JustFloat → RawData，选中 Serial 并打开数据/属性窗口
  seedInitialGraph: (rawDataWidgetId: string, source?: 'startup' | 'user') => Promise<void>;
}

export const createGraphSlice: AppSlice<GraphSlice> = (set, get) => {
  /** 节点 id → 视觉引用, 找不到返回 null */
  const nodeById = (id: string | null | undefined): Node | undefined =>
    get().rfNodes.find((n: Node) => n.id === id);
  const refOf = (id: string | null | undefined): NodeOpRef | null => nodeRefOf(nodeById(id));

  /// 变更涉及的页签集合
  const affectedTabsOf = (nodeIds: (string | null | undefined)[]): string[] => {
    const state = get();
    const tabs = new Set<string>();
    const allNodes = [...state.rfNodes, ...deviceTreeCanvasNodes(state.rfNodes)];
    for (const id of nodeIds) {
      if (!id) continue;
      const node = allNodes.find((n: Node) => n.id === id);
      if (!node) continue;
      if (node.data?.tabId) tabs.add(node.data.tabId as string);
    }
    return [...tabs];
  };

  /** 上报节点布局 (位置 + 显式尺寸) 到后端工作区 — 轻量路径, 不触发编译 */
  const persistNodeLayouts = (nodeIds: string[]): void => {
    const layouts: Record<string, { x: number; y: number; width?: number; height?: number }> = {};
    for (const id of nodeIds) {
      const node = get().rfNodes.find((n: Node) => n.id === id);
      if (!node) continue;
      layouts[id] = {
        x: node.position.x,
        y: node.position.y,
        ...(node.width != null ? { width: node.width } : {}),
        ...(node.height != null ? { height: node.height } : {}),
      };
    }
    if (Object.keys(layouts).length) {
      void enqueueWorkspaceWrite(() => api.setNodePositions(layouts)).catch(() => { return undefined; });
    }
  };

  return {
    renameNode: (nodeId, label) => {
      if (!label.trim()) return;
      withHistoryOp({ opKey: 'opUpdateWidget', detailText: label }, () => {
        set((s) => ({ rfNodes: s.rfNodes.map((node) => {
          if (node.id !== nodeId) return node;
          const widget = node.data.widget as WidgetConfig | undefined;
          const device = node.data.node as DeviceTreeNodeDecl | undefined;
          return { ...node, data: { ...node.data, label: label.trim(),
            ...(widget ? { widget: { ...widget, params: { ...widget.params, label: label.trim() } } } : {}),
            ...(device ? { node: { ...device, name: label.trim() } } : {}),
          } };
        }) }));
        get().syncAllTabGraphs();
      });
    },
    rfNodes: [],
    rfEdges: [],
    graphVersion: null,
    workspaceReady: false,
    workspaceRestored: false,

    setGraphVersion: (v) => set({ graphVersion: v }),

    syncTabGraph: (tabId) => syncTabGraphToBackend(tabId),

    syncAllTabGraphs: () => {
      get().controlTabs.forEach((tab) => { void get().syncTabGraph(tab.id); });
    },

    removeTabGraph: (tabId) => {
      void removeTabGraphFromBackend(tabId).catch(error => console.warn('[workspace] remove tab failed', error));
    },

    setInputValue: (widgetId, value) => {
      void apiSetInputValue(widgetId, value);
    },

    submitCustomOutput: (widgetId, outputs) => {
      void apiSubmitCustomOutput(widgetId, outputs);
    },

    removeNode: (nodeId) => {
      const victim = get().rfNodes.find((n: Node) => n.id === nodeId);
      if (victim?.type === 'widget') {
        get().removeWidget(nodeId);
        return;
      }
      const ref = nodeRefOf(victim);
      return withHistoryOp(
        {
          opKey: 'opRemoveNode',
          detailText: nodeLabelOf(victim),
          target: ref ? { kind: 'node', node: ref } : undefined,
        },
        () => {
          const node = get().rfNodes.find((n: Node) => n.id === nodeId);
          if (!node || !isStructuralNode(node)) return;
          // 关闭仍打开的连接 (尽力而为)
          if (node.type === 'acquisition') void api.closeTransport(nodeId).catch(() => { return undefined; });
          const removedIds = new Set(node.type === 'acquisition'
            ? walkDeviceTree((node.data as AcquisitionNodeData).node).map(child => child.id) : [nodeId]);
          set((s) => ({
            rfNodes: s.rfNodes.filter((n: Node) => n.id !== nodeId),
            rfEdges: s.rfEdges.filter((e: Edge) => !removedIds.has(e.source) && !removedIds.has(e.target)),
          }));
          // 同步清理派生端口表 (后端 remove_tab_graph 也会发新的 GraphDerived,
          // 但单节点删除不会触发 remove_tab_graph, 需前端本地清理)
          get().removeDerived([...removedIds]);
          get().syncAllTabGraphs();
        }
      );
    },

    setNodeSize: (nodeId, size) =>
      withHistoryOp(
        {
          opKey: 'opResizeNodes',
          target: (() => {
            const ref = refOf(nodeId);
            return ref ? { kind: 'node', node: ref } : { kind: 'nodes' };
          })(),
        },
        () => {
          set((s) => ({
            rfNodes: s.rfNodes.map((n: Node) =>
              n.id === nodeId
                ? { ...n, width: size.width ?? undefined, height: size.height ?? undefined }
                : n
            ),
          }));
          persistNodeLayouts([nodeId]);
        },
        // 宽/高两字段连续提交 — 合并为一条
        { coalesceKey: `node.size.${nodeId}` }
      ),

    seedInitialGraph: async (rawDataWidgetId, source = 'startup') => {
      try {
        const adapters = await loadAdapterCapabilities();
        const state = get();
        const rawNode = state.rfNodes.find(n => n.id === rawDataWidgetId);
        if (!rawNode || (source === 'startup' && state.workspaceRestored)) return;
        const tabId = rawNode.data.tabId as string;
        // Async catalog loading must not duplicate nodes or overwrite work started meanwhile.
        if (state.rfNodes.some(n => n.data.tabId === tabId && n.id !== rawDataWidgetId)) return;
        const card = buildDeviceCards(adapters).find(c => c.adapter.adapterId === 'serial');
        if (!card) return;
        // 设备根节点 (目录 driver 默认配置) + 协议引擎子节点
        // (schema 单一来源 = 目录 prepare)
        const device = await prepareAcquisitionNode(card, { x: 60, y: 100 }, tabId);
        const { protocol, schema } = await prepareProtocolDocument(DEFAULT_PROTOCOL_CONFIG, tabId);
        const protocolChild = createProtocolEngineNode(device.data.node as DeviceTreeNodeDecl, { protocol, convertTo: null, schema });
        (device.data.node as DeviceTreeNodeDecl).children.push(protocolChild);
        device.selected = true;
        set(s => ({
          rfNodes: [...s.rfNodes.map(n => ({ ...n, selected: false })), device],
          activeControlTabId: tabId,
        }));
        get().onConnect({ source: protocolChild.id, sourceHandle: 'out', target: rawDataWidgetId, targetHandle: 'data' });
        get().addNodePropertiesTab();
        get().setActiveDataTab(rawDataWidgetId);
        const dock = useDockStore.getState();
        dock.reconcile('control', get().controlTabs.map(tab => tab.id));
        dock.reconcile('data', get().dataTabs.map(tab => tab.id));
        dock.dockPropertiesTab(NODE_PROPERTIES_TAB_ID);
        const controlCard = Object.values(useDockStore.getState().cards).find(c => c.kind === 'control' && c.tabIds.includes(tabId));
        if (controlCard) dock.setActiveTab(controlCard.id, tabId);
        const dataCard = Object.values(useDockStore.getState().cards).find(c => c.tabIds.includes(rawDataWidgetId));
        if (dataCard) dock.setActiveTab(dataCard.id, rawDataWidgetId);
      } catch (error) {
        console.warn('[workspace] initial device catalog unavailable', error);
      }
    },

    onNodesChange: (changes) => {
      // 键盘 Delete 删除节点: 清理其边 + 关闭设备 + 同步所属页签
      // (X 按钮走 removeNode; 这里兜 React Flow 的 remove change)
      // 撤销埋点: 仅记录 remove / position / resize 三类 change, select/测量 dimensions 不入历史;
      // 拖动/缩放期间高频批按时间窗合并为一条
      const removing = changes.some((ch) => ch.type === 'remove');
      const moving = changes.some((ch) => ch.type === 'position');
      // NodeResizer 结束批 (resizing=false) — 拖拽中的 resizing=true 批不入历史
      const resizing = changes.some(
        (ch) => ch.type === 'dimensions' && (ch as { resizing?: boolean }).resizing === false
      );
      const applyChanges = () => {
        const removedStructuralIds: string[] = [];
        const removedTransportIds: string[] = [];
        // 被删除的 widget 节点所属 tab — 删除后其边/节点定义须同步移除
        const removedWidgetTabIds = new Set<string>();
        for (const ch of changes) {
          if (ch.type === 'remove') {
            const node = get().rfNodes.find((n: Node) => n.id === ch.id);
            if (node && isStructuralNode(node)) {
              removedStructuralIds.push(...(node.type === 'acquisition'
                ? walkDeviceTree((node.data as AcquisitionNodeData).node).map(child => child.id) : [ch.id]));
              if (node.type === 'acquisition') removedTransportIds.push(ch.id);
            } else if (node?.data?.tabId) {
              removedWidgetTabIds.add(node.data.tabId as string);
            }
          }
        }
        set((s) => ({
          rfNodes: applyNodeChanges(changes, s.rfNodes),
          rfEdges: removedStructuralIds.length
            ? s.rfEdges.filter((e: Edge) => !removedStructuralIds.includes(e.source) && !removedStructuralIds.includes(e.target))
            : s.rfEdges,
        }));
        // 拖拽结束 (dragging=false 的收尾批) 上报最终位置 — 画布位置的后端
        // 权威存储随工作区落盘, 重启后布局不回跳; 拖拽过程批 (dragging=true) 不发
        if (moving) {
          persistNodeLayouts(changes.flatMap(ch => ch.type === 'position' && ch.dragging !== true ? [ch.id] : []));
        }
        // 缩放结束 (NodeResizer onEnd 的 resizing=false 批) — 连同位置上报显式尺寸
        if (resizing) {
          void persistNodeLayouts(
            changes
              .filter(
                (ch): ch is NodeChange & { id: string; type: 'dimensions' } =>
                  ch.type === 'dimensions' && (ch as { resizing?: boolean }).resizing === false
              )
              .map((ch) => ch.id)
          );
        }
        // 同步清理被删节点的派生端口表
        if (removedStructuralIds.length) {
          get().removeDerived(removedStructuralIds);
          for (const id of removedTransportIds) {
            void api.closeTransport(id).catch(() => { return undefined; });
          }
          get().syncAllTabGraphs();
        }
        removedWidgetTabIds.forEach((tabId) => { void get().syncTabGraph(tabId); });
      };
      if (removing || moving || resizing) {
        // 删除型批: 取首个被删节点作为徽章归属; 移动/混合删除为中性
        let target: HistoryTarget = { kind: 'nodes' };
        if (removing) {
          const removedId = changes.find(
            (ch): ch is NodeChange & { id: string } => ch.type === 'remove'
          )?.id;
          const ref = refOf(removedId);
          if (ref) target = { kind: 'node', node: ref };
        } else if (resizing) {
          const resizedId = changes.find(
            (ch): ch is NodeChange & { id: string } =>
              ch.type === 'dimensions' && (ch as { resizing?: boolean }).resizing === false
          )?.id;
          const ref = refOf(resizedId);
          if (ref) target = { kind: 'node', node: ref };
        }
        withHistoryOp(
          removing
            ? { opKey: 'opRemoveNodes', target }
            : resizing && !moving
              ? { opKey: 'opResizeNodes', target }
              : { opKey: 'opMoveNodes', target },
          applyChanges,
          {
            coalesceKey: removing ? 'node.remove' : resizing && !moving ? 'node.resize' : 'node.move',
          }
        );
      } else {
        applyChanges();
      }
    },

    onEdgesChange: (changes) => {
      // 撤销埋点: 仅记录 remove change (选择变化不入历史), 连发合并为一条
      const removing = changes.some((ch) => ch.type === 'remove');
      const applyChanges = () => {
        const affected = new Set<string>();
        // remove change 只有 id (无 source/target) — 必须先在旧边集合里查出端点
        const oldEdges = get().rfEdges;
        for (const ch of changes) {
          let source: string | null | undefined;
          let target: string | null | undefined;
          if (ch.type === 'remove') {
            const edge = oldEdges.find((e: Edge) => e.id === ch.id);
            source = edge?.source;
            target = edge?.target;
          } else {
            if ('source' in ch && typeof ch.source === 'string') source = ch.source;
            if ('target' in ch && typeof ch.target === 'string') target = ch.target;
          }
          if (source) affectedTabsOf([source]).forEach((t) => affected.add(t));
          if (target) affectedTabsOf([target]).forEach((t) => affected.add(t));
        }
        set((s) => ({
          rfEdges: applyEdgeChanges(changes, s.rfEdges),
        }));
        affected.forEach((tabId) => { void get().syncTabGraph(tabId); });
      };
      if (removing) {
        // 双端点视觉: 取第一条被删边的两端 (连线通常是单条操作)
        const firstRemovedId = changes.find(
          (ch): ch is EdgeChange & { id: string } => ch.type === 'remove'
        )?.id;
        const victim = get().rfEdges.find((e: Edge) => e.id === firstRemovedId);
        const fromRef = refOf(victim?.source);
        const toRef = refOf(victim?.target);
        withHistoryOp(
          {
            opKey: 'opDeleteEdges',
            detailText: victim ? `${nodeLabelOf(nodeById(victim.source))} → ${nodeLabelOf(nodeById(victim.target))}` : undefined,
            target: { kind: 'edge', ...(fromRef ? { from: fromRef } : {}), ...(toRef ? { to: toRef } : {}) },
          },
          applyChanges,
          { coalesceKey: 'edge.remove' }
        );
      } else {
        applyChanges();
      }
    },

    onConnect: (connection) => {
      const graphNodes = [...get().rfNodes, ...deviceTreeCanvasNodes(get().rfNodes)];
      const source = graphNodes.find(node => node.id === connection.source);
      const target = nodeById(connection.target);
      if (!source || !target || target.data.treeRootId || source.data.tabId !== target.data.tabId) return;
      const fromRef = refOf(connection.source);
      const toRef = refOf(connection.target);
      const fromLabel = nodeLabelOf(get().rfNodes.find((n: Node) => n.id === connection.source));
      const toLabel = nodeLabelOf(get().rfNodes.find((n: Node) => n.id === connection.target));
      return withHistoryOp(
        {
          opKey: 'opConnectNodes',
          detailText: `${fromLabel} → ${toLabel}`,
          target: {
            kind: 'edge',
            ...(fromRef ? { from: fromRef } : {}),
            ...(toRef ? { to: toRef } : {}),
          },
        },
        () => {
          const newEdge: Edge = {
            ...connection,
            id: nanoid(8),
          };
          const sourceNode = [...get().rfNodes, ...deviceTreeCanvasNodes(get().rfNodes)].find((n: Node) => n.id === connection.source);
          const targetNode = get().rfNodes.find((n: Node) => n.id === connection.target);
          const tabId = sourceNode?.data.tabId as string;
          // RawData 输入端口是动态派生的 (`src:<source>:<handle>`), 连接时它显示的回退端口 'data'
          // 在入边建立后即消失 — 必须把边的 targetHandle 改写为派生端口 id,
          // 否则 React Flow 找不到 handle (warning #008), 边无法渲染
          const targetWidget = targetNode?.data?.widget as WidgetConfig | undefined;
          if (targetWidget?.kind === 'RawData') {
            newEdge.targetHandle = rawDataPortId(connection.source, connection.sourceHandle);
          }
          set((s) => ({
            rfEdges: addEdge(newEdge, targetNode?.type === 'point-selector'
              ? s.rfEdges.filter(edge => edge.target !== targetNode.id || edge.targetHandle !== 'points')
              : s.rfEdges),
          }));
          if (tabId) void get().syncTabGraph(tabId);
        }
      );
    },

    getTabNodes: (tabId) => {
      const { rfNodes } = get();
      return rfNodes.filter((n: Node) => n.data.tabId === tabId);
    },

    getTabEdges: (tabId) => {
      const tabNodes = get().getTabNodes(tabId);
      const tabNodeIds = new Set([...tabNodes, ...deviceTreeCanvasNodes(tabNodes)].map((n: Node) => n.id));
      return get().rfEdges.filter((e: Edge) => tabNodeIds.has(e.source) && tabNodeIds.has(e.target));
    },
  };
}
