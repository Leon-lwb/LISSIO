import { transport } from '../../rpc';
import type { GraphEdge } from '../../utils/nodeDef';
import type { NodeDocument } from '../../nodes/document';
import type { GraphDerivedPayload } from '../../../store/slices/derived';

import type {
  DataTabMetaPayload,
  GraphSourceEventPayload,
  PositionPayload,
  TabMetaPayload,
  WorkspaceSnapshotPayload,
} from '../tauriTypes';

export const graphApi = {
  // ===== 节点图 (后端化重构) =====
  /// 更新指定 tab 的节点图 (整体替换 nodes + edges; nodes 可含全局 Transport/Protocol 节点定义)
  /// nodeHints: 每节点端口提示 (后端拓扑 op 解析默认 handle / RawData 改写用)
  /// widgetRecords: 该 tab 全部 widget 配置记录 (配置模型的后端权威存储, 整体替换)
  /// positions: 节点画布位置 (合并进后端工作区位置表)
  /// baseVersion: 乐观并发基线 (期间被其他写入方推进则返回 GraphVersionConflict)
  /// 编译失败 (循环/域不匹配等) 返回真实原因, 旧图保留
  /// 返回 `GraphDerivedPayload` — 本次图变化涉及的全部节点派生端口表 / 通道数 + 新版本号
  updateTabGraph: (tabId: string, documents: NodeDocument[], edges: GraphEdge[], baseVersion?: number | null) =>
    transport.call<GraphDerivedPayload>('update_tab_graph', { tabId, documents, edges, baseVersion: baseVersion ?? null }),

  /// 上报节点画布位置 (拖拽结束时批量提交) — 轻量路径, 不触发编译
  setNodePositions: (positions: Record<string, PositionPayload>) =>
    transport.call<void>('set_node_positions', { positions }),

  /// 读取工作区水合快照; null = 无持久化工作区 (全新安装, 前端走默认启动)
  workspaceGet: () => transport.call<WorkspaceSnapshotPayload | null>('workspace_get'),

  /// 提交 tab 元数据 (控件 tab + 数据面板 tab) — 增删/改名/重排后整表覆盖
  workspaceSetTabs: (tabs: TabMetaPayload[], dataTabs: DataTabMetaPayload[]) =>
    transport.call<void>('workspace_set_tabs', { tabs, dataTabs }),

  /// 读取指定 tab 的权威源图 (版本冲突后拉取合并; tab 无源图时返回 null)
  getSourceGraph: (tabId: string) =>
    transport.call<GraphSourceEventPayload | null>('get_source_graph', { tabId }),

  /// 移除指定 tab 的节点图 (tab 删除时调用)
  /// 返回 `GraphDerivedPayload` — 删除后工作区剩余节点的派生数据 (供前端 derivedPorts 对账)
  removeTabGraph: (tabId: string) =>
    transport.call<GraphDerivedPayload>('remove_tab_graph', { tabId }),

  // ===== CAN 负载分析 =====
  /// 获取 CAN 负载统计快照
  /// nodeId: 用于自动解析波特率的设备节点 id
  /// bitrateBps: 可选手动覆盖波特率; null/0 = 自动从 TransportConfig 读取
};
