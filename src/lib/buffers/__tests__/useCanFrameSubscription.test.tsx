import { StrictMode } from 'react';
import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { tauriMock } from '../../../test/setup';
import type { CanFrame, CanFrameBatch } from '../../../types';
import { canFrameBuffer } from '../canBuffer';
import { useCanFrameSubscription } from '../useCanFrameSubscription';

interface CanChannel {
  onmessage: ((event: { kind: string; payload: CanFrameBatch }) => void) | null;
}

function canChannels(): CanChannel[] {
  const calls = tauriMock.invoke.mock.calls as unknown as [
    string,
    { request?: { kind?: string }; onEvent?: CanChannel },
  ][];
  return calls
    .filter(([command, args]) => command === 'subscribe_data' && args.request?.kind === 'can_frames')
    .map(([, args]) => args.onEvent!);
}

const frame: CanFrame = {
  timestamp: 5,
  id: 0x480,
  extended: false,
  rtr: false,
  dlc: 8,
  data: [0, 0, 0, 0, 0, 0, 0, 0],
  direction: 'Rx',
};

function deliver(channel: CanChannel, id: number): void {
  channel.onmessage?.({
    kind: 'can_frames',
    payload: { seq: 0, frames: [{ ...frame, id }] },
  });
}

beforeEach(() => {
  canFrameBuffer.clear();
  tauriMock.invoke.mockClear();
});

describe('root CAN frame subscription', () => {
  it('keeps the second StrictMode subscription alive and ignores the cancelled one', () => {
    const { unmount } = renderHook(() => useCanFrameSubscription(), {
      wrapper: StrictMode,
    });
    const channels = canChannels();
    expect(channels).toHaveLength(2);

    act(() => {
      deliver(channels[0], 0x123);
      deliver(channels[1], 0x480);
    });
    expect(canFrameBuffer.getRecent(2)).toEqual([frame]);

    unmount();
    act(() => deliver(channels[1], 0x481));
    expect(canFrameBuffer.getRecent(2)).toEqual([frame]);
  });
});
