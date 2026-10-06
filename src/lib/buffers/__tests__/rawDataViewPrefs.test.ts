import { beforeEach, describe, expect, it, vi } from 'vitest';

// persist 中间件需要 localStorage — 在导入 store 前提供内存桩
// (Node 的实验性 localStorage 需 --localstorage-file, jsdom 环境下不可用)
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

import {
  DEFAULT_RAW_DATA_PREFS,
  getAllRawDataViewPrefs,
  getRawDataViewPrefs,
  useRawDataViewStore,
} from '../rawDataViewStore';

/// 视图侧 `grouping === 'terminal'` 与 store 的 `viewMode` 是同一件事的两种记法,
/// 这里钉死两者互转后能原样读回 —— 写回若只写 grouping, 终端模式就会丢。
const writeLikeView = (key: string, grouping: 'grid' | 'line' | 'terminal', repr: 'hex' | 'ascii' | 'utf8') => {
  const store = useRawDataViewStore.getState();
  store.setPrefs(key, {
    ...getRawDataViewPrefs(key),
    viewMode: grouping === 'terminal' ? 'terminal' : 'bytes',
    grouping: grouping === 'terminal' ? 'grid' : grouping,
    repr,
  });
};

const readLikeView = (key: string) => {
  const stored = getRawDataViewPrefs(key);
  return { grouping: stored.viewMode === 'terminal' ? 'terminal' : stored.grouping, repr: stored.repr };
};

describe('rawDataViewStore 持久化偏好', () => {
  beforeEach(() => {
    useRawDataViewStore.setState({ prefsByWidget: {} });
  });

  it('未写入时返回默认值', () => {
    expect(getRawDataViewPrefs('nobody')).toEqual(DEFAULT_RAW_DATA_PREFS);
  });

  it('setPrefs 之后能读回 — 这正是此前缺失的一环', () => {
    writeLikeView('w1', 'line', 'ascii');
    expect(readLikeView('w1')).toEqual({ grouping: 'line', repr: 'ascii' });
  });

  it('终端模式经 viewMode/grouping 互转后仍然是终端', () => {
    writeLikeView('w2', 'terminal', 'utf8');
    expect(readLikeView('w2').grouping).toBe('terminal');
  });

  it('不同 widget 互不干扰', () => {
    writeLikeView('a', 'line', 'ascii');
    writeLikeView('b', 'terminal', 'utf8');
    expect(readLikeView('a')).toEqual({ grouping: 'line', repr: 'ascii' });
    expect(readLikeView('b')).toEqual({ grouping: 'terminal', repr: 'utf8' });
  });

  it('旧数据缺新字段时用默认值补齐', () => {
    // 旧版本只存了 grouping 的情形
    useRawDataViewStore.setState({ prefsByWidget: { old: { grouping: 'line' } as never } });
    const prefs = getRawDataViewPrefs('old');
    expect(prefs.grouping).toBe('line');
    expect(prefs.ansiDecode).toBe(DEFAULT_RAW_DATA_PREFS.ansiDecode);
  });

  it('getAll 交回全部已写入的 widget', () => {
    writeLikeView('a', 'line', 'hex');
    writeLikeView('b', 'grid', 'utf8');
    expect(Object.keys(getAllRawDataViewPrefs()).sort()).toEqual(['a', 'b']);
  });
});
