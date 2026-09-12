import { Channel, invoke } from '@tauri-apps/api/core';
import type {
  AiAttachment,
  AiChatEvent,
  AiChatSession,
  AiProviderConfig,
  AiSessionMeta,
  CanLoadSnapshot,
  ConnectionState,
  DecoderBlock,
  FrameDecoderManualResult,
  InputFormat,
  LoopbackResult,
  McpServerConfig,
  McpServerStatus,
  McpToolInfo,
  PortInfo,
  ProtocolConfig,
  ProtocolSchema,
  TransportConfig,
  TransportStats,
  CommandFrame,
  CommandSendOutcome,
  RunAction,
  RunSnapshot,
  SendTaskRegistration,
  WidgetBinding,
  WaveformWindow,
  WaveformWindowPayload,
  WaveformSeriesSelection,
  AutoSetSuggestion,
  SourceMeasurementsPayload,
  AdapterCapability,
  DriverPayload,
  DiscoveredEndpoint,
  EndpointSnapshot,
  AcquisitionIntent,
  EffectiveSubscription,
  PointReadResult,
  PointSample,
  PointWriteRequest,
  PointWriteResult,
} from '../../types';
import { normalizeWaveformWindow } from '../buffers/dataBuffer';
import type { GraphEdge } from '../utils/nodeDef';
import type { GraphDerivedPayload } from '../../store/slices/derived';
import { clearRawDataBuffer } from '../buffers/rawDataSubscription';
import { subscribeDisplay } from '../buffers/displaySubscription';
import { decodeWaveformWindow } from '../data/waveformProtocol';
import { perfEvent, tickMetric } from '../utils/perfLog';

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
  documents: import('../nodes/document').NodeDocument[];
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
    documents: import('../nodes/document').NodeDocument[];
    edges: GraphEdge[];
  }[];
}

