// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';

// persist 中间件 localStorage 桩 (与 dockPropertiesExclusive.test.ts 一致)
vi.hoisted(() => {
  const store = new Map<string, string>();
  const localStorageMock = {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => void store.set(key, value),
    removeItem: (key: string) => void store.delete(key),
    clear: () => store.clear(),
    key: (index: number) => [...store.keys()][index] ?? null,
    get length() {
      return store.size;
    },
  };
  const g = globalThis as { localStorage?: unknown };
  g.localStorage = localStorageMock;
});

import { api, type RecordingHealth } from '../../lib/tauri/tauri';
import {
  recordingHistoryKey,
  removeRecordingSessionCache,
  upsertRecordingHistoryCache,
  useRecordingDatabaseStore,
  type RecordingHistoryCacheEntry,
  type RecordingHistoryRow,
} from '../recordingDatabaseStore';

const HEALTHY: RecordingHealth = {
  accepted_batches: 0,
  accepted_bytes: 0,
  persisted_batches: 0,
  persisted_bytes: 0,
  accepted_sequence: 0,
  persisted_sequence: 0,
  queued_batches: 0,
  enabled: true,
  dropped_batches: 0,
  rejected_batches: 0,
  warning: null,
  failed: null,
};

function row(rowId: number): RecordingHistoryRow {
  return {
    row_id: rowId,
    session_id: 'session',
    binding_id: 'binding',
    domain: 'float',
    epoch: 1,
    sequence_start: rowId,
    sequence_end: rowId,
    first_timestamp_us: rowId,
    last_timestamp_us: rowId,
    item_count: 1,
    effective_bytes: 8,
    checksum: 1,
    payload: null,
  };
}

function entry(key: string, sessionId: string, lastAccess: number, rowCount = 1): RecordingHistoryCacheEntry {
  return {
    key,
    sessionId,
    bindingId: null,
    includePayload: true,
    rows: Array.from({ length: rowCount }, (_, index) => row(index)),
    nextRowId: null,
    lastAccess,
  };
}

describe('recordingDatabaseStore cache', () => {
  it('builds distinct keys for binding and payload mode', () => {
    expect(recordingHistoryKey('s1', null, false)).toBe('s1|*|meta');
    expect(recordingHistoryKey('s1', 'b1', true)).toBe('s1|b1|payload');
  });

  it('replaces an existing cache entry and evicts oldest entries', () => {
    let cache: RecordingHistoryCacheEntry[] = [];
    for (let index = 0; index < 30; index += 1) {
      cache = upsertRecordingHistoryCache(cache, entry(`key-${index}`, `session-${index}`, index));
    }
    expect(cache.length).toBeLessThanOrEqual(24);
    expect(cache.some((item) => item.key === 'key-0')).toBe(false);
    expect(cache[cache.length - 1]?.key).toBe('key-29');

    const replacement = entry('key-29', 'session-29', 100, 3);
    cache = upsertRecordingHistoryCache(cache, replacement);
    const found = cache.find((item) => item.key === 'key-29');
    expect(found?.rows.length).toBe(3);
    expect(cache.filter((item) => item.key === 'key-29').length).toBe(1);
  });

  it('removes all cache entries for deleted sessions', () => {
    const cache = [
      entry('a', 'session-a', 1),
      entry('b', 'session-b', 2),
      entry('c', 'session-a', 3),
    ];
    expect(removeRecordingSessionCache(cache, ['session-a']).map((item) => item.key)).toEqual(['b']);
    expect(removeRecordingSessionCache(cache, []).length).toBe(3);
  });

  /// 打开时自动重建过数据库的提示必须进健康告警通道 (而不是失败通道, 那会停采集)。
  it('把后端健康提示放进非故障告警通道', async () => {
    vi.spyOn(api, 'listRecordingSessionSummaries').mockResolvedValue([]);
    vi.spyOn(api, 'getRecordingDatabaseInfo').mockResolvedValue({
      path: '/tmp/acquisition.duckdb',
      file_size_bytes: 0,
      session_count: 0,
      batch_count: 0,
      item_count: 0,
      effective_bytes: 0,
    });
    vi.spyOn(api, 'getRecordingHealth').mockResolvedValue({
      ...HEALTHY,
      warning: 'catalog was rebuilt',
    });

    await useRecordingDatabaseStore.getState().loadOverview();

    expect(useRecordingDatabaseStore.getState().healthWarning).toBe('catalog was rebuilt');
    useRecordingDatabaseStore.getState().clearHealthWarning();
    expect(useRecordingDatabaseStore.getState().healthWarning).toBeNull();
    vi.restoreAllMocks();
  });

  /// 出口拒绝的是普通对象 `{ kind, message }` (不是 Error): 历史数据库页面必须
  /// 显示后端消息, 而不是 `String(...)` 得到的 `[object Object]`。
  it('命令失败时显示 RpcError 的 message 而不是 [object Object]', async () => {
    const failure = { kind: 'Recording', message: '录制数据库已关闭' };
    vi.spyOn(api, 'listRecordingSessionSummaries').mockRejectedValue(failure);
    vi.spyOn(api, 'getRecordingDatabaseInfo').mockRejectedValue(failure);
    vi.spyOn(api, 'getRecordingHealth').mockResolvedValue({
      ...HEALTHY,
      warning: null,
      failed: null,
    });

    await useRecordingDatabaseStore.getState().loadOverview();

    expect(useRecordingDatabaseStore.getState().error).toBe('录制数据库已关闭');
    useRecordingDatabaseStore.getState().clearError();
    expect(useRecordingDatabaseStore.getState().error).toBeNull();
    vi.restoreAllMocks();
  });

  /// 读路径只报「录制不可用」时, 必须显示健康报告里的原始原因 (DuckDB 报错),
  /// 否则用户拿到的是一句不可行动的「writer is closed」。
  it('读失败时优先显示健康报告里的真实原因', async () => {
    const failure = { kind: 'Recording', message: 'recording is unavailable' };
    vi.spyOn(api, 'listRecordingSessionSummaries').mockRejectedValue(failure);
    vi.spyOn(api, 'getRecordingDatabaseInfo').mockRejectedValue(failure);
    vi.spyOn(api, 'getRecordingHealth').mockResolvedValue({
      ...HEALTHY,
      warning: null,
      failed: 'database error: Serialization Error: Failed to deserialize',
    });

    await useRecordingDatabaseStore.getState().loadOverview();

    expect(useRecordingDatabaseStore.getState().error).toBe(
      'database error: Serialization Error: Failed to deserialize'
    );
    useRecordingDatabaseStore.getState().clearError();
    vi.restoreAllMocks();
  });

  /// 健康报告里没有原因时回落读路径自己的文本 — 出口消息不得被吞掉。
  it('健康报告没有原因时回落读路径的错误文本', async () => {
    const failure = { kind: 'Recording', message: '录制数据库已关闭' };
    vi.spyOn(api, 'listRecordingSessionSummaries').mockRejectedValue(failure);
    vi.spyOn(api, 'getRecordingDatabaseInfo').mockRejectedValue(failure);
    vi.spyOn(api, 'getRecordingHealth').mockResolvedValue({
      ...HEALTHY,
      warning: null,
      failed: null,
    });

    await useRecordingDatabaseStore.getState().loadOverview();

    expect(useRecordingDatabaseStore.getState().error).toBe('录制数据库已关闭');
    useRecordingDatabaseStore.getState().clearError();
    vi.restoreAllMocks();
  });
});
