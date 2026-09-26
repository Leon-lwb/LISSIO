//! 应用快速开始模板 — 替换 / 合并两种模式
//!
//! - 替换: 清空当前工作区 (节点图 + 窗口组织 + 全局传输/协议节点 + 控件/标签页) 后应用模板,
//!          保留用户设置 (语言/主题等)。
//! - 合并: 把模板作为新控件标签页追加进当前工作区, 所有 ID 重映射避免冲突,
//!          全局 Transport/Protocol 节点不重复导入 — 模板边改指现有主节点。

import { nanoid } from 'nanoid';
import { canvasNode } from '../nodes/document';
import { useAppStore } from '../../store/appStore';
import { useDockStore } from '../../store/dockStore';
import { applySnapshot, type AppSnapshot } from '../tauri/appExport';
import { rebaseHistory } from '../../store/historyStore';
import { notify, formatError } from '../tauri/notifications';
import { t } from '../../i18n';
import type { DeviceTreeNodeDecl } from '../../types';

export type TemplateApplyMode = 'replace' | 'merge';

/// 重映射 RawData 动态端口 id (`src:<sourceId>:<handle>`) 中的 sourceId
function remapRawDataHandle(handle: string | undefined | null, idMap: Map<string, string>): string | undefined | null {
  if (!handle?.startsWith('src:')) return handle;
  const m = /^src:([^:]+):(.*)$/.exec(handle);
  if (!m) return handle;
  const newSource = idMap.get(m[1]) ?? m[1];
  return `src:${newSource}:${m[2]}`;
}

/// 合并模式: 将模板作为新控件标签页追加
function mergeTemplate(snap: AppSnapshot): void {
  const workspace = snap.workspace;
  if (!workspace) return;
  const treeIds = (node: DeviceTreeNodeDecl): string[] => [node.id, ...node.children.flatMap(treeIds)];
  const idMap = new Map(workspace.graphs.flatMap(g => g.documents.flatMap(n =>
    n.kind === 'device' ? treeIds(n.config.node) : [n.id])).map(id => [id, nanoid(8)]));
  const tabMap = new Map(workspace.tabs.map(tab => [tab.id, `tpl-${nanoid(8)}`]));
  const documents = workspace.graphs.flatMap(graph => graph.documents.map(doc => {
    const mapped = { ...doc, id: idMap.get(doc.id)!, tabId: tabMap.get(doc.tabId)! };
    if (mapped.kind !== 'device') return mapped;
    const remapTree = (node: DeviceTreeNodeDecl): DeviceTreeNodeDecl => ({
      ...node,
      id: idMap.get(node.id) ?? node.id,
      config: node.driver === 'simulation' ? {
        ...(node.config as Record<string, unknown>),
        referenceNodeId: typeof (node.config as { referenceNodeId?: unknown }).referenceNodeId === 'string'
          ? idMap.get((node.config as { referenceNodeId: string }).referenceNodeId) ?? null : null,
      } : node.config,
      children: node.children.map(remapTree),
    });
    return {
      ...mapped,
      config: {
        node: remapTree(mapped.config.node),
      },
    };
  }));
  const rfNodes = documents.map(doc => canvasNode(doc));
  const rfEdges = workspace.graphs.flatMap(graph => graph.edges.map(edge => ({
    id: nanoid(8), source: idMap.get(edge.source)!, target: idMap.get(edge.target)!,
    sourceHandle: remapRawDataHandle(edge.source_handle, idMap),
    targetHandle: remapRawDataHandle(edge.target_handle, idMap),
  })));
  const tabs = workspace.tabs.map(tab => ({ ...tab, id: tabMap.get(tab.id)! }));
  useAppStore.setState(state => ({
    controlTabs: [...state.controlTabs, ...tabs],
    dataTabs: [...state.dataTabs, ...workspace.dataTabs.filter(tab => tab.widgetId).map(tab => ({
      ...tab, id: nanoid(8), widgetId: idMap.get(tab.widgetId!)!,
    }))],
    rfNodes: [...state.rfNodes, ...rfNodes],
    rfEdges: [...state.rfEdges, ...rfEdges],
    activeControlTabId: tabs[0].id,
  }));

  // 同步新标签页节点图到后端 + 对账 Dock 卡片 (安置新增 Tab)
  useAppStore.getState().syncAllTabGraphs();
  const st = useAppStore.getState();
  useDockStore.getState().reconcile('control', st.controlTabs.map((t) => t.id));
  useDockStore.getState().reconcile('data', st.dataTabs.map((t) => t.id));
}

/// 应用模板 (替换 / 合并), 完成后弹出成功提示
export async function applyTemplate(
  snap: AppSnapshot,
  mode: TemplateApplyMode
): Promise<void> {
  const lang = useAppStore.getState().lang;
  try {
    if (mode === 'replace') {
      // 模板不含设置 — 明确只应用节点图/窗口组织/传输协议/控件标签页
      await applySnapshot(snap, {
        sections: ['workspace', 'windowLayout'],
      });
    } else {
      mergeTemplate(snap);
      // 合并模式不走 applySnapshot — 撤销历史同样重置为新基线
      rebaseHistory('opApplyTemplate');
    }

    const isConnected = Object.values(useAppStore.getState().connectionStates).some(
      (v) => v === 'Connected'
    );
    notify.info(
      t(lang, 'templateApplySuccess'),
      isConnected ? t(lang, 'templateApplySuccessDescReconnect') : t(lang, 'templateApplySuccessDesc'),
      { source: 'applyTemplate' }
    );
  } catch (e) {
    notify.error(t(lang, 'templateApplyFailed'), formatError(e), { source: 'applyTemplate' });
  }
}
