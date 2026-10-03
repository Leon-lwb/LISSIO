import { transport } from '../../rpc';

import type {
  RecordingBinding,
  RecordingCleanupPolicy,
  RecordingCleanupResult,
  RecordingDatabaseInfo,
  RecordingExportRequest,
  RecordingExportResult,
  RecordingHealth,
  RecordingHistoryPage,
  RecordingSession,
  RecordingSessionSummary,
  RecordingSqlResult,
} from '../tauriTypes';

export const recordingApi = {
  getRecordingHealth: () => transport.call<RecordingHealth>('get_recording_health'),
  listRecordingSessions: () =>
    transport.call<RecordingSession[]>('list_recording_sessions'),
  listRecordingSessionSummaries: () =>
    transport.call<RecordingSessionSummary[]>('list_recording_session_summaries'),
  listRecordingBindings: (sessionId: string) =>
    transport.call<RecordingBinding[]>('list_recording_bindings', { sessionId }),
  getRecordingDatabaseInfo: () =>
    transport.call<RecordingDatabaseInfo>('get_recording_database_info'),
  queryRecordingHistory: (
    sessionId: string,
    bindingId: string | null,
    afterRowId = 0,
    limit = 500,
    includePayload = false,
    fromUs: number | null = null,
    toUs: number | null = null,
  ) => transport.call<RecordingHistoryPage>('query_recording_history', {
    sessionId,
    bindingId,
    afterRowId,
    limit,
    includePayload,
    fromUs,
    toUs,
  }),
  cleanupRecordingSessions: (policy: RecordingCleanupPolicy) =>
    transport.call<RecordingCleanupResult>('cleanup_recording_sessions', { policy }),
  exportRecordingData: (request: RecordingExportRequest) =>
    transport.call<RecordingExportResult>('export_recording_data', { request }),
  queryRecordingSql: (queryId: string, sql: string, maxRows = 10_000) =>
    transport.call<RecordingSqlResult>('query_recording_sql', {
      queryId,
      sql,
      maxRows,
    }),
  cancelRecordingQuery: (queryId: string) =>
    transport.call<boolean>('cancel_recording_query', { queryId }),
  flushRecording: () => transport.call<void>('flush_recording'),
  deleteRecordingSession: (sessionId: string) =>
    transport.call<void>('delete_recording_session', { sessionId }),
  /// 暂停时新建录制会话并切换为当前写入目标
  createRecordingSession: () => transport.call<RecordingSession>('create_recording_session'),
  /// 暂停时把写入目标切换到指定的已停止会话
  setActiveRecordingSession: (sessionId: string) =>
    transport.call<RecordingSession>('set_active_recording_session', { sessionId }),
  /// 应用录制存储设置 (数据库目录 + 空会话续写开关 + 录制总开关); 空目录 = 默认位置。
  /// 总开关任意运行态都可热更新; 改数据库目录仍要求暂停/停止
  applyRecordingSettings: (
    databaseDir: string,
    continueEmptySession: boolean,
    enabled: boolean,
  ) =>
    transport.call<void>('apply_recording_settings', {
      databaseDir,
      continueEmptySession,
      enabled,
    }),

  // ===== AI 对话 + MCP =====
  /// 发起一次对话 (可含多轮工具调用); 增量事件经 onEvent 推送, 返回 task_id。
  /// 会话所有权在后端: text 非空或携带 attachments 时追加用户条目, regenerate 时截断待重试回合。
  /// useBuiltinTools 启用内置原生工具 (软件自有能力 + 知识库, uiLang 注入系统提示词)
};
