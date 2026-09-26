import { beforeEach, describe, expect, it, vi } from 'vitest';
import { subscribeCanFrames, subscribeCanFramesFiltered } from '../canSubscription';
import { tauriMock } from '../../../test/setup';

interface InvokeArgs {
  request: Record<string, unknown>;
  intervalMs?: number;
  maxItems?: number;
}

describe('CAN display subscriptions', () => {
  beforeEach(() => tauriMock.invoke.mockClear());

  it('keeps the unfiltered request minimal and typed', async () => {
    const subscription = subscribeCanFrames(vi.fn(), { intervalMs: 25, maxFrames: 20 });
    await subscription.settled;
    expect(tauriMock.invoke).toHaveBeenCalledWith(
      'subscribe_data',
      expect.objectContaining({
        request: { kind: 'can_frames' },
        intervalMs: 25,
        maxItems: 20,
      }),
    );
    subscription.cancel();
  });

  it('serializes the Rust filter contract exactly', async () => {
    const subscription = subscribeCanFramesFiltered(
      {
        id: 0x123,
        id_mask: 0x7ff,
        id_min: 0x100,
        id_max: 0x1ff,
        extended: false,
        rtr: false,
        direction: 'Rx',
        data_pattern: [0xaa, 0xbb],
      },
      vi.fn(),
    );
    await subscription.settled;
    const calls = tauriMock.invoke.mock.calls as unknown as [string, InvokeArgs][];
    const args = calls.find(([command]) => command === 'subscribe_data')?.[1];
    expect(args?.request).toEqual({
      kind: 'can_frames',
      filter: {
        id: 0x123,
        id_mask: 0x7ff,
        id_min: 0x100,
        id_max: 0x1ff,
        extended: false,
        rtr: false,
        direction: 'Rx',
        data_pattern: [0xaa, 0xbb],
      },
    });
    subscription.cancel();
  });

  it('reports subscription establishment errors to the caller', async () => {
    const error = new Error('invalid filter');
    tauriMock.invoke.mockRejectedValueOnce(error);
    const onError = vi.fn();
    const subscription = subscribeCanFrames(vi.fn(), { onError });
    await subscription.settled;
    expect(onError).toHaveBeenCalledWith(error);
  });
});
