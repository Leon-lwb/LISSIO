import { describe, expect, it } from 'vitest';
import {
  recordingHistoryKey,
  removeRecordingSessionCache,
  upsertRecordingHistoryCache,
  type RecordingHistoryCacheEntry,
  type RecordingHistoryRow,
} from '../recordingDatabaseStore';

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
});
