import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useAppStore } from '../appStore';
import { parseGraphVersionConflict, syncTabGraphToBackend } from '../appStoreHelpers';
import { api } from '../../lib/tauri/tauri';
import { documentNodes } from '../../test/nodeDocuments';

/// M6 前端一半: 图版本冲突按稳定 `kind` 判定 — 不再匹配本地化文案。
describe('parseGraphVersionConflict', () => {
  it('recognizes the dedicated kind and reads data.current', () => {
    expect(
      parseGraphVersionConflict({
        kind: 'GraphVersionConflict',
        message: '图版本冲突: 基线过期 (后端当前 v9)',
        data: { current: '9' },
      })
    ).toEqual({ current: '9' });
  });

  it('stays a conflict when data is missing (robust to a missing envelope field)', () => {
    expect(
      parseGraphVersionConflict({
        kind: 'GraphVersionConflict',
        message: '图版本冲突: 基线过期 (后端当前 v9)',
      })
    ).toEqual({ current: null });
  });

  it('never falls back to the message substring', () => {
    expect(
      parseGraphVersionConflict({
        kind: 'CommandFailed',
        message: '图版本冲突: 基线过期 (后端当前 v9)',
      })
    ).toBeNull();
  });

  it('does not guess a conflict from an unrelated kind that carries data.current', () => {
    expect(parseGraphVersionConflict({ kind: 'Config', data: { current: '9' } })).toBeNull();
  });

  it('ignores non-object errors', () => {
    expect(parseGraphVersionConflict(null)).toBeNull();
    expect(parseGraphVersionConflict(new Error('图版本冲突: 基线过期'))).toBeNull();
  });
});

/// 重试路径的端到端证据: 只有 GraphVersionConflict 信封才触发一次权威源图采纳。
describe('whole-graph commit conflict retry', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    useAppStore.setState({
      rfNodes: documentNodes(),
      rfEdges: [],
      activeControlTabId: 'default',
      controlTabs: [{ id: 'default', name: 'One' }],
      graphVersion: null,
    });
  });

  it('fetches the authoritative source graph and retries once on the conflict kind', async () => {
    const update = vi
      .spyOn(api, 'updateTabGraph')
      .mockRejectedValueOnce({
        kind: 'GraphVersionConflict',
        message: '图版本冲突: 基线过期 (后端当前 v9)',
        data: { current: '9' },
      })
      .mockResolvedValue({ nodes: [], version: 10 });
    const source = vi
      .spyOn(api, 'getSourceGraph')
      .mockResolvedValue({ tab_id: 'default', version: 9, documents: [], edges: [] });

    await syncTabGraphToBackend('default');

    expect(source).toHaveBeenCalledWith('default');
    expect(update).toHaveBeenCalledTimes(2);
  });

  it('does not retry on a Chinese message alone', async () => {
    vi.spyOn(api, 'updateTabGraph').mockRejectedValue({
      kind: 'CommandFailed',
      message: '图版本冲突: 基线过期 (后端当前 v9)',
    });
    const source = vi.spyOn(api, 'getSourceGraph').mockResolvedValue(null);

    await syncTabGraphToBackend('default');

    expect(source).not.toHaveBeenCalled();
  });
});