/// 关闭 Tauri Channel 的完整流程:
/// 1. 调用后端 unsubscribe 命令, 从订阅者列表移除 (停止 send)
/// 2. 注销 JS 端回调 (cleanupCallback, 防止 callback id 残留)
/// 3. 清空 onmessage handler
///
/// 必须先调用后端移除再注销 JS 回调, 否则后端在 send 时找不到回调 ID 会产生警告。
export async function closeTauriChannel<T>(
  channel: Channel<T>,
  unsubscribeCmd?: string,
  channelId?: number,
): Promise<void> {
  // 1. 通知后端移除 (如果在 HMR 期间后端已不可达, 忽略错误)
  if (unsubscribeCmd && channelId != null) {
    try {
      await invoke(unsubscribeCmd, { channelId });
    } catch {
      // 后端可能已不可达 (HMR/重载), 忽略
    }
  }
  // 2. 注销 JS 端回调
  const ch = channel as unknown as { cleanupCallback?: () => void };
  if (typeof ch.cleanupCallback === 'function') {
    ch.cleanupCallback();
  }
  // 3. 清空 handler
  channel.onmessage = () => { return undefined; };
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

export const api = {
  // ===== 类型化采集适配器 =====
  describeAcquisitionPoints: (payload: DriverPayload) =>
    invoke<import('../../types').PointDescriptor[]>('describe_acquisition_points', { payload }),

  listAdapterCapabilities: () =>
    invoke<AdapterCapability[]>('list_adapter_capabilities'),

  discoverAcquisitionEndpoints: (adapterId: string) =>
    invoke<DiscoveredEndpoint[]>('discover_acquisition_endpoints', { adapterId }),

  validateAdapterConfiguration: (payload: DriverPayload) =>
    invoke<DriverPayload>('validate_adapter_configuration', { payload }),

  openAcquisitionEndpoint: (nodeId: string) =>
    invoke<EndpointSnapshot>('open_acquisition_endpoint', { nodeId }),

  closeAcquisitionEndpoint: (endpointId: string) =>
    invoke<void>('close_acquisition_endpoint', { endpointId }),

  listAcquisitionEndpoints: () =>
    invoke<EndpointSnapshot[]>('list_acquisition_endpoints'),

  readAcquisitionPoints: (endpointId: string, pointIds: string[]) =>
    invoke<PointReadResult>('read_acquisition_points', { endpointId, pointIds }),

  subscribeAcquisitionPoints: (
    endpointId: string,
    pointIds: string[],
    acquisition: AcquisitionIntent,
  ) => invoke<EffectiveSubscription>('subscribe_acquisition_points', {
    endpointId,
    intent: { points: pointIds, acquisition },
  }),

  writeAcquisitionPoints: (endpointId: string, request: PointWriteRequest) =>
    invoke<PointWriteResult>('write_acquisition_points', { endpointId, request }),

  latestAcquisitionSamples: (endpointId: string) =>
    invoke<PointSample[]>('latest_acquisition_samples', { endpointId }),

  // ===== 设备传输 (nodeId = 图中设备节点 id) =====
  listPorts: () => invoke<PortInfo[]>('list_ports'),

  /// 打开传输连接; protocol 仅被 TestData 用作生成数据的线缆格式参考
  /// schema: 可选帧 schema (custom 且带 encode 块时 TestData 按 schema 编码)
  closeTransport: (nodeId: string) =>
    invoke<void>('close_transport', { nodeId }),

  sendRaw: (nodeId: string, data: number[]) =>
    invoke<void>('send_raw', { nodeId, data }),

  sendString: (nodeId: string, text: string) =>
    invoke<void>('send_string', { nodeId, text }),

  /// TextOut 手动发送: 立即把图内当前文本发往该 TextOut 节点的目标 Transport
  sendTextOutNow: (nodeId: string) =>
    invoke<void>('send_text_out_now', { nodeId }),

  /// protocolNode: Auto 编码所用的 Protocol 节点 id (Manual 模式可传 null)
  sendWidgetValue: (
    nodeId: string,
    protocolNode: string | null,
    binding: WidgetBinding,
    value: number,
  ) =>
    invoke<void>('send_widget_value', { nodeId, protocolNode, binding, value }),

  /// 运行时热更新传输节点的链路协议 (图/协议变化后推送, 无需重连)
  /// schema: 可选帧 schema (与 openTransport 语义一致)
  updateTransportProtocol: (
    nodeId: string,
    protocol: ProtocolConfig,
    schema?: ProtocolSchema | null,
    testDataConfig?:
      Extract<TransportConfig, { kind: 'TestData' }>['params'] | null,
  ) =>
    invoke<void>('update_transport_protocol', {
      nodeId,
      protocol,
      schema: schema ?? null,
      testDataConfig: testDataConfig ?? null,
    }),

  /// 协议回环: 发送字节并立即捕获指定 Protocol 节点的解析结果
  sendAndCapture: (nodeId: string, protocolNode: string, data: number[]) =>
    invoke<LoopbackResult>('send_and_capture', {
      nodeId,
      protocolNode,
      data,
    }),

  /// 命令发送帧字节打包 — 后端 `compute_command_frame_bytes` IPC 单一权威
  /// (预览专用入口; 发送走 sendCommandFrame 统一内核)
  computeFrameBytes: (
    frame: CommandFrame,
    inputs: Record<string, number>,
  ) =>
    invoke<{
      bytes: number[] | null;
      error: string | null;
      per_block: number[][];
    }>('compute_command_frame_bytes', { frame, inputs }),

  /// 命令帧手动发送 — 统一发送内核 (与预览同一编码、与后台自动发送同一路由):
  /// 运行态门控 → compute_frame_bytes 编码 → 全局 BytePlan 字节边下发
  sendCommandFrame: (
    widgetId: string,
    frame: CommandFrame,
    inputs: Record<string, number>,
  ) =>
    invoke<CommandSendOutcome>('send_command_frame', { widgetId, frame, inputs }),

  /// 注册/替换 Command widget 的后台自动发送任务 (空数组 = 注销该 widget)。
  /// 发送触发完全在 Rust 侧 — 前端不持有任何发送定时器
  setWidgetSendTasks: (widgetId: string, tasks: SendTaskRegistration[]) =>
    invoke<number>('set_widget_send_tasks', { widgetId, tasks }),

  /// 工作区运行控制 — start (启动/恢复) / pause / stop; 返回切换后快照
  workspaceRun: (action: RunAction) =>
    invoke<RunSnapshot>('workspace_run', { action }),

  /// 读取当前运行快照 (水合用, 无事件)
  getWorkspaceRunState: () => invoke<RunSnapshot>('get_workspace_run_state'),

  // ===== 协议 (nodeId = 图中 Protocol 节点 id) =====
  setProtocol: (nodeId: string, config: ProtocolConfig) =>
    invoke<void>('set_protocol', { nodeId, config }),

  // ===== 波形缓冲区 (source = Protocol 节点 id) =====
  /// 订阅波形数据 — 后端 WWB1 二进制快照流 (TypedArray 零拷贝解码)
  /// 返回一个取消订阅函数
  subscribeWaveform: (
    source: string,
    onEvent: (window: WaveformWindow) => void,
    options?: {
      intervalMs?: number;
      maxPoints?: number;
      startMs?: number;
      endMs?: number;
      selection?: WaveformSeriesSelection;
    },
  ) => {
    perfEvent('subscribe display:waveform');
    const channel = new Channel<ArrayBuffer>();
    channel.onmessage = (buffer) => {
      tickMetric('display:waveform');
      onEvent(decodeWaveformWindow(buffer));
    };
    invoke('subscribe_data', {
      request: {
        kind: 'waveform',
        source,
        start_ms: options?.startMs,
        end_ms: options?.endMs,
        selection: options?.selection,
      },
      onEvent: channel,
      intervalMs: options?.intervalMs,
      maxItems: options?.maxPoints,
    }).catch((e) => {
      console.error('波形订阅失败:', e);
    });
    return {
      cancel: () =>
        void closeTauriChannel(channel, 'unsubscribe_data', channel.id),
    };
  },

  /// 订阅后端测量流 — 统计/周期在权威缓冲金字塔快照上计算 (JSON 推送)
  subscribeMeasurements: (
    source: string,
    windowMs: number,
    derived: WaveformSeriesSelection['derived'],
    onEvent: (m: SourceMeasurementsPayload) => void,
    intervalMs?: number,
  ) =>
    subscribeDisplay<SourceMeasurementsPayload>(
      { kind: 'measurements', source, window_ms: windowMs, derived },
      'measurements',
      onEvent,
      { intervalMs },
    ),

  /// 计算自动设置建议 — 后端周期检测 + 1-2-5 拟合 (阻塞线程执行)。
  /// 时基 = PERIODS_SHOWN(2) × 全部被测序列 (通道+派生) 中最慢的基波周期
  computeWaveformAutoset: (
    source: string,
    channels: number[],
    derived: WaveformSeriesSelection['derived'],
    sharedY: boolean,
    currentVPerDiv: number[],
  ) =>
    invoke<AutoSetSuggestion>('compute_waveform_autoset', {
      source,
      channels,
      derived,
      sharedY,
      currentVPerDiv,
    }),

  createWaveformSnapshot: (source: string) =>
    invoke<{ snapshot_id: string; overview: WaveformWindowPayload }>(
      'create_waveform_snapshot',
      { source },
    ).then((created) => ({
      snapshot_id: created.snapshot_id,
      overview: normalizeWaveformWindow(created.overview),
    })),

  queryWaveformSnapshot: (
    snapshotId: string,
    startMs: number,
    endMs: number,
    maxPoints: number,
    selection: WaveformSeriesSelection,
  ) => invoke<WaveformWindowPayload>('query_waveform_snapshot', {
    snapshotId,
    startMs,
    endMs,
    maxPoints,
    selection,
  }).then(normalizeWaveformWindow),

  releaseWaveformSnapshot: (snapshotId: string) =>
    invoke<void>('release_waveform_snapshot', { snapshotId }),

  getWaveformRawRange: (
    source: string,
    snapshotId: string | null,
    startTimestampUs: number,
    endTimestampUs: number,
    maxRows: number,
    selection: WaveformSeriesSelection,
  ) => invoke<WaveformWindowPayload>('get_waveform_raw_range', {
    source,
    snapshotId,
    startTimestampUs,
    endTimestampUs,
    maxRows,
    selection,
  }).then(normalizeWaveformWindow),

  exportWaveformCsv: (
    source: string,
    snapshotId: string | null,
    startTimestampUs: number,
    endTimestampUs: number,
    selection: WaveformSeriesSelection,
    path: string,
  ) => invoke<number>('export_waveform_csv', {
    source,
    snapshotId,
    startTimestampUs,
    endTimestampUs,
    selection,
    path,
  }),

  clearBuffer: (source: string) => invoke<void>('clear_buffer', { source }),

  setWaveformBufferCapacity: (source: string, maxPoints: number) =>
    invoke<void>('set_waveform_buffer_capacity', { source, maxPoints }),

  setRawDataBufferCapacity: (source: string, capacity: number) =>
    invoke<void>('set_rawdata_buffer_capacity', { source, capacity }),

  setCanBufferCapacity: (capacity: number) =>
    invoke<void>('set_can_buffer_capacity', { capacity }),

  setLogicBufferCapacity: (capacity: number) =>
    invoke<void>('set_logic_buffer_capacity', { capacity }),

  /// 清空后端原始数据收集器 (source = 字节设备节点 id；缺省清空全部源)
  clearRawDataBuffer: (source?: string) => clearRawDataBuffer(source),

  // ===== 节点图 (后端化重构) =====
  /// 更新指定 tab 的节点图 (整体替换 nodes + edges; nodes 可含全局 Transport/Protocol 节点定义)
  /// nodeHints: 每节点端口提示 (后端拓扑 op 解析默认 handle / RawData 改写用)
  /// widgetRecords: 该 tab 全部 widget 配置记录 (配置模型的后端权威存储, 整体替换)
  /// positions: 节点画布位置 (合并进后端工作区位置表)
  /// baseVersion: 乐观并发基线 (期间被其他写入方推进则返回 GraphVersionConflict)
  /// 编译失败 (循环/域不匹配等) 返回真实原因, 旧图保留
  /// 返回 `GraphDerivedPayload` — 本次图变化涉及的全部节点派生端口表 / 通道数 + 新版本号
  updateTabGraph: (tabId: string, documents: import('../nodes/document').NodeDocument[], edges: GraphEdge[], baseVersion?: number | null) =>
    invoke<GraphDerivedPayload>('update_tab_graph', { tabId, documents, edges, baseVersion: baseVersion ?? null }),

  /// 上报节点画布位置 (拖拽结束时批量提交) — 轻量路径, 不触发编译
  setNodePositions: (positions: Record<string, PositionPayload>) =>
    invoke<void>('set_node_positions', { positions }),

  /// 读取工作区水合快照; null = 无持久化工作区 (全新安装, 前端走默认启动)
  workspaceGet: () => invoke<WorkspaceSnapshotPayload | null>('workspace_get'),

  /// 提交 tab 元数据 (控件 tab + 数据面板 tab) — 增删/改名/重排后整表覆盖
  workspaceSetTabs: (tabs: TabMetaPayload[], dataTabs: DataTabMetaPayload[]) =>
    invoke<void>('workspace_set_tabs', { tabs, dataTabs }),

  /// 读取指定 tab 的权威源图 (版本冲突后拉取合并; tab 无源图时返回 null)
  getSourceGraph: (tabId: string) =>
    invoke<GraphSourceEventPayload | null>('get_source_graph', { tabId }),

  /// 移除指定 tab 的节点图 (tab 删除时调用)
  /// 返回 `GraphDerivedPayload` — 删除后工作区剩余节点的派生数据 (供前端 derivedPorts 对账)
  removeTabGraph: (tabId: string) =>
    invoke<GraphDerivedPayload>('remove_tab_graph', { tabId }),

  // ===== CAN 负载分析 =====
  /// 获取 CAN 负载统计快照
  /// nodeId: 用于自动解析波特率的设备节点 id
  /// bitrateBps: 可选手动覆盖波特率; null/0 = 自动从 TransportConfig 读取
  getCanLoadStats: (nodeId: string, bitrateBps?: number | null) =>
    invoke<CanLoadSnapshot>('get_can_load_stats', {
      nodeId,
      bitrateBps: bitrateBps ?? null,
    }),

  /// 设置 CAN 负载统计滑动窗口大小 (微秒)
  setCanLoadWindow: (windowUs: number) =>
    invoke<void>('set_can_load_window', { windowUs }),

  /// 清空 CAN 负载统计
  clearCanLoadStats: () => invoke<void>('clear_can_load_stats'),

  /// 获取当前 CAN 波特率 (从 TransportConfig 提取)
  /// 返回 [bps, source] — source = "slcan" / "candle" / "default"
  getCurrentCanBitrate: (nodeId: string) =>
    invoke<[number, string]>('get_current_can_bitrate', { nodeId }),

  /// 订阅 CAN 负载统计推送 — 周期性推送 CanLoadSnapshot
  /// nodeId: 用于自动解析波特率的设备节点 id
  /// intervalMs: 推送间隔 (默认 500ms)
  /// bitrateBps: 可选手动覆盖波特率; null/0 = 自动从 TransportConfig 读取
  subscribeCanLoad: (
    nodeId: string,
    onEvent: (snap: CanLoadSnapshot) => void,
    options?: { intervalMs?: number; bitrateBps?: number | null },
  ) => {
    const subscription = subscribeDisplay<CanLoadSnapshot>(
      {
        kind: 'can_load',
        node_id: nodeId,
        bitrate_bps: options?.bitrateBps ?? null,
      },
      'can_load',
      onEvent,
      { intervalMs: options?.intervalMs ?? 500 },
    );
    return {
      promise: Promise.resolve(),
      cancel: subscription.cancel,
    };
  },

  /// 导出 CAN 负载统计为 CSV (自动保存到下载目录, 返回完整文件路径)
  /// nodeId: 用于自动解析波特率的设备节点 id
  /// bitrateBps: 可选手动覆盖波特率; null/0 = 自动从 TransportConfig 读取
  exportCanLoadCsv: (nodeId: string, bitrateBps?: number | null) =>
    invoke<string>('export_can_load_csv', {
      nodeId,
      bitrateBps: bitrateBps ?? null,
    }),

  // ===== 帧解码器手动测试 =====
  /// 解析用户输入字符串为帧 (使用 blocks 配置创建临时 FrameParser, 调用 parse_once)
  /// 返回 outputs (端口→值) + valid + consumedBytes + 可选 error
  parseFrameDecoderInput: (
    blocks: DecoderBlock[],
    input: string,
    format: InputFormat,
    enableValid: boolean,
    enableFrameCount: boolean,
    enableLastTimestamp: boolean,
    enableFps: boolean,
  ) =>
    invoke<FrameDecoderManualResult>('parse_frame_decoder_input', {
      blocks,
      input,
      format,
      enableValid,
      enableFrameCount,
      enableLastTimestamp,
      enableFps,
    }),

  // ===== 调试 =====
  /// 打开当前 Webview 的开发者工具（检查元素）
  inspectElement: () => invoke<void>('inspect_element'),

  // ===== 数据管道性能配置 =====
  setPipelineConfig: (config: PipelineConfig) =>
    invoke<void>('set_pipeline_config', { config }),

  // ===== 四域持久化与历史查询 =====
  getRecordingHealth: () => invoke<RecordingHealth>('get_recording_health'),
  listRecordingSessions: () =>
    invoke<RecordingSession[]>('list_recording_sessions'),
  listRecordingSessionSummaries: () =>
    invoke<RecordingSessionSummary[]>('list_recording_session_summaries'),
  listRecordingBindings: (sessionId: string) =>
    invoke<RecordingBinding[]>('list_recording_bindings', { sessionId }),
  getRecordingDatabaseInfo: () =>
    invoke<RecordingDatabaseInfo>('get_recording_database_info'),
  queryRecordingHistory: (
    sessionId: string,
    bindingId: string | null,
    afterRowId = 0,
    limit = 500,
    includePayload = false,
    fromUs: number | null = null,
    toUs: number | null = null,
  ) => invoke<RecordingHistoryPage>('query_recording_history', {
    sessionId,
    bindingId,
    afterRowId,
    limit,
    includePayload,
    fromUs,
    toUs,
  }),
  cleanupRecordingSessions: (policy: RecordingCleanupPolicy) =>
    invoke<RecordingCleanupResult>('cleanup_recording_sessions', { policy }),
  exportRecordingData: (request: RecordingExportRequest) =>
    invoke<RecordingExportResult>('export_recording_data', { request }),
  queryRecordingSql: (queryId: string, sql: string, maxRows = 10_000) =>
    invoke<RecordingSqlResult>('query_recording_sql', {
      queryId,
      sql,
      maxRows,
    }),
  cancelRecordingQuery: (queryId: string) =>
    invoke<boolean>('cancel_recording_query', { queryId }),
  flushRecording: () => invoke<void>('flush_recording'),
  deleteRecordingSession: (sessionId: string) =>
    invoke<void>('delete_recording_session', { sessionId }),

  // ===== AI 对话 + MCP =====
  /// 发起一次对话 (可含多轮工具调用); 增量事件经 onEvent 推送, 返回 task_id。
  /// 会话所有权在后端: text 非空或携带 attachments 时追加用户条目, regenerate 时截断待重试回合。
  /// useBuiltinTools 启用内置原生工具 (软件自有能力 + 知识库, uiLang 注入系统提示词)
  aiChatSend: (
    sessionId: string,
    text: string | null,
    attachments: AiAttachment[] | null,
    regenerate: boolean,
    config: AiProviderConfig,
    system: string | null,
    maxToolRounds: number,
    useMcpTools: boolean,
    useBuiltinTools: boolean,
    uiLang: string,
    onEvent: Channel<AiChatEvent>,
  ) =>
    invoke<string>('ai_chat_send', {
      sessionId,
      text,
      attachments: attachments ?? null,
      regenerate,
      config,
      system: system ?? null,
      maxToolRounds,
      useMcpTools,
      useBuiltinTools,
      uiLang,
      onEvent,
    }),

  /// 取消进行中的对话任务, 返回任务是否存在
  aiChatCancel: (taskId: string) =>
    invoke<boolean>('ai_chat_cancel', { taskId }),

  /// 全部对话会话摘要
  chatListSessions: () => invoke<AiSessionMeta[]>('chat_list_sessions'),

  /// 新建会话
  chatCreateSession: (title: string) =>
    invoke<AiChatSession>('chat_create_session', { title }),

  /// 读取单个会话 (含全部条目); 不存在返回 null
  chatGetSession: (sessionId: string) =>
    invoke<AiChatSession | null>('chat_get_session', { sessionId }),

  /// 重命名会话
  chatRenameSession: (sessionId: string, title: string) =>
    invoke<void>('chat_rename_session', { sessionId, title }),

  /// 删除会话
  chatDeleteSession: (sessionId: string) =>
    invoke<void>('chat_delete_session', { sessionId }),

  /// 清空会话条目 (保留会话本身)
  chatClearSession: (sessionId: string) =>
    invoke<void>('chat_clear_session', { sessionId }),

  /// 读取适配器的 API key (系统钥匙串); 未设置返回 null
  aiKeychainGet: (adapter: string) =>
    invoke<string | null>('ai_keychain_get', { adapter }),

  /// 写入适配器的 API key (系统钥匙串, 覆盖旧值)
  aiKeychainSet: (adapter: string, key: string) =>
    invoke<void>('ai_keychain_set', { adapter, key }),

  /// 删除适配器的 API key (不存在时静默)
  aiKeychainDelete: (adapter: string) =>
    invoke<void>('ai_keychain_delete', { adapter }),

  /// 全部外部 MCP server 配置
  mcpListServers: () => invoke<McpServerConfig[]>('mcp_list_servers'),

  /// 新增外部 MCP server 配置
  mcpAddServer: (config: McpServerConfig) =>
    invoke<void>('mcp_add_server', { config }),

  /// 删除外部 MCP server 配置 (同时断连)
  mcpRemoveServer: (id: string) => invoke<void>('mcp_remove_server', { id }),

  /// 启用 / 禁用外部 MCP server
  mcpSetServerEnabled: (id: string, enabled: boolean) =>
    invoke<void>('mcp_set_server_enabled', { id, enabled }),

  /// 刷新聚合工具列表 (自动连接已启用未连接的 server) 并更新对话工具缓存
  mcpListTools: () => invoke<McpToolInfo[]>('mcp_list_tools'),

  /// 本地 MCP server 状态
  mcpServerStatus: () => invoke<McpServerStatus>('mcp_server_status'),

  /// 启动本地 MCP server (返回实际端口; 已运行则直接返回)
  mcpServerStart: (port: number) =>
    invoke<number>('mcp_server_start', { port }),

  /// 停止本地 MCP server (未运行时静默)
  mcpServerStop: () => invoke<void>('mcp_server_stop'),
};
