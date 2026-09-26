import { describe, expect, it, vi } from 'vitest';
import { CanFrameBuffer } from '../canBuffer';
import type { CanFrame } from '../../../types';

vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
  callback(0);
  return 0;
});

function frame(id: number, extended: boolean, direction: 'Rx' | 'Tx', data: number[]): CanFrame {
  return { timestamp: 1, id, extended, direction, data, dlc: data.length, rtr: false };
}

describe('CAN latest by ID', () => {
  it('combines directions, distinguishes frame format, and counts beyond ring capacity until clear', () => {
    const buffer = new CanFrameBuffer(1);
    buffer.push([
      frame(0x123, false, 'Rx', [0x11]),
      frame(0x123, false, 'Tx', [0x22]),
      frame(0x123, true, 'Rx', [0x33]),
    ]);

    expect(buffer.length).toBe(1);
    expect(buffer.getLatestById()).toEqual([
      { key: 'standard:291', frame: frame(0x123, false, 'Tx', [0x22]), count: 2 },
      { key: 'extended:291', frame: frame(0x123, true, 'Rx', [0x33]), count: 1 },
    ]);

    buffer.clear();
    expect(buffer.getLatestById()).toEqual([]);
  });
});
