import type { ConnectionState, TransportStats } from '../../types';
import type { GraphEdge } from '../utils/nodeDef';
import type { NodeDocument } from '../nodes/document';


/// 节点端口提示 — 与后端 `app_state::SourceNodeHint` 同形
/// (供拓扑 op 解析默认 handle / RawData `src:` 改写; 字段缺省时后端按类型兜底)
export interface SourceNodeHintPayload {
  default_input?: string;
  default_output?: string;
  raw_data?: boolean;
}

/// 画布坐标 — 与后端 `app_state::Position` / React Flow `node.position` 同形。
/// `width`/`height` 是用户显式调整后的节点尺寸 (缺省 = 随内容自适应),
/// 旧工作区文件无此字段, 后端 serde default 兜底。
export interface PositionPayload {
  x: number;
  y: number;
  width?: number;
  height?: number;
}

/// widget 配置记录 — 与后端 `app_state::WidgetRecord` 同形。
/// 前端 `WidgetConfig` 的透传存储 (kind + params), 后端不解释、原样回传
export interface WidgetRecordPayload {
  id: string;
  kind: string;
  params: Record<string, unknown>;
}

/// `graph:source` 事件 / get_source_graph 响应 — tab 权威源图
/// (含 widget 配置记录与画布位置: 画布据此重建该 tab 完整视图)
export interface GraphSourceEventPayload {
  documents: NodeDocument[];
  tab_id: string;
  version: number;
  edges: GraphEdge[];
}

/// 控件 tab 元数据 — 与后端 `app_state::TabMeta` 同形
export interface TabMetaPayload {
  id: string;
  name: string;
}

/// 数据面板 tab 元数据 — 与后端 `app_state::DataTabMeta` 同形
export interface DataTabMetaPayload {
  id: string;
  name: string;
  type: string;
  closable: boolean;
  widget_id?: string | null;
}

/// `workspace_get` 响应 — 工作区水合快照 (null = 无持久化工作区, 默认启动)
export interface WorkspaceSnapshotPayload {
  version: number;
  tabs: TabMetaPayload[];
  data_tabs: DataTabMetaPayload[];
  graphs: {
    tab_id: string;
    documents: NodeDocument[];
    edges: GraphEdge[];
  }[];
}

/// 数据管道性能配置 (snake_case, 与后端 PipelineConfig 对应)
/// 后端不持久化 — 前端在设置加载完成后重放, 更新即推送
export interface PipelineConfig {
  mode: 'auto';
  max_workers: number;
  /** 数值平面评估 worker 数 (1 = 串行默认; ≥2 启用图内路径并行评估) */
  eval_workers: number;
  memory_budget_mb: number;
  preview_fps_limit: number;
  preview_bandwidth_mb_per_sec: number;
}

export interface RecordingHealth {
  accepted_batches: number;
  accepted_bytes: number;
  persisted_batches: number;
  persisted_bytes: number;
  accepted_sequence: number;
  persisted_sequence: number;
  queued_batches: number;
  /** 数据库写入总开关 (设置项)。false = 用户主动关闭, 不是故障。 */
  enabled: boolean;
  /** 写线程队列打满而丢弃的批次数 — 正常背压, 采集不受影响但这段录制不完整。 */
  dropped_batches: number;
  /** 绑定竞态被拒的批次数 — 同样不影响采集。 */
  rejected_batches: number;
  /** 可见但非故障的提示 (例如打开时自动重建过数据库)。 */
  warning: string | null;
  failed: string | null;
}

export interface RecordingSession {
  id: string;
  started_at_us: number;
  ended_at_us: number | null;
  state: 'running' | 'paused' | 'stopped' | 'failed';
}

export interface RecordingHistoryPage {
  rows: {
    row_id: number;
    session_id: string;
    binding_id: string;
    domain: 'bytes' | 'string' | 'float' | 'spectrum';
    epoch: number;
    sequence_start: number;
    sequence_end: number;
    first_timestamp_us: number;
    last_timestamp_us: number;
    item_count: number;
    effective_bytes: number;
    checksum: number;
    payload?: Record<string, unknown> | null;
  }[];
  next_row_id: number | null;
}

export interface RecordingBinding {
  id: string;
  session_id: string;
  component_id: string;
  source_node_id: string;
  source_handle: string;
  domain: 'bytes' | 'string' | 'float' | 'spectrum';
  capability: 'scalar' | 'text' | 'records' | 'curve' | 'raw';
  bound_at_us: number;
  unbound_at_us: number | null;
}

export interface RecordingSessionSummary {
  session: RecordingSession;
  binding_count: number;
  batch_count: number;
  item_count: number;
  effective_bytes: number;
  first_timestamp_us: number | null;
  last_timestamp_us: number | null;
  /** 当前写入目标会话 */
  active: boolean;
}

export interface RecordingDatabaseInfo {
  path: string;
  file_size_bytes: number;
  session_count: number;
  batch_count: number;
  item_count: number;
  effective_bytes: number;
}

export type RecordingExportFormat = 'csv' | 'json' | 'parquet';

export interface RecordingExportRequest {
  session_id: string;
  binding_id: string | null;
  from_us: number | null;
  to_us: number | null;
  format: RecordingExportFormat;
  path: string;
}

export interface RecordingExportResult {
  rows: number;
  bytes: number;
}

export interface RecordingCleanupPolicy {
  session_ids: string[];
  delete_stopped: boolean;
  delete_failed: boolean;
  older_than_us: number | null;
  keep_latest: number | null;
}

export interface RecordingCleanupResult {
  deleted_sessions: number;
  deleted_batches: number;
  deleted_items: number;
  deleted_bytes: number;
  /** Session that survived cleanup, or a note that the database was repaired. */
  warning?: string | null;
}

export interface RecordingSqlResult {
  rows: Record<string, unknown>[];
  truncated: boolean;
}

/// transport:state 事件 payload — 按节点分发
export interface TransportStateEvent {
  node_id: string;
  state: ConnectionState;
}

/// transport:rx 事件 payload — 按节点分发 (100ms 窗口增量统计)
export interface TransportRxEvent {
  node_id: string;
  stats: TransportStats;
}
