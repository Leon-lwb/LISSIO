import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CanFrameList } from '../CanFrameList';
import { canFrameBuffer } from '../../../../lib/buffers/canBuffer';
import { useAppStore } from '../../../../store/appStore';
import { tauriMock } from '../../../../test/setup';
import type { CanFrame } from '../../../../types';

vi.mock('@tanstack/react-virtual', () => ({
  useVirtualizer: (options: { count: number }) => ({
    getVirtualItems: () =>
      Array.from({ length: options.count }, (_, index) => ({
        index,
        key: index,
        start: index * 24,
        size: 24,
        end: (index + 1) * 24,
      })),
    getTotalSize: () => options.count * 24,
    scrollToIndex: vi.fn(),
  }),
}));

function frame(id: number, direction: 'Rx' | 'Tx' = 'Rx'): CanFrame {
  return {
    timestamp: 1_700_000_000_000_000 + id,
    id,
    extended: false,
    rtr: false,
    dlc: 1,
    data: [0xaa],
    direction,
  };
}

describe('CanFrameList', () => {
  beforeEach(() => {
    vi.spyOn(globalThis, 'requestAnimationFrame').mockImplementation((callback) => {
      callback(0);
      return 1;
    });
    canFrameBuffer.clear();
    tauriMock.invoke.mockClear();
    useAppStore.setState({ lang: 'zh' } as never);
  });

  it('renders the empty state before SLCAN frames arrive', () => {
    render(<CanFrameList />);
    expect(screen.getByText('暂无 CAN 帧')).toBeInTheDocument();
  });

  it('renders received SLCAN frames with counters and payload', () => {
    render(<CanFrameList />);
    act(() => canFrameBuffer.push([frame(0x123), frame(0x456, 'Tx')]));

    expect(screen.getByText('0x123')).toBeInTheDocument();
    expect(screen.getByText('0x456')).toBeInTheDocument();
    expect(screen.getByText('Rx:1')).toBeInTheDocument();
    expect(screen.getByText('Tx:1')).toBeInTheDocument();
    expect(screen.getAllByText('AA')).toHaveLength(2);
  });

  it('sends a typed backend filter request for ID and direction', async () => {
    const user = userEvent.setup();
    render(<CanFrameList />);
    await user.type(screen.getByLabelText('按 ID 过滤 (HEX)'), '123');
    await user.click(screen.getByRole('button', { name: 'Rx' }));

    const calls = tauriMock.invoke.mock.calls as unknown as [string, unknown][];
    const call = calls
      .filter(([command, rawArgs]) => {
        const args = rawArgs as { request?: { kind?: string; filter?: unknown } };
        return (
          command === 'subscribe_data' &&
          args.request?.kind === 'can_frames' &&
          args.request?.filter
        );
      })
      .slice(-1)[0];
    expect(call?.[1]).toMatchObject({
      request: {
        kind: 'can_frames',
        filter: { id: 0x123, direction: 'Rx' },
      },
    });
  });

  it('shows an error instead of silently showing an empty filtered list', async () => {
    const user = userEvent.setup();
    render(<CanFrameList />);
    await user.type(screen.getByLabelText('按 ID 过滤 (HEX)'), 'xyz');

    expect(screen.getByRole('alert')).toHaveTextContent('CAN ID 过滤值无效');
  });
});
