import { describe, expect, it } from 'vitest';
import {
  CAN_BITRATE_BPS,
  CAN_BITRATES,
  isCanBitrate,
  parseCanDriverPayload,
} from '../canBitrate';

describe('CAN_BITRATES', () => {
  it('covers the full slcan S0-S8 rate set in ascending order', () => {
    expect([...CAN_BITRATES]).toEqual([
      'Bps10k',
      'Bps20k',
      'Bps50k',
      'Bps100k',
      'Bps125k',
      'Bps250k',
      'Bps500k',
      'Bps800k',
      'Bps1m',
    ]);
  });

  it('uses lowercase m for 1M to mirror the Rust serde contract', () => {
    expect(CAN_BITRATES[CAN_BITRATES.length - 1]).toBe('Bps1m');
    expect(CAN_BITRATES).not.toContain('Bps1M');
  });
});

describe('CAN_BITRATE_BPS', () => {
  it('maps every variant to its bps value', () => {
    expect(CAN_BITRATE_BPS.Bps10k).toBe(10_000);
    expect(CAN_BITRATE_BPS.Bps20k).toBe(20_000);
    expect(CAN_BITRATE_BPS.Bps50k).toBe(50_000);
    expect(CAN_BITRATE_BPS.Bps100k).toBe(100_000);
    expect(CAN_BITRATE_BPS.Bps125k).toBe(125_000);
    expect(CAN_BITRATE_BPS.Bps250k).toBe(250_000);
    expect(CAN_BITRATE_BPS.Bps500k).toBe(500_000);
    expect(CAN_BITRATE_BPS.Bps800k).toBe(800_000);
    expect(CAN_BITRATE_BPS.Bps1m).toBe(1_000_000);
  });
});

describe('isCanBitrate', () => {
  it('accepts contract names and rejects legacy mistyped ones', () => {
    for (const name of CAN_BITRATES) expect(isCanBitrate(name)).toBe(true);
    expect(isCanBitrate('Bps1M')).toBe(false);
    expect(isCanBitrate('Bps200k')).toBe(false);
    expect(isCanBitrate('')).toBe(false);
  });
});

describe('parseCanDriverPayload', () => {
  it('parses a valid slcan payload', () => {
    expect(
      parseCanDriverPayload('slcan', {
        port_name: 'COM3',
        baud_rate: 115200,
        can_bitrate: 'Bps1m',
      }),
    ).toEqual({ port_name: 'COM3', baud_rate: 115200, can_bitrate: 'Bps1m' });
  });

  it('parses a valid candle-light payload', () => {
    expect(
      parseCanDriverPayload('candle-light', {
        bus: 0,
        address: 1,
        channel: 0,
        can_bitrate: 'Bps500k',
      }),
    ).toEqual({ bus: 0, address: 1, channel: 0, can_bitrate: 'Bps500k' });
  });

  it('rejects unknown drivers, bad bitrate values, and malformed shapes', () => {
    expect(
      parseCanDriverPayload('serial', { port_name: '', baud_rate: 115200, can_bitrate: 'Bps1m' }),
    ).toBeNull();
    // 修复前 schema 的非法字面量 (大写 M) 必须被拒之门外
    expect(
      parseCanDriverPayload('slcan', { port_name: '', baud_rate: 115200, can_bitrate: 'Bps1M' }),
    ).toBeNull();
    expect(
      parseCanDriverPayload('slcan', { port_name: 3, baud_rate: 115200, can_bitrate: 'Bps1m' }),
    ).toBeNull();
    expect(parseCanDriverPayload('slcan', { port_name: '', can_bitrate: 'Bps1m' })).toBeNull();
    expect(parseCanDriverPayload('slcan', null)).toBeNull();
    expect(
      parseCanDriverPayload('candle-light', { bus: 0, address: 1, can_bitrate: 'Bps1m' }),
    ).toBeNull();
  });
});
